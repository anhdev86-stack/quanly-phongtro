import { Inject, Injectable } from '@nestjs/common';
import type { InvoiceSettlements, Paged, PaymentDto, paymentCreateSchema, paymentListQuerySchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { nextSequence } from '../../common/db/sequences.js';
import { day, dayOrNull, iso, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { userNames } from '../utilities/user-names.js';
import { InvoiceBalances } from './balances.js';

const include = {
  tenancy: {
    include: {
      room: { include: { building: true } },
      members: { where: { role: 'PRIMARY' as const }, include: { tenant: { select: { fullName: true } } }, orderBy: { joinedOn: 'desc' as const } },
    },
  },
  allocations: { include: { invoice: { select: { number: true, statementPeriod: { select: { monthStart: true } } } } } },
} satisfies Prisma.PaymentInclude;
type PaymentFull = Prisma.PaymentGetPayload<{ include: typeof include }>;

/** Hook khi đảo khoản thu hoặc thu tiền muộn sau quyết toán (Phase 7 ghi settlement_events). */
export interface ReversalObserver {
  afterReversal(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    tenancyId: string,
    kind: 'PAYMENT' | 'CREDIT_APPLICATION' | 'CREDIT_REFUND' | 'DEPOSIT_TX',
    refId: string,
    reason: string,
  ): Promise<void>;
  afterPayment?(tx: Prisma.TransactionClient, user: AuthUser, tenancyId: string, paymentId: string): Promise<void>;
}
export const REVERSAL_OBSERVERS = Symbol('REVERSAL_OBSERVERS');

/**
 * Phiếu thu (MASTER_PLAN 9.1): xác nhận đã thực nhận, tạo payment POSTED + allocation trong một transaction; không vượt
 * `remaining` (khóa tenancy → các thông báo theo id); đảo toàn bộ, có lý do, cần finance.reverse. Cần Idempotency-Key.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly balances: InvoiceBalances,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    @Inject(REVERSAL_OBSERVERS) private readonly observers: ReversalObserver[],
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(user: AuthUser, input: z.output<typeof paymentCreateSchema>, key: string | undefined) {
    const result = await this.idempotency.execute({ user, route: 'POST /payments', key, payload: input, successStatus: 201 }, async (tx) => {
      const p = await this.createInTx(tx, user, input);
      return { body: { id: p.id, number: p.number }, resultReference: p.id };
    });
    return { status: result.status, body: await this.get(user, result.body.id) };
  }

  /** Ghi phiếu thu trong transaction có sẵn (dùng cả cho thu nợ sau quyết toán). */
  async createInTx(tx: Prisma.TransactionClient, user: AuthUser, input: z.output<typeof paymentCreateSchema>) {
    if (input.paid_at > this.clock.today()) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày thu không được ở tương lai.', { paid_at: ['Ngày ở tương lai.'] });
    await lockRows(tx, 'tenancies', [input.tenancy_id]);
    const tenancy = await tx.tenancy.findFirst({ where: { id: input.tenancy_id, room: this.rooms.roomWhere(user) } });
    if (!tenancy) throw new AppError('NOT_FOUND');
    const ids = input.allocations.map((a) => a.invoice_id);
    await lockRows(tx, 'invoices', ids);
    const invoices = await tx.invoice.findMany({ where: { id: { in: ids } } });
    for (const [i, a] of input.allocations.entries()) {
      const inv = invoices.find((x) => x.id === a.invoice_id);
      const field = `allocations.${i}.amount_vnd`;
      if (!inv || inv.tenancyId !== tenancy.id) throw new AppError('BUSINESS_RULE_VIOLATION', 'Thông báo không thuộc lần thuê này.', { [`allocations.${i}.invoice_id`]: ['Không thuộc lần thuê.'] });
      if (inv.lifecycle !== 'PUBLISHED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ thu cho thông báo đã phát hành.', { [field]: ['Thông báo chưa phát hành hoặc đã hủy.'] });
      if (inv.type === 'CREDIT_ADJUSTMENT') throw new AppError('BUSINESS_RULE_VIOLATION', 'Không thu tiền cho chứng từ credit.', { [field]: ['Chứng từ credit.'] });
    }
    const remaining = await this.balances.remaining(tx, invoices);
    for (const [i, a] of input.allocations.entries()) {
      const left = remaining.get(a.invoice_id) ?? 0n;
      if (BigInt(a.amount_vnd) > left) {
        throw new AppError('BUSINESS_RULE_VIOLATION', `Số tiền vượt số còn phải thu (${left.toString()}đ).`, { [`allocations.${i}.amount_vnd`]: [`Tối đa ${left.toString()}đ.`] });
      }
    }
    const yyyymm = input.paid_at.slice(0, 7).replace('-', '');
    const number = `PT-${yyyymm}-${String(await nextSequence(tx, user.workspaceId, 'PAYMENT', yyyymm)).padStart(4, '0')}`;
    const payment = await tx.payment.create({
      data: {
        workspaceId: user.workspaceId,
        tenancyId: tenancy.id,
        number,
        amountVnd: BigInt(input.amount_vnd),
        method: input.method,
        paidAt: toDbDate(input.paid_at),
        reference: input.reference,
        note: input.note,
        createdBy: user.id,
        allocations: { create: input.allocations.map((a) => ({ invoiceId: a.invoice_id, amountVnd: BigInt(a.amount_vnd) })) },
      },
    });
    await this.audit.record(tx, {
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: 'payment.create',
      entityType: 'payment',
      entityId: payment.id,
      after: { number, ...input },
    });
    for (const o of this.observers) await o.afterPayment?.(tx, user, tenancy.id, payment.id);
    return payment;
  }

  /** Đảo toàn bộ phiếu thu: allocation mất hiệu lực, nợ quay lại đúng thông báo gốc (9.1). Không đảo hai lần. */
  async reverse(user: AuthUser, id: string, reason: string, key: string | undefined) {
    const head = await this.row(this.prisma, user, id);
    const result = await this.idempotency.execute({ user, route: `POST /payments/${id}/reverse`, key, payload: { reason } }, async (tx) => {
      await lockRows(tx, 'tenancies', [head.tenancyId]);
      await lockRows(tx, 'invoices', head.allocations.map((a) => a.invoiceId));
      await lockRows(tx, 'payments', [id]);
      const p = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (p.status === 'REVERSED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Phiếu thu đã được đảo.');
      await tx.payment.update({ where: { id }, data: { status: 'REVERSED', reversedAt: this.clock.now(), reversedBy: user.id, reversalReason: reason } });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'payment.reverse',
        entityType: 'payment',
        entityId: id,
        reason,
        before: { status: 'POSTED', amount_vnd: p.amountVnd },
      });
      for (const o of this.observers) await o.afterReversal(tx, user, p.tenancyId, 'PAYMENT', id, reason);
      return { body: { id }, resultReference: id };
    });
    return { status: result.status, body: await this.get(user, id) };
  }

  async list(user: AuthUser, q: z.output<typeof paymentListQuerySchema>): Promise<Paged<PaymentDto>> {
    const rows = await this.prisma.payment.findMany({
      where: {
        workspaceId: user.workspaceId,
        tenancy: { room: { ...this.rooms.roomWhere(user), ...(q.building_id ? { buildingId: q.building_id } : {}) } },
        ...(q.tenancy_id ? { tenancyId: q.tenancy_id } : {}),
        ...(q.invoice_id ? { allocations: { some: { invoiceId: q.invoice_id } } } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.from || q.to ? { paidAt: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      },
      include,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });
    return paged(await this.dtos(rows), q.page, q.page_size);
  }

  async get(user: AuthUser, id: string): Promise<PaymentDto> {
    return (await this.dtos([await this.row(this.prisma, user, id)]))[0]!;
  }

  /** Các khoản đã thu/cấn trừ của một thông báo; với chứng từ credit là các khoản đã dùng. */
  async invoiceSettlements(user: AuthUser, invoiceId: string): Promise<InvoiceSettlements> {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } } });
    if (!inv) throw new AppError('NOT_FOUND');
    const allocations = await this.prisma.paymentAllocation.findMany({ where: { invoiceId }, include: { payment: true }, orderBy: { payment: { paidAt: 'asc' } } });
    const deposits = await this.prisma.depositAllocation.findMany({ where: { invoiceId }, include: { depositTransaction: true } });
    const reversed = await this.prisma.depositTransaction.findMany({
      where: { type: 'REVERSAL', reversesTransactionId: { in: deposits.map((d) => d.depositTransactionId) } },
      select: { reversesTransactionId: true },
    });
    const dead = new Set(reversed.map((r) => r.reversesTransactionId));
    const received = await this.prisma.creditApplication.findMany({ where: { targetInvoiceId: invoiceId }, include: { creditInvoice: { select: { number: true } } }, orderBy: { createdAt: 'asc' } });
    const given = await this.prisma.creditApplication.findMany({ where: { creditInvoiceId: invoiceId }, include: { targetInvoice: { select: { number: true } } }, orderBy: { createdAt: 'asc' } });
    const refunds = await this.prisma.creditRefund.findMany({ where: { creditInvoiceId: invoiceId }, orderBy: { createdAt: 'asc' } });
    return {
      payments: allocations.map((a) => ({
        payment_id: a.paymentId,
        number: a.payment.number,
        amount_vnd: a.amountVnd.toString(),
        method: a.payment.method,
        paid_at: day(a.payment.paidAt),
        reference: a.payment.reference,
        status: a.payment.status,
      })),
      deposits: deposits.map((d) => ({ deposit_transaction_id: d.depositTransactionId, amount_vnd: d.amountVnd.toString(), paid_at: dayOrNull(d.depositTransaction.paidAt), active: !dead.has(d.depositTransactionId) })),
      credits_received: received.map((c) => ({ id: c.id, credit_invoice_id: c.creditInvoiceId, credit_invoice_number: c.creditInvoice.number, amount_vnd: c.amountVnd.toString(), status: c.status })),
      credits_given: given.map((c) => ({ id: c.id, target_invoice_id: c.targetInvoiceId, target_invoice_number: c.targetInvoice.number, amount_vnd: c.amountVnd.toString(), status: c.status })),
      refunds: refunds.map((r) => ({ id: r.id, amount_vnd: r.amountVnd.toString(), paid_at: day(r.paidAt), method: r.method, reference: r.reference, status: r.status })),
    };
  }

  private async row(db: Db, user: AuthUser, id: string): Promise<PaymentFull> {
    const p = await db.payment.findFirst({ where: { id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } }, include });
    if (!p) throw new AppError('NOT_FOUND');
    return p;
  }

  private async dtos(rows: PaymentFull[]): Promise<PaymentDto[]> {
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    return rows.map((p) => ({
      id: p.id,
      number: p.number,
      tenancy_id: p.tenancyId,
      tenancy_code: p.tenancy.code,
      room_code: p.tenancy.room.code,
      building_code: p.tenancy.room.building.code,
      building_name: p.tenancy.room.building.name,
      primary_tenant_name: p.tenancy.members[0]?.tenant.fullName ?? null,
      amount_vnd: p.amountVnd.toString(),
      method: p.method,
      paid_at: day(p.paidAt),
      reference: p.reference,
      note: p.note,
      status: p.status,
      reversed_at: iso(p.reversedAt),
      reversal_reason: p.reversalReason,
      created_by_name: names.get(p.createdBy) ?? null,
      created_at: iso(p.createdAt)!,
      allocations: p.allocations.map((a) => ({
        invoice_id: a.invoiceId,
        invoice_number: a.invoice.number,
        period: a.invoice.statementPeriod ? fromDbDate(a.invoice.statementPeriod.monthStart).slice(0, 7) : null,
        amount_vnd: a.amountVnd.toString(),
      })),
    }));
  }
}
