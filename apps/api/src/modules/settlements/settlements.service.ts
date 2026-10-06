import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type BlockingError,
  type Paged,
  type settlementCashSchema,
  type SettlementDto,
  type settlementInputSchema,
  type settlementListQuerySchema,
  type SettlementPreview,
  type settlementUpdateSchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { nextSequence, yymm } from '../../common/db/sequences.js';
import { day, iso, naturalCompare, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { subtotal } from '../../domain/billing/reconcile.js';
import { contractStatus } from '../../domain/contracts/contract-status.js';
import { addDays, type DateOnly, firstDayOfMonth, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import { type Invoice, type InvoiceType, type MoveOutSettlement, Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { ChargeCalculator, type ComputedLine, type ExtraCharge, finalCutoff, toItemData } from '../billing/charges.js';
import { toDates } from '../contracts/contracts.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { LedgersService } from '../ledgers/ledgers.service.js';
import { InvoiceBalances } from '../payments/balances.js';
import { CreditsService } from '../payments/credits.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { MetersService } from '../utilities/meters.service.js';
import { userNames } from '../utilities/user-names.js';

type Input = z.output<typeof settlementInputSchema>;

const include = {
  tenancy: {
    include: {
      room: { include: { building: true } },
      members: { where: { role: 'PRIMARY' as const }, include: { tenant: { select: { fullName: true } } }, orderBy: { joinedOn: 'desc' as const } },
    },
  },
  items: { orderBy: { createdAt: 'asc' as const } },
  transactions: { orderBy: { createdAt: 'asc' as const } },
  events: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.MoveOutSettlementInclude;
type SettlementFull = Prisma.MoveOutSettlementGetPayload<{ include: typeof include }>;

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const NUMBER_PREFIX: Partial<Record<InvoiceType, string>> = { FINAL: 'TT', CREDIT_ADJUSTMENT: 'DCG' };
const CHARGE_LABEL = { DAMAGE: 'Hư hỏng', PENALTY: 'Phạt', OTHER: 'Phí khác' } as const;

interface Computed {
  preview: SettlementPreview;
  lines: ComputedLine[];
  debts: (Invoice & { remaining: bigint })[];
  credits: (Invoice & { available: bigint })[];
  drafts: Invoice[];
}

/**
 * Trả phòng và quyết toán (MASTER_PLAN 5.5, 7.6, 9.4): DRAFT → APPROVED → COMPLETED. Duyệt chốt snapshot và input_hash;
 * dữ liệu đổi sau khi duyệt → 409 STALE. Hoàn tất trong một transaction, cần Idempotency-Key. Tiền hoàn/thu thực tế ghi
 * riêng khi thực chi/nhận; chưa ghi thì tình trạng là RECEIVABLE/REFUND_PAYABLE (không ghi tiền giả để cân bằng).
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly calc: ChargeCalculator,
    private readonly balances: InvoiceBalances,
    private readonly ledgers: LedgersService,
    private readonly meters: MetersService,
    private readonly payments: PaymentsService,
    private readonly credits: CreditsService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ Tạo / sửa nháp

  async create(user: AuthUser, tenancyId: string, input: Input): Promise<SettlementDto> {
    const id = await runInTransaction(this.prisma, async (tx) => {
      const t0 = await this.tenancyInScope(tx, user, tenancyId);
      await lockRows(tx, 'rooms', [t0.roomId]);
      await lockRows(tx, 'tenancies', [tenancyId]);
      const t = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
      if (t.status !== 'ACTIVE' && t.status !== 'NOTICE_GIVEN') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê đang trả phòng hoặc đã kết thúc.');
      this.validateDates(t.startDate, input.last_charge_date);
      const live = await tx.moveOutSettlement.findFirst({ where: { tenancyId, status: { not: 'CANCELLED' } } });
      if (live) throw new AppError('CONFLICT', 'Lần thuê đã có quyết toán chưa hủy.');
      const today = this.clock.today();
      const code = `QT${yymm(today)}-${String(await nextSequence(tx, user.workspaceId, 'SETTLEMENT', yymm(today))).padStart(4, '0')}`;
      const s = await tx.moveOutSettlement.create({ data: { workspaceId: user.workspaceId, tenancyId, code, createdBy: user.id, ...this.fields(input) } });
      await this.writeInputs(tx, user, s.id, t.id, t.roomId, input);
      await tx.tenancy.update({ where: { id: tenancyId }, data: { status: 'MOVE_OUT_PROCESSING', version: { increment: 1 } } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'settlement.create', entityType: 'settlement', entityId: s.id, after: input });
      return s.id;
    });
    return this.get(user, id);
  }

  /** Sửa nháp; sửa quyết toán đã duyệt đưa nó về nháp (phải xem trước và duyệt lại). */
  async update(user: AuthUser, id: string, input: z.output<typeof settlementUpdateSchema>): Promise<SettlementDto> {
    const head = await this.row(this.prisma, user, id);
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'rooms', [head.tenancy.roomId]);
      await lockRows(tx, 'tenancies', [head.tenancyId]);
      const s = await tx.moveOutSettlement.findUniqueOrThrow({ where: { id } });
      if (s.status !== 'DRAFT' && s.status !== 'APPROVED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ sửa được quyết toán chưa hoàn tất.');
      if (s.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      this.validateDates(head.tenancy.startDate, input.last_charge_date);
      const { expected_version: _v, ...data } = input;
      await tx.moveOutSettlement.update({
        where: { id },
        data: { ...this.fields(data), status: 'DRAFT', approvedBy: null, approvedAt: null, inputHash: null, approvedSnapshot: Prisma.DbNull, version: { increment: 1 } },
      });
      await tx.settlementItem.deleteMany({ where: { settlementId: id } });
      await this.writeInputs(tx, user, id, head.tenancyId, head.tenancy.roomId, data);
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'settlement.update', entityType: 'settlement', entityId: id, after: data });
    });
    return this.get(user, id);
  }

  async preview(user: AuthUser, id: string): Promise<SettlementPreview> {
    const s = await this.row(this.prisma, user, id);
    return (await this.compute(this.prisma, s)).preview;
  }

  /** Duyệt: chốt snapshot và input_hash người duyệt đã xem; bị chặn khi còn hợp đồng ký chưa bắt đầu (T44) hoặc thiếu dữ liệu. */
  async approve(user: AuthUser, id: string, input: { expected_version: number; input_hash: string }): Promise<SettlementDto> {
    const head = await this.row(this.prisma, user, id);
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [head.tenancyId]);
      const s = await this.row(tx, user, id);
      if (s.status !== 'DRAFT') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ duyệt được quyết toán nháp.');
      if (s.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      const c = await this.compute(tx, s);
      if (c.preview.input_hash !== input.input_hash) throw new AppError('STALE', 'Số liệu đã đổi sau khi bạn xem trước. Hãy xem trước lại rồi duyệt.');
      if (c.preview.blocking.length) throw new AppError('BUSINESS_RULE_VIOLATION', `Chưa duyệt được: ${c.preview.blocking.map((b) => b.message).join(' ')}`);
      await tx.moveOutSettlement.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedBy: user.id,
          approvedAt: this.clock.now(),
          inputHash: c.preview.input_hash,
          approvedSnapshot: c.preview as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      // Dòng trình bày số dư lúc duyệt (không phải chứng từ mới cho cùng khoản nợ — 9.4).
      await tx.settlementItem.deleteMany({ where: { settlementId: id, kind: { in: ['INVOICE_BALANCE', 'CREDIT_BALANCE'] } } });
      const rows = [
        ...c.debts.filter((d) => d.remaining > 0n).map((d) => ({ settlementId: id, kind: 'INVOICE_BALANCE' as const, sourceInvoiceId: d.id, amountVnd: d.remaining, reason: `Còn nợ ${d.number}` })),
        ...c.credits.filter((d) => d.available > 0n).map((d) => ({ settlementId: id, kind: 'CREDIT_BALANCE' as const, sourceInvoiceId: d.id, amountVnd: d.available, reason: `Credit ${d.number}` })),
      ];
      if (rows.length) await tx.settlementItem.createMany({ data: rows });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'settlement.approve', entityType: 'settlement', entityId: id, after: { input_hash: c.preview.input_hash } });
    });
    return this.get(user, id);
  }

  /**
   * Hoàn tất (7.6 bước 7) trong một transaction: hủy nháp, phát hành FINAL/CREDIT_ADJUSTMENT, cấn trừ credit, áp cọc đã duyệt,
   * kết thúc lần thuê, hoàn tất báo trả, đổi trạng thái phòng. Dữ liệu đổi sau khi duyệt → 409 STALE (T28). Gọi lại cùng key → kết quả cũ (T26).
   */
  async complete(user: AuthUser, id: string, expectedVersion: number, key: string | undefined) {
    const head = await this.row(this.prisma, user, id);
    const r = await this.idempotency.execute({ user, route: `POST /settlements/${id}/complete`, key, payload: { expected_version: expectedVersion } }, async (tx) => {
      await lockRows(tx, 'rooms', [head.tenancy.roomId]);
      await lockRows(tx, 'tenancies', [head.tenancyId]);
      const tenancyInvoices = await tx.invoice.findMany({ where: { tenancyId: head.tenancyId }, select: { id: true } });
      await lockRows(tx, 'invoices', tenancyInvoices.map((i) => i.id));
      const s = await this.row(tx, user, id);
      if (s.status !== 'APPROVED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ hoàn tất được quyết toán đã duyệt.');
      if (s.version !== expectedVersion) throw new AppError('VERSION_CONFLICT');
      const today = this.clock.today();
      if (day(s.lastChargeDate) > today) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chưa tới ngày cuối tính tiền; hoàn tất khi khách đã bàn giao.');
      const c = await this.compute(tx, s);
      if (c.preview.input_hash !== s.inputHash) {
        throw new AppError('STALE', 'Thanh toán, giá, chỉ số hoặc thông báo đã thay đổi sau khi duyệt. Hãy xem trước và duyệt lại.');
      }
      if (c.preview.blocking.length) throw new AppError('BUSINESS_RULE_VIOLATION', c.preview.blocking.map((b) => b.message).join(' '));
      const now = this.clock.now();
      const last = day(s.lastChargeDate);
      const endEx = addDays(last, 1);

      // 1. Hủy nháp đang mở — FINAL bao trùm.
      for (const d of c.drafts) {
        await tx.invoice.update({
          where: { id: d.id },
          data: { lifecycle: 'CANCELLED', cancelledAt: now, cancelledBy: user.id, cancelReason: `Hủy do trả phòng (${s.code}): thông báo cuối bao trùm`, version: { increment: 1 } },
        });
      }
      // 2. Phát hành FINAL (dòng DEBIT) và CREDIT_ADJUSTMENT (dòng CREDIT).
      const debitLines = c.lines.filter((l) => l.direction === 'DEBIT');
      const creditLines = c.lines.filter((l) => l.direction === 'CREDIT');
      const monthKey = firstDayOfMonth(last);
      let finalId: string | null = null;
      if (debitLines.length) {
        const total = subtotal(debitLines);
        const fin = await tx.invoice.create({
          data: {
            workspaceId: s.workspaceId,
            tenancyId: s.tenancyId,
            type: 'FINAL',
            lifecycle: 'PUBLISHED',
            number: await this.number(tx, s.workspaceId, 'FINAL', monthKey),
            issueDate: toDbDate(today),
            dueDate: toDbDate(today),
            subtotalVnd: total,
            totalVnd: total,
            publishedAt: now,
            publishedBy: user.id,
            createdBy: user.id,
          },
        });
        await tx.invoiceItem.createMany({ data: debitLines.map((l, i) => toItemData(l, fin.id, i)) });
        finalId = fin.id;
      }
      let creditId: string | null = null;
      if (creditLines.length) {
        const total = creditLines.reduce((a, l) => a + l.amount, 0n);
        const source = finalId ?? (await tx.invoice.findFirst({ where: { tenancyId: s.tenancyId, lifecycle: 'PUBLISHED', type: { not: 'CREDIT_ADJUSTMENT' } }, orderBy: { publishedAt: 'desc' } }))?.id;
        if (!source) throw new AppError('BUSINESS_RULE_VIOLATION', 'Không tìm thấy chứng từ gốc cho khoản điều chỉnh giảm.');
        const cr = await tx.invoice.create({
          data: {
            workspaceId: s.workspaceId,
            tenancyId: s.tenancyId,
            type: 'CREDIT_ADJUSTMENT',
            lifecycle: 'PUBLISHED',
            number: await this.number(tx, s.workspaceId, 'CREDIT_ADJUSTMENT', monthKey),
            issueDate: toDbDate(today),
            dueDate: toDbDate(today),
            subtotalVnd: total,
            totalVnd: total,
            sourceInvoiceId: source,
            publishedAt: now,
            publishedBy: user.id,
            createdBy: user.id,
          },
        });
        await tx.invoiceItem.createMany({ data: creditLines.map((l, i) => toItemData(l, cr.id, i)) });
        creditId = cr.id;
      }
      const links: { kind: 'CREDIT_APPLICATION' | 'DEPOSIT_APPLICATION'; linkedId: string }[] = [];

      // 3. Cấn trừ credit vào nợ (đến hạn sớm nhất trước) — 9.4 bước 4.
      const debts = await this.openDebts(tx, s.tenancyId);
      const credits = await this.openCredits(tx, s.tenancyId);
      for (const cr of credits) {
        for (const d of debts) {
          const take = min(cr.available, d.remaining);
          if (take <= 0n) continue;
          const app = await tx.creditApplication.create({
            data: { workspaceId: s.workspaceId, tenancyId: s.tenancyId, creditInvoiceId: cr.id, targetInvoiceId: d.id, amountVnd: take, createdBy: user.id },
          });
          links.push({ kind: 'CREDIT_APPLICATION', linkedId: app.id });
          cr.available -= take;
          d.remaining -= take;
        }
      }
      // 4. Áp cọc theo phê duyệt — 9.4 bước 7.
      let depositLeft = BigInt(c.preview.deposit_applied_vnd);
      if (depositLeft > 0n) {
        const allocations: { invoiceId: string; amountVnd: bigint }[] = [];
        for (const d of debts) {
          const take = min(depositLeft, d.remaining);
          if (take <= 0n) continue;
          allocations.push({ invoiceId: d.id, amountVnd: take });
          depositLeft -= take;
          d.remaining -= take;
        }
        const applied = allocations.reduce((a, x) => a + x.amountVnd, 0n);
        if (applied > 0n) {
          const dep = await tx.depositTransaction.create({
            data: {
              workspaceId: s.workspaceId,
              tenancyId: s.tenancyId,
              type: 'APPLIED_TO_INVOICE',
              amountVnd: applied,
              reason: `Áp cọc vào nợ khi trả phòng (${s.code})`,
              settlementId: s.id,
              targetInvoiceId: allocations[0]!.invoiceId,
              paidAt: toDbDate(today),
              createdBy: user.id,
              allocations: { create: allocations },
            },
          });
          links.push({ kind: 'DEPOSIT_APPLICATION', linkedId: dep.id });
          await this.ledgers.assertNonNegativeDeposit(tx, s.tenancyId);
        }
      }
      if (links.length) await tx.settlementTransaction.createMany({ data: links.map((l) => ({ settlementId: s.id, ...l })) });

      // 5. Kết thúc lần thuê, hợp đồng, thành viên, báo trả, phòng.
      await tx.tenancy.update({
        where: { id: s.tenancyId },
        data: { status: 'ENDED', actualMoveOutDate: toDbDate(last), chargeEndExclusive: toDbDate(endEx), version: { increment: 1 } },
      });
      await tx.contract.updateMany({
        where: { tenancyId: s.tenancyId, lifecycle: 'SIGNED', terminatedOn: null, termStart: { lte: toDbDate(last) }, termEnd: { gt: toDbDate(last) } },
        data: { terminatedOn: toDbDate(endEx) },
      });
      await tx.tenancyTenant.updateMany({ where: { tenancyId: s.tenancyId, leftOnExclusive: null }, data: { leftOnExclusive: toDbDate(endEx) } });
      await tx.moveOutNotice.updateMany({ where: { tenancyId: s.tenancyId, status: 'ACTIVE' }, data: { status: 'FULFILLED' } });
      await tx.room.update({ where: { id: head.tenancy.roomId }, data: { operationalStatus: s.destinationRoomStatus, version: { increment: 1 } } });
      await tx.moveOutSettlement.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: now, completedBy: user.id, finalInvoiceId: finalId, creditInvoiceId: creditId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        workspaceId: s.workspaceId,
        actorId: user.id,
        action: 'settlement.complete',
        entityType: 'settlement',
        entityId: id,
        after: { final_invoice_id: finalId, credit_invoice_id: creditId, links, last_charge_date: last },
      });
      return { body: { id }, resultReference: id };
    });
    return { status: r.status, body: await this.get(user, id) };
  }

  async cancel(user: AuthUser, id: string, reason: string, expectedVersion: number): Promise<SettlementDto> {
    const head = await this.row(this.prisma, user, id);
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [head.tenancyId]);
      const s = await tx.moveOutSettlement.findUniqueOrThrow({ where: { id } });
      if (s.status !== 'DRAFT' && s.status !== 'APPROVED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ hủy được quyết toán chưa hoàn tất.');
      if (s.version !== expectedVersion) throw new AppError('VERSION_CONFLICT');
      await tx.moveOutSettlement.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: this.clock.now(), cancelledBy: user.id, cancelReason: reason, version: { increment: 1 } } });
      const notice = await tx.moveOutNotice.findFirst({ where: { tenancyId: s.tenancyId, status: 'ACTIVE' } });
      await tx.tenancy.update({ where: { id: s.tenancyId }, data: { status: notice ? 'NOTICE_GIVEN' : 'ACTIVE', version: { increment: 1 } } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'settlement.cancel', entityType: 'settlement', entityId: id, reason });
    });
    return this.get(user, id);
  }

  // ------------------------------------------------------------------ Thu/hoàn sau quyết toán

  /** Thu khoản khách còn nợ: phân bổ vào các thông báo còn nợ, đến hạn sớm nhất trước. */
  async receipt(user: AuthUser, id: string, input: z.output<typeof settlementCashSchema>, key: string | undefined) {
    const s = await this.row(this.prisma, user, id);
    return this.cash(user, s, 'receipts', input, key, async (tx) => {
      const debts = await this.openDebts(tx, s.tenancyId);
      let left = BigInt(input.amount_vnd);
      const allocations: { invoice_id: string; amount_vnd: string }[] = [];
      for (const d of debts) {
        const take = min(left, d.remaining);
        if (take <= 0n) continue;
        allocations.push({ invoice_id: d.id, amount_vnd: take.toString() });
        left -= take;
      }
      if (left > 0n || !allocations.length) throw new AppError('BUSINESS_RULE_VIOLATION', 'Số tiền vượt số khách còn nợ.', { amount_vnd: ['Vượt số còn nợ.'] });
      const p = await this.payments.createInTx(tx, user, { tenancy_id: s.tenancyId, ...input, note: `Thu nợ trả phòng ${s.code}`, allocations });
      return { kind: 'RECEIPT' as const, linkedId: p.id };
    });
  }

  /** Hoàn tiền dư (credit) khi đã thực chi; không dùng sổ cọc. */
  async creditRefund(user: AuthUser, id: string, input: z.output<typeof settlementCashSchema>, key: string | undefined) {
    const s = await this.row(this.prisma, user, id);
    return this.cash(user, s, 'credit-refunds', input, key, async (tx) => {
      const credits = await this.openCredits(tx, s.tenancyId);
      const total = credits.reduce((a, c) => a + c.available, 0n);
      if (BigInt(input.amount_vnd) > total) throw new AppError('BUSINESS_RULE_VIOLATION', `Tiền dư còn phải hoàn chỉ ${total.toString()}đ.`, { amount_vnd: ['Vượt số phải hoàn.'] });
      const cr = credits.find((c) => c.available >= BigInt(input.amount_vnd));
      if (!cr) throw new AppError('BUSINESS_RULE_VIOLATION', 'Hãy hoàn theo từng chứng từ credit (số tiền vượt credit của một chứng từ).');
      const r = await this.credits.refundInTx(tx, user, cr, { credit_invoice_id: cr.id, ...input });
      return { kind: 'CREDIT_REFUND' as const, linkedId: r.id };
    });
  }

  /** Hoàn cọc khi đã thực chi (REFUND trong sổ cọc, liên kết quyết toán). */
  async depositRefund(user: AuthUser, id: string, input: z.output<typeof settlementCashSchema>, key: string | undefined) {
    const s = await this.row(this.prisma, user, id);
    return this.cash(user, s, 'deposit-refunds', input, key, async (tx) => {
      const d = await this.ledgers.createDepositInTx(tx, user, s.tenancyId, { type: 'REFUND', ...input, reason: `Hoàn cọc khi trả phòng ${s.code}` }, s.id);
      return { kind: 'DEPOSIT_REFUND' as const, linkedId: d.id };
    });
  }

  private async cash(
    user: AuthUser,
    s: SettlementFull,
    route: string,
    input: unknown,
    key: string | undefined,
    fn: (tx: Prisma.TransactionClient) => Promise<{ kind: 'RECEIPT' | 'CREDIT_REFUND' | 'DEPOSIT_REFUND'; linkedId: string }>,
  ) {
    if (s.status !== 'COMPLETED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Ghi thu/hoàn theo quyết toán sau khi đã hoàn tất.');
    const r = await this.idempotency.execute({ user, route: `POST /settlements/${s.id}/${route}`, key, payload: input, successStatus: 201 }, async (tx) => {
      const link = await fn(tx);
      await tx.settlementTransaction.create({ data: { settlementId: s.id, ...link } });
      return { body: { id: s.id }, resultReference: link.linkedId };
    });
    return { status: r.status, body: await this.get(user, s.id) };
  }

  // ------------------------------------------------------------------ Đọc

  async list(user: AuthUser, q: z.output<typeof settlementListQuerySchema>): Promise<Paged<SettlementDto>> {
    const rows = await this.prisma.moveOutSettlement.findMany({
      where: {
        workspaceId: user.workspaceId,
        tenancy: { room: { ...this.rooms.roomWhere(user), ...(q.building_id ? { buildingId: q.building_id } : {}) } },
        ...(q.status ? { status: q.status } : {}),
      },
      include,
      orderBy: { createdAt: 'desc' },
    });
    let items = await this.dtos(rows);
    if (q.financial_status) items = items.filter((i) => i.status === 'COMPLETED' && i.current.financial_status === q.financial_status);
    items.sort((a, b) => (a.status === b.status ? naturalCompare(a.room_code, b.room_code) : a.status === 'COMPLETED' ? 1 : -1));
    return paged(items, q.page, q.page_size);
  }

  async get(user: AuthUser, id: string): Promise<SettlementDto> {
    return (await this.dtos([await this.row(this.prisma, user, id)]))[0]!;
  }

  async forTenancy(user: AuthUser, tenancyId: string): Promise<SettlementDto[]> {
    await this.tenancyInScope(this.prisma, user, tenancyId);
    return this.dtos(await this.prisma.moveOutSettlement.findMany({ where: { tenancyId }, include, orderBy: { createdAt: 'desc' } }));
  }

  // ------------------------------------------------------------------ Tính toán (9.4)

  private async compute(db: Db, s: MoveOutSettlement & { tenancy: { roomId: string } }): Promise<Computed> {
    const last = day(s.lastChargeDate);
    const endEx = addDays(last, 1);
    const data = await this.calc.load(db, s.tenancyId);
    data.tenancy = { ...data.tenancy, chargeEndExclusive: toDbDate(endEx) };
    const items = await db.settlementItem.findMany({ where: { settlementId: s.id, kind: { in: ['DAMAGE', 'PENALTY', 'OTHER'] } }, orderBy: { createdAt: 'asc' } });
    const extras: ExtraCharge[] = items.map((i) => ({ id: i.id, kind: i.kind === 'DAMAGE' ? 'DAMAGE' : 'OTHER', label: `${CHARGE_LABEL[i.kind as keyof typeof CHARGE_LABEL]}: ${i.reason}`, amount: i.amountVnd }));
    const result = this.calc.compute(data, finalCutoff(last, extras));
    const blocking: BlockingError[] = [...result.errors];
    const warnings: string[] = [];

    const drafts = await db.invoice.findMany({ where: { tenancyId: s.tenancyId, lifecycle: 'DRAFT' }, include: { statementPeriod: true } });
    const debts = await this.openDebts(db, s.tenancyId);
    const credits = await this.openCredits(db, s.tenancyId);
    const finalDebit = result.lines.filter((l) => l.direction === 'DEBIT').reduce((a, l) => a + l.amount, 0n);
    const finalCredit = result.lines.filter((l) => l.direction === 'CREDIT').reduce((a, l) => a + l.amount, 0n);
    const debt = debts.reduce((a, d) => a + d.remaining, 0n) + finalDebit;
    const credit = credits.reduce((a, c) => a + c.available, 0n) + finalCredit;
    const creditApplied = min(credit, debt);
    const debtAfterCredit = debt - creditApplied;
    const depositAvailable = await this.ledgers.depositHeld(db, s.tenancyId);
    const depositMax = min(depositAvailable, debtAfterCredit);
    const depositApplied = s.depositToApplyVnd ?? depositMax;
    if (depositApplied > depositMax) blocking.push({ code: 'DEPOSIT_TOO_HIGH', message: `Số cọc áp vượt mức tối đa ${depositMax.toString()}đ.` });

    // Hợp đồng SIGNED chưa bắt đầu tính tới ngày cuối: phải hủy có lý do trước khi duyệt (T44).
    const contracts = await db.contract.findMany({ where: { tenancyId: s.tenancyId, lifecycle: 'SIGNED', terminatedOn: null } });
    const unstarted = contracts.filter((c) => day(c.termStart) > last);
    for (const c of unstarted) blocking.push({ code: 'UNSTARTED_CONTRACT', message: `Hợp đồng ${c.code} đã ký, bắt đầu ${day(c.termStart)} — hủy có lý do trước khi duyệt.` });
    const active = contracts.find((c) => contractStatus(toDates(c), last) === 'ACTIVE');
    if (active && day(active.termEnd) > last) warnings.push(`Trả trước hạn hợp đồng ${active.code} (hết hạn ${day(active.termEnd)}). Không tự tịch thu cọc; khấu trừ (nếu có) phải nhập thành khoản phí có lý do.`);
    const notice = await db.moveOutNotice.findFirst({ where: { tenancyId: s.tenancyId, status: 'ACTIVE' } });
    const tenancy = data.tenancy;
    if (!notice) warnings.push('Chưa có báo trả trước.');
    else {
      const given = Math.round((Date.parse(last) - Date.parse(day(notice.noticeDate))) / 86_400_000) + 1;
      if (given < tenancy.noticeDaysSnapshot) warnings.push(`Báo trước ${given} ngày, ít hơn ${tenancy.noticeDaysSnapshot} ngày theo thỏa thuận.`);
    }
    if (last > this.clock.today()) warnings.push('Ngày cuối tính tiền ở tương lai: chỉ hoàn tất được từ ngày đó.');
    // Chỉ số cuối kỳ hoặc lý do miễn; kiểm kê tài sản.
    const activeMeters = await db.meter.findMany({ where: { roomId: s.tenancy.roomId, retiredOn: null } });
    const finals = await db.meterReading.findMany({ where: { tenancyId: s.tenancyId, kind: 'FINAL' } });
    const missing = activeMeters.filter((m) => !finals.some((f) => f.meterId === m.id));
    if (missing.length && !s.finalReadingWaiver) blocking.push({ code: 'MISSING_FINAL_READING', message: 'Thiếu chỉ số cuối kỳ (hoặc lý do miễn).' });
    if (!s.inventoryNote) blocking.push({ code: 'MISSING_INVENTORY', message: 'Chưa ghi kiểm kê tài sản khi bàn giao.' });

    const preview: Omit<SettlementPreview, 'input_hash'> = {
      final_lines: result.lines.map(lineDto),
      final_debit_vnd: finalDebit.toString(),
      final_credit_vnd: finalCredit.toString(),
      drafts_to_cancel: drafts.map((d) => ({ id: d.id, period: d.statementPeriod ? fromDbDate(d.statementPeriod.monthStart).slice(0, 7) : null, total_vnd: d.totalVnd.toString() })),
      old_debts: debts.filter((d) => d.remaining > 0n).map((d) => ({ invoice_id: d.id, number: d.number, due_date: day(d.dueDate), remaining_vnd: d.remaining.toString() })),
      credits: credits.filter((c) => c.available > 0n).map((c) => ({ invoice_id: c.id, number: c.number, available_vnd: c.available.toString() })),
      debt_vnd: debt.toString(),
      credit_vnd: credit.toString(),
      credit_applied_vnd: creditApplied.toString(),
      debt_after_credit_vnd: debtAfterCredit.toString(),
      deposit_available_vnd: depositAvailable.toString(),
      deposit_max_vnd: depositMax.toString(),
      deposit_applied_vnd: depositApplied.toString(),
      customer_receivable_vnd: (debtAfterCredit - depositApplied).toString(),
      credit_refund_payable_vnd: (credit - creditApplied).toString(),
      deposit_refund_payable_vnd: (depositAvailable - depositApplied).toString(),
      unstarted_contracts: unstarted.map((c) => ({ id: c.id, code: c.code, term_start: day(c.termStart) })),
      blocking,
      warnings,
    };
    const hashInput = { preview, inputs: { last, room: s.destinationRoomStatus, deposit: s.depositToApplyVnd?.toString() ?? null, waiver: s.finalReadingWaiver, inventory: s.inventoryNote } };
    const inputHash = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex').slice(0, 32);
    return { preview: { ...preview, input_hash: inputHash }, lines: result.lines, debts, credits, drafts };
  }

  private async openDebts(db: Db, tenancyId: string) {
    const invs = await db.invoice.findMany({ where: { tenancyId, lifecycle: 'PUBLISHED', type: { not: 'CREDIT_ADJUSTMENT' } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
    const rem = await this.balances.remaining(db, invs);
    return invs.map((i) => ({ ...i, remaining: rem.get(i.id) ?? 0n }));
  }

  private async openCredits(db: Db, tenancyId: string) {
    const invs = await db.invoice.findMany({ where: { tenancyId, lifecycle: 'PUBLISHED', type: 'CREDIT_ADJUSTMENT' }, orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }] });
    const rem = await this.balances.remaining(db, invs);
    return invs.map((i) => ({ ...i, available: rem.get(i.id) ?? 0n }));
  }

  // ------------------------------------------------------------------ Hỗ trợ

  private validateDates(start: Date, last: DateOnly) {
    if (last < fromDbDate(start)) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày cuối tính tiền trước ngày nhận phòng.', { last_charge_date: ['Trước ngày nhận phòng.'] });
  }

  private fields(input: Omit<Input, 'final_readings' | 'charges'>) {
    return {
      lastChargeDate: toDbDate(input.last_charge_date),
      chargeEndExclusive: toDbDate(addDays(input.last_charge_date, 1)),
      destinationRoomStatus: input.destination_room_status,
      handoverBy: input.handover_by,
      inventoryNote: input.inventory_note,
      finalReadingWaiver: input.final_reading_waiver,
      depositToApplyVnd: input.deposit_to_apply_vnd === null ? null : BigInt(input.deposit_to_apply_vnd),
      note: input.note,
    };
  }

  private async writeInputs(tx: Prisma.TransactionClient, user: AuthUser, settlementId: string, tenancyId: string, roomId: string, input: Input) {
    if (input.charges.length) {
      await tx.settlementItem.createMany({ data: input.charges.map((c) => ({ settlementId, kind: c.kind, amountVnd: BigInt(c.amount_vnd), reason: c.reason })) });
    }
    await this.meters.setFinalReadingsInTx(tx, user, tenancyId, roomId, input.last_charge_date, input.final_readings);
  }

  private async number(tx: Prisma.TransactionClient, workspaceId: string, type: InvoiceType, monthKey: DateOnly) {
    const yyyymm = monthKey.slice(0, 7).replace('-', '');
    const seq = await nextSequence(tx, workspaceId, `INVOICE_${type}`, yyyymm);
    return `${NUMBER_PREFIX[type]}-${yyyymm}-${String(seq).padStart(4, '0')}`;
  }

  private async tenancyInScope(db: Db, user: AuthUser, id: string) {
    const t = await db.tenancy.findFirst({ where: { id, room: this.rooms.roomWhere(user) } });
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  private async row(db: Db, user: AuthUser, id: string): Promise<SettlementFull> {
    const s = await db.moveOutSettlement.findFirst({ where: { id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } }, include });
    if (!s) throw new AppError('NOT_FOUND');
    return s;
  }

  private async dtos(rows: SettlementFull[]): Promise<SettlementDto[]> {
    const names = await userNames(this.prisma, rows.flatMap((r) => [r.approvedBy, ...r.events.map((e) => e.createdBy)]));
    const out: SettlementDto[] = [];
    for (const s of rows) {
      const finals = await this.prisma.meterReading.findMany({ where: { tenancyId: s.tenancyId, kind: 'FINAL' }, include: { meter: true } });
      const prev = new Map<string, string | null>();
      for (const f of finals) {
        const p = await this.prisma.meterReading.findFirst({ where: { meterId: f.meterId, readOn: { lt: f.readOn } }, orderBy: { readOn: 'desc' } });
        prev.set(f.id, p ? p.value.toString() : f.meter.initialReading.toString());
      }
      const debts = await this.openDebts(this.prisma, s.tenancyId);
      const credits = await this.openCredits(this.prisma, s.tenancyId);
      const receivable = debts.reduce((a, d) => a + d.remaining, 0n);
      const creditRefund = credits.reduce((a, c) => a + c.available, 0n);
      const depositRefund = s.status === 'COMPLETED' ? await this.ledgers.depositHeld(this.prisma, s.tenancyId) : 0n;
      out.push({
        id: s.id,
        code: s.code,
        tenancy_id: s.tenancyId,
        tenancy_code: s.tenancy.code,
        room_id: s.tenancy.roomId,
        room_code: s.tenancy.room.code,
        building_code: s.tenancy.room.building.code,
        building_name: s.tenancy.room.building.name,
        primary_tenant_name: s.tenancy.members[0]?.tenant.fullName ?? null,
        status: s.status,
        last_charge_date: day(s.lastChargeDate),
        destination_room_status: s.destinationRoomStatus,
        handover_by: s.handoverBy,
        inventory_note: s.inventoryNote,
        final_reading_waiver: s.finalReadingWaiver,
        final_readings: finals.map((f) => ({ meter_id: f.meterId, meter_type: f.meter.type, value: f.value.toString(), previous_value: prev.get(f.id) ?? null })),
        charges: s.items
          .filter((i) => i.kind === 'DAMAGE' || i.kind === 'PENALTY' || i.kind === 'OTHER')
          .map((i) => ({ id: i.id, kind: i.kind as 'DAMAGE' | 'PENALTY' | 'OTHER', amount_vnd: i.amountVnd.toString(), reason: i.reason })),
        deposit_to_apply_vnd: s.depositToApplyVnd?.toString() ?? null,
        note: s.note,
        approved_by_name: s.approvedBy ? (names.get(s.approvedBy) ?? null) : null,
        approved_at: iso(s.approvedAt),
        completed_at: iso(s.completedAt),
        cancel_reason: s.cancelReason,
        input_hash: s.inputHash,
        approved_snapshot: (s.approvedSnapshot as SettlementPreview | null) ?? null,
        current: {
          financial_status: receivable > 0n ? 'RECEIVABLE' : creditRefund > 0n || depositRefund > 0n ? 'REFUND_PAYABLE' : 'BALANCED',
          receivable_vnd: receivable.toString(),
          credit_refund_payable_vnd: creditRefund.toString(),
          deposit_refund_payable_vnd: depositRefund.toString(),
        },
        final_invoice_id: s.finalInvoiceId,
        credit_invoice_id: s.creditInvoiceId,
        transactions: s.transactions.map((t) => ({ kind: t.kind, linked_id: t.linkedId, created_at: iso(t.createdAt)! })),
        events: s.events.map((e) => ({
          kind: e.kind,
          linked_entity_type: e.linkedEntityType,
          linked_entity_id: e.linkedEntityId,
          note: e.note,
          created_by_name: names.get(e.createdBy) ?? null,
          created_at: iso(e.createdAt)!,
        })),
        version: s.version,
      });
    }
    return out;
  }
}

function lineDto(l: ComputedLine) {
  return {
    id: null,
    group: l.group,
    charge_kind: l.chargeKind,
    charge_timing: l.chargeTiming,
    direction: l.direction,
    label: l.label,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    amount_vnd: l.amount.toString(),
    charge_start: l.chargeStart,
    charge_end_exclusive: l.chargeEnd,
    source_key: l.sourceKey,
    unit_key: l.unitKey,
    corrects_item_id: l.correctsItemId,
  };
}

