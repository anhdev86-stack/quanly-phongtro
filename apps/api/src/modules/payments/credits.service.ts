import { Inject, Injectable } from '@nestjs/common';
import type { creditApplySchema, creditRefundCreateSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { day } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { toDbDate } from '../../domain/dates/date-only.js';
import type { Invoice, Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { InvoiceBalances } from './balances.js';
import { REVERSAL_OBSERVERS, type ReversalObserver } from './payments.service.js';

/**
 * Credit (MASTER_PLAN 8.8): không tự thành tiền hoàn; cấn trừ vào thông báo loại nợ của cùng tenancy, đến hạn sớm nhất
 * trước. Phần dư ghi hoàn thủ công qua credit_refunds khi thực chi (không dùng sổ cọc). Mọi thao tác cần Idempotency-Key.
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly balances: InvoiceBalances,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    @Inject(REVERSAL_OBSERVERS) private readonly observers: ReversalObserver[],
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async apply(user: AuthUser, input: z.output<typeof creditApplySchema>, key: string | undefined) {
    const credit = await this.creditInvoice(user, input.credit_invoice_id);
    return this.idempotency.execute({ user, route: 'POST /credit-applications', key, payload: input, successStatus: 201 }, async (tx) => {
      await lockRows(tx, 'tenancies', [credit.tenancyId]);
      const debts = await tx.invoice.findMany({
        where: { tenancyId: credit.tenancyId, lifecycle: 'PUBLISHED', type: { not: 'CREDIT_ADJUSTMENT' }, ...(input.target_invoice_id ? { id: input.target_invoice_id } : {}) },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });
      if (input.target_invoice_id && !debts.length) {
        throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ cấn trừ vào thông báo đã phát hành của cùng lần thuê.', { target_invoice_id: ['Không hợp lệ.'] });
      }
      await lockRows(tx, 'invoices', [credit.id, ...debts.map((d) => d.id)]);
      const available = (await this.balances.remaining(tx, [credit])).get(credit.id) ?? 0n;
      const owed = await this.balances.remaining(tx, debts);
      let left = input.amount_vnd ? BigInt(input.amount_vnd) : available;
      if (left > available) throw new AppError('BUSINESS_RULE_VIOLATION', `Credit còn lại chỉ ${available.toString()}đ.`, { amount_vnd: ['Vượt credit còn lại.'] });
      if (left === 0n) throw new AppError('BUSINESS_RULE_VIOLATION', 'Credit đã dùng hết.');
      const totalOwed = [...owed.values()].reduce((a, b) => a + b, 0n);
      if (input.amount_vnd && left > totalOwed) {
        throw new AppError('BUSINESS_RULE_VIOLATION', `Số tiền vượt số còn nợ (${totalOwed.toString()}đ).`, { amount_vnd: ['Vượt số còn nợ.'] });
      }
      const created: string[] = [];
      for (const d of debts) {
        if (left === 0n) break;
        const take = (owed.get(d.id) ?? 0n) < left ? (owed.get(d.id) ?? 0n) : left;
        if (take === 0n) continue;
        const app = await tx.creditApplication.create({
          data: { workspaceId: user.workspaceId, tenancyId: credit.tenancyId, creditInvoiceId: credit.id, targetInvoiceId: d.id, amountVnd: take, createdBy: user.id, createdAt: this.clock.now() },
        });
        created.push(app.id);
        left -= take;
      }
      if (!created.length) throw new AppError('BUSINESS_RULE_VIOLATION', 'Không còn thông báo nào đang nợ để cấn trừ.');
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'credit.apply', entityType: 'invoice', entityId: credit.id, after: { applications: created, ...input } });
      return { body: { ids: created }, resultReference: created[0] };
    });
  }

  async reverseApplication(user: AuthUser, id: string, reason: string, key: string | undefined) {
    const app = await this.prisma.creditApplication.findFirst({ where: { id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } } });
    if (!app) throw new AppError('NOT_FOUND');
    return this.idempotency.execute({ user, route: `POST /credit-applications/${id}/reverse`, key, payload: { reason } }, async (tx) => {
      await lockRows(tx, 'tenancies', [app.tenancyId]);
      await lockRows(tx, 'invoices', [app.creditInvoiceId, app.targetInvoiceId]);
      await lockRows(tx, 'credit_applications', [id]);
      const cur = await tx.creditApplication.findUniqueOrThrow({ where: { id } });
      if (cur.status === 'REVERSED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Khoản cấn trừ đã được đảo.');
      await tx.creditApplication.update({ where: { id }, data: { status: 'REVERSED', reversedAt: this.clock.now(), reversedBy: user.id, reversalReason: reason } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'credit.reverse_application', entityType: 'credit_application', entityId: id, reason });
      for (const o of this.observers) await o.afterReversal(tx, user, app.tenancyId, 'CREDIT_APPLICATION', id, reason);
      return { body: { ok: true as const }, resultReference: id };
    });
  }

  async refund(user: AuthUser, input: z.output<typeof creditRefundCreateSchema>, key: string | undefined) {
    const credit = await this.creditInvoice(user, input.credit_invoice_id);
    return this.idempotency.execute({ user, route: 'POST /credit-refunds', key, payload: input, successStatus: 201 }, async (tx) => {
      const r = await this.refundInTx(tx, user, credit, input);
      return { body: { id: r.id, paid_at: day(r.paidAt) }, resultReference: r.id };
    });
  }

  /** Ghi hoàn credit trong transaction có sẵn (dùng cả cho hoàn tiền dư khi quyết toán). */
  async refundInTx(tx: Prisma.TransactionClient, user: AuthUser, credit: Invoice, input: z.output<typeof creditRefundCreateSchema>) {
    if (input.paid_at > this.clock.today()) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày chi không được ở tương lai.', { paid_at: ['Ngày ở tương lai.'] });
    await lockRows(tx, 'tenancies', [credit.tenancyId]);
    await lockRows(tx, 'invoices', [credit.id]);
    const available = (await this.balances.remaining(tx, [credit])).get(credit.id) ?? 0n;
    if (BigInt(input.amount_vnd) > available) throw new AppError('BUSINESS_RULE_VIOLATION', `Credit còn lại chỉ ${available.toString()}đ.`, { amount_vnd: ['Vượt credit còn lại.'] });
    const r = await tx.creditRefund.create({
      data: {
        workspaceId: user.workspaceId,
        tenancyId: credit.tenancyId,
        creditInvoiceId: credit.id,
        amountVnd: BigInt(input.amount_vnd),
        paidAt: toDbDate(input.paid_at),
        method: input.method,
        reference: input.reference,
        createdBy: user.id,
      },
    });
    await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'credit.refund', entityType: 'credit_refund', entityId: r.id, after: input });
    return r;
  }

  async reverseRefund(user: AuthUser, id: string, reason: string, key: string | undefined) {
    const r = await this.prisma.creditRefund.findFirst({ where: { id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } } });
    if (!r) throw new AppError('NOT_FOUND');
    return this.idempotency.execute({ user, route: `POST /credit-refunds/${id}/reverse`, key, payload: { reason } }, async (tx) => {
      await lockRows(tx, 'tenancies', [r.tenancyId]);
      await lockRows(tx, 'invoices', [r.creditInvoiceId]);
      await lockRows(tx, 'credit_refunds', [id]);
      const cur = await tx.creditRefund.findUniqueOrThrow({ where: { id } });
      if (cur.status === 'REVERSED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Khoản hoàn đã được đảo.');
      await tx.creditRefund.update({ where: { id }, data: { status: 'REVERSED', reversedAt: this.clock.now(), reversedBy: user.id, reversalReason: reason } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'credit.reverse_refund', entityType: 'credit_refund', entityId: id, reason });
      for (const o of this.observers) await o.afterReversal(tx, user, r.tenancyId, 'CREDIT_REFUND', id, reason);
      return { body: { ok: true as const }, resultReference: id };
    });
  }

  private async creditInvoice(user: AuthUser, id: string): Promise<Invoice> {
    const inv = await this.prisma.invoice.findFirst({ where: { id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } } });
    if (!inv) throw new AppError('NOT_FOUND');
    if (inv.type !== 'CREDIT_ADJUSTMENT' || inv.lifecycle !== 'PUBLISHED') {
      throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ dùng được chứng từ credit đã phát hành.', { credit_invoice_id: ['Không phải chứng từ credit.'] });
    }
    return inv;
  }
}

