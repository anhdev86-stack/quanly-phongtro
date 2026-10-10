import { Inject, Injectable } from '@nestjs/common';
import {
  type BillingResult,
  type billingRunSchema,
  type BlockingError,
  type invoiceAdjustSchema,
  type invoiceCancelSchema,
  type InvoiceDetail,
  type InvoiceLine,
  type invoiceListQuerySchema,
  type invoicePublishSchema,
  type InvoiceSummary,
  type Paged,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode, violatedConstraint } from '../../common/db/pg-errors.js';
import { nextSequence } from '../../common/db/sequences.js';
import { day, dayOrNull, iso, naturalCompare, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { subtotal } from '../../domain/billing/reconcile.js';
import { effectiveDueDate } from '../../domain/billing/due-date.js';
import { addMonths, type DateOnly, dayOfMonthClamped, firstDayOfMonth, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { Invoice, InvoiceItem, InvoiceType, Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { assertPeriodOpen, invoiceMonth } from './periods.service.js';
import { OPEN_TENANCY_STATUSES, RoomsService } from '../rooms/rooms.service.js';
import { ChargeCalculator, type ComputedLine, type ComputeResult, type Cutoff, monthlyCutoff, sourceHash, toItemData } from './charges.js';

/** Số tiền đã thanh toán/cấn trừ của chứng từ (Phase 6 cung cấp: payment, cọc áp vào thông báo, credit). */
export interface InvoiceSettlementProvider {
  settled(db: Db, invoiceIds: string[]): Promise<Map<string, bigint>>;
}
export const INVOICE_SETTLEMENT = Symbol('INVOICE_SETTLEMENT');

const NUMBER_PREFIX: Record<InvoiceType, string> = { MONTHLY: 'TB', FINAL: 'TT', DEBIT_ADJUSTMENT: 'DCT', CREDIT_ADJUSTMENT: 'DCG' };

const include = {
  tenancy: {
    include: {
      room: { include: { building: true } },
      members: { where: { role: 'PRIMARY' as const }, include: { tenant: { select: { fullName: true } } }, orderBy: { joinedOn: 'desc' as const } },
    },
  },
  statementPeriod: { select: { monthStart: true } },
} satisfies Prisma.InvoiceInclude;
type InvoiceFull = Prisma.InvoiceGetPayload<{ include: typeof include }>;

type TenancyRow = Prisma.TenancyGetPayload<{
  include: { room: { include: { building: true } }; members: { include: { tenant: { select: { fullName: true } } } } };
}>;

const periodOf = (monthStart: DateOnly) => monthStart.slice(0, 7);

/**
 * Thông báo tiền phòng (MASTER_PLAN 5.4, 8.6, 8.7): xem trước không ghi gì; tạo nháp idempotent theo tenancy + tháng;
 * tối đa một nháp mỗi tenancy; phát hành khóa nội dung, cấp số, tách credit nếu tổng âm (D-023).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly calc: ChargeCalculator,
    private readonly audit: AuditService,
    @Inject(INVOICE_SETTLEMENT) private readonly settlement: InvoiceSettlementProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ Xem trước / tạo nháp hàng loạt

  async preview(user: AuthUser, run: z.output<typeof billingRunSchema>): Promise<BillingResult> {
    const monthStart = `${run.period}-01`;
    const items: BillingResult['items'] = [];
    for (const t of await this.runTenancies(user, run)) {
      const base = this.resultBase(t);
      const existing = await this.prisma.invoice.findFirst({
        where: { tenancyId: t.id, type: 'MONTHLY', lifecycle: { not: 'CANCELLED' }, statementPeriod: { monthStart: toDbDate(monthStart) } },
      });
      if (existing) {
        items.push({ ...base, status: 'EXISTS', invoice_id: existing.id, subtotal_vnd: existing.subtotalVnd.toString(), errors: [], lines: [] });
        continue;
      }
      const result = this.calc.compute(await this.calc.load(this.prisma, t.id), monthlyCutoff(monthStart));
      const draft = await this.prisma.invoice.findFirst({ where: { tenancyId: t.id, lifecycle: 'DRAFT' } });
      items.push({
        ...base,
        status: draft ? 'DRAFT_PENDING' : result.errors.length ? 'BLOCKED' : 'READY',
        invoice_id: draft?.id ?? null,
        subtotal_vnd: subtotal(result.lines).toString(),
        errors: draft ? [{ code: 'DRAFT_PENDING', message: 'Còn nháp chưa phát hành của lần thuê này.' }, ...result.errors] : result.errors,
        lines: result.lines.map((l) => lineDto(l)),
      });
    }
    return { period: run.period, items };
  }

  /** Tạo nháp cho từng tenancy, mỗi tenancy một transaction; lỗi một phòng không ảnh hưởng phòng khác (8.7). */
  async generate(user: AuthUser, run: z.output<typeof billingRunSchema>): Promise<BillingResult> {
    const monthStart = `${run.period}-01`;
    const items: BillingResult['items'] = [];
    for (const t of await this.runTenancies(user, run)) {
      const base = this.resultBase(t);
      try {
        const r = await runInTransaction(this.prisma, (tx) => this.generateInTx(tx, user, t.id, monthStart));
        items.push({ ...base, status: r.status, invoice_id: r.invoice.id, subtotal_vnd: r.invoice.subtotalVnd.toString(), errors: r.errors, lines: [] });
      } catch (error) {
        const e = error instanceof AppError ? error : null;
        if (!e) throw error;
        items.push({ ...base, status: e.code === 'CONFLICT' ? 'DRAFT_PENDING' : 'ERROR', invoice_id: null, subtotal_vnd: null, errors: [{ code: e.code, message: e.message }], lines: [] });
      }
    }
    return { period: run.period, items };
  }

  /**
   * Tạo nháp thông báo tháng trong transaction có sẵn (dùng cả cho bước 8 của nhận phòng).
   * Idempotent: đã có thông báo tháng của kỳ thì trả về thông báo đó. Còn nháp khác thì báo lỗi cho tenancy này (T49).
   */
  async generateInTx(tx: Prisma.TransactionClient, user: AuthUser, tenancyId: string, monthStart: DateOnly) {
    await lockRows(tx, 'tenancies', [tenancyId]);
    const existing = await tx.invoice.findFirst({
      where: { tenancyId, type: 'MONTHLY', lifecycle: { not: 'CANCELLED' }, statementPeriod: { monthStart: toDbDate(monthStart) } },
    });
    if (existing) return { status: 'EXISTS' as const, invoice: existing, errors: [] as BlockingError[] };
    const draft = await tx.invoice.findFirst({ where: { tenancyId, lifecycle: 'DRAFT' } });
    if (draft) throw new AppError('CONFLICT', 'Còn nháp chưa phát hành của lần thuê này. Phát hành hoặc hủy nháp đó trước.');
    const tenancy = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
    if (tenancy.status === 'ENDED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê đã kết thúc.');
    const period = await tx.statementPeriod.upsert({
      where: { workspaceId_monthStart: { workspaceId: tenancy.workspaceId, monthStart: toDbDate(monthStart) } },
      update: {},
      create: { workspaceId: tenancy.workspaceId, monthStart: toDbDate(monthStart) },
    });
    await assertPeriodOpen(tx, tenancy.workspaceId, monthStart, 'tạo thông báo tháng');
    const result = this.calc.compute(await this.calc.load(tx, tenancyId), monthlyCutoff(monthStart));
    const today = this.clock.today();
    const due = effectiveDueDate(scheduledDue(tenancy, monthStart), today);
    const sub = subtotal(result.lines);
    const invoice = await this.mapUnique(() =>
      tx.invoice.create({
        data: {
          workspaceId: tenancy.workspaceId,
          tenancyId,
          statementPeriodId: period.id,
          type: 'MONTHLY',
          issueDate: toDbDate(today),
          dueDate: toDbDate(due),
          subtotalVnd: sub,
          totalVnd: sub,
          sourceHash: sourceHash(result),
          blockingErrors: result.errors as unknown as Prisma.InputJsonValue,
          createdBy: user.id,
        },
      }),
    );
    await this.writeItems(tx, invoice.id, result.lines);
    await this.audit.record(tx, {
      workspaceId: tenancy.workspaceId,
      actorId: user.id,
      action: 'invoice.generate',
      entityType: 'invoice',
      entityId: invoice.id,
      after: { period: periodOf(monthStart), subtotal_vnd: sub, lines: result.lines.length, errors: result.errors.map((e) => e.code) },
    });
    return { status: 'CREATED' as const, invoice, errors: result.errors };
  }

  // ------------------------------------------------------------------ Một nháp

  /** Tính lại nháp từ Δ hiện tại dưới khóa tenancy (8.6 quy tắc nháp 2). */
  async recalculate(user: AuthUser, id: string, expectedVersion: number) {
    const before = await this.getRow(this.prisma, user, id);
    const changed = await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [before.tenancyId]);
      await lockRows(tx, 'invoices', [id]);
      const inv = await this.getRow(tx, user, id);
      if (inv.lifecycle !== 'DRAFT') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ tính lại được thông báo nháp.');
      if (inv.version !== expectedVersion) throw new AppError('VERSION_CONFLICT');
      await assertPeriodOpen(tx, inv.workspaceId, invoiceMonth(inv), 'tính lại thông báo');
      const result = this.calc.compute(await this.calc.load(tx, inv.tenancyId), this.cutoffOf(inv));
      const hash = sourceHash(result);
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await this.writeItems(tx, id, result.lines);
      const sub = subtotal(result.lines);
      await tx.invoice.update({
        where: { id },
        data: {
          subtotalVnd: sub,
          totalVnd: sub,
          sourceHash: hash,
          blockingErrors: result.errors as unknown as Prisma.InputJsonValue,
          issueDate: toDbDate(this.clock.today()),
          ...(await this.monthlyDue(tx, inv)),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        workspaceId: inv.workspaceId,
        actorId: user.id,
        action: 'invoice.recalculate',
        entityType: 'invoice',
        entityId: id,
        before: { subtotal_vnd: inv.subtotalVnd, source_hash: inv.sourceHash },
        after: { subtotal_vnd: sub, source_hash: hash },
      });
      return hash !== inv.sourceHash;
    });
    const invoice = await this.get(user, id);
    return { invoice, changed, before_total_vnd: before.totalVnd.toString(), after_total_vnd: invoice.total_vnd };
  }

  /**
   * Phát hành: cần expected_version và source_hash người dùng đã xem; dữ liệu nguồn đổi sau khi tính → STALE.
   * Tổng âm → dòng CREDIT tách sang CREDIT_ADJUSTMENT tạo thẳng PUBLISHED trong cùng transaction (D-023).
   */
  async publish(user: AuthUser, id: string, input: z.output<typeof invoicePublishSchema>) {
    const head = await this.getRow(this.prisma, user, id);
    const creditId = await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [head.tenancyId]);
      await lockRows(tx, 'invoices', [id]);
      const inv = await this.getRow(tx, user, id);
      if (inv.lifecycle !== 'DRAFT') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ phát hành được thông báo nháp.');
      if (inv.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      await assertPeriodOpen(tx, inv.workspaceId, invoiceMonth(inv), 'phát hành thông báo');
      if (inv.sourceHash !== input.source_hash) throw new AppError('STALE', 'Nháp đã được tính lại sau khi bạn mở. Vui lòng tải lại và kiểm tra.');
      const result = this.calc.compute(await this.calc.load(tx, inv.tenancyId), this.cutoffOf(inv));
      if (sourceHash(result) !== inv.sourceHash) {
        throw new AppError('STALE', 'Dữ liệu nguồn (giá, chỉ số, dịch vụ…) đã đổi sau khi tính nháp. Hãy bấm “Tính lại” và kiểm tra trước khi phát hành.');
      }
      if (result.errors.length) {
        throw new AppError('BUSINESS_RULE_VIOLATION', `Chưa phát hành được: ${result.errors.map((e) => e.message).join(' ')}`);
      }
      const items = await tx.invoiceItem.findMany({ where: { invoiceId: id }, orderBy: { sortOrder: 'asc' } });
      const sub = subtotal(items.map((i) => ({ direction: i.direction, amount: i.amountVnd })));
      const now = this.clock.now();
      const monthKey = inv.statementPeriod ? fromDbDate(inv.statementPeriod.monthStart) : firstDayOfMonth(this.clock.today());
      let creditInvoiceId: string | null = null;
      let debitTotal = sub;
      if (sub < 0n) {
        const credits = items.filter((i) => i.direction === 'CREDIT');
        const creditTotal = credits.reduce((s, i) => s + i.amountVnd, 0n);
        debitTotal = items.filter((i) => i.direction === 'DEBIT').reduce((s, i) => s + i.amountVnd, 0n);
        await tx.invoice.update({ where: { id }, data: { subtotalVnd: debitTotal, totalVnd: debitTotal } });
        await this.assignNumberAndPublish(tx, inv, monthKey, user.id, now);
        const credit = await tx.invoice.create({
          data: {
            workspaceId: inv.workspaceId,
            tenancyId: inv.tenancyId,
            type: 'CREDIT_ADJUSTMENT',
            lifecycle: 'PUBLISHED',
            number: await this.number(tx, inv.workspaceId, 'CREDIT_ADJUSTMENT', monthKey),
            issueDate: inv.issueDate,
            dueDate: inv.dueDate,
            subtotalVnd: creditTotal,
            totalVnd: creditTotal,
            sourceInvoiceId: id,
            publishedAt: now,
            publishedBy: user.id,
            createdBy: user.id,
          },
        });
        await tx.invoiceItem.updateMany({ where: { id: { in: credits.map((c) => c.id) } }, data: { invoiceId: credit.id } });
        creditInvoiceId = credit.id;
      } else {
        await this.assignNumberAndPublish(tx, inv, monthKey, user.id, now);
      }
      await this.audit.record(tx, {
        workspaceId: inv.workspaceId,
        actorId: user.id,
        action: 'invoice.publish',
        entityType: 'invoice',
        entityId: id,
        after: { total_vnd: debitTotal, credit_invoice_id: creditInvoiceId, source_hash: inv.sourceHash },
      });
      return creditInvoiceId;
    });
    return { invoice: await this.get(user, id), credit_invoice: creditId ? (await this.summaries(this.prisma, [await this.getRow(this.prisma, user, creditId)]))[0]! : null };
  }

  /** Hủy nháp; hoặc hủy chứng từ đã phát hành khi chưa có khoản thu/cấn trừ nào (5.4). Không xóa dữ liệu. */
  async cancel(user: AuthUser, id: string, input: z.output<typeof invoiceCancelSchema>) {
    const head = await this.getRow(this.prisma, user, id);
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [head.tenancyId]);
      await lockRows(tx, 'invoices', [id]);
      const inv = await this.getRow(tx, user, id);
      if (inv.lifecycle === 'CANCELLED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Thông báo đã hủy.');
      if (inv.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      await assertPeriodOpen(tx, inv.workspaceId, invoiceMonth(inv), 'hủy thông báo');
      if (inv.lifecycle === 'PUBLISHED') {
        const settled = (await this.settlement.settled(tx, [id])).get(id) ?? 0n;
        if (settled > 0n) throw new AppError('BUSINESS_RULE_VIOLATION', 'Thông báo đã có khoản thu hoặc cấn trừ; hãy đảo các khoản đó trước khi hủy.');
      }
      await tx.invoice.update({
        where: { id },
        data: { lifecycle: 'CANCELLED', cancelledAt: this.clock.now(), cancelledBy: user.id, cancelReason: input.reason, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        workspaceId: inv.workspaceId,
        actorId: user.id,
        action: inv.lifecycle === 'DRAFT' ? 'invoice.cancel_draft' : 'invoice.cancel_published',
        entityType: 'invoice',
        entityId: id,
        reason: input.reason,
        before: { lifecycle: inv.lifecycle, total_vnd: inv.totalVnd, number: inv.number },
      });
    });
    return this.get(user, id);
  }

  /**
   * “Điều chỉnh ngay” (8.6 quy tắc nháp 4, D-023): đối soát các u đã phát hành của tenancy; confirm=false chỉ xem trước.
   * Khi xác nhận: hủy nháp đang mở, tạo và phát hành DEBIT/CREDIT_ADJUSTMENT liên kết chứng từ gốc, rồi tạo lại nháp.
   */
  async adjust(user: AuthUser, id: string, input: z.output<typeof invoiceAdjustSchema>) {
    const source = await this.getRow(this.prisma, user, id);
    if (source.lifecycle !== 'PUBLISHED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ điều chỉnh từ chứng từ đã phát hành.');
    const onlyPublished: Cutoff = { ...monthlyCutoff(firstDayOfMonth(this.clock.today())), onlyPublished: true, requireReadingsFor: null };
    const preview = this.calc.compute(await this.calc.load(this.prisma, source.tenancyId), onlyPublished);
    const totals = (r: ComputeResult) => ({
      debit: r.lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amount, 0n),
      credit: r.lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amount, 0n),
    });
    const openDraft = await this.prisma.invoice.findFirst({ where: { tenancyId: source.tenancyId, lifecycle: 'DRAFT' } });
    if (!input.confirm) {
      const t = totals(preview);
      return {
        confirmed: false,
        lines: preview.lines.map((l) => lineDto(l)),
        debit_total_vnd: t.debit.toString(),
        credit_total_vnd: t.credit.toString(),
        open_draft_id: openDraft?.id ?? null,
        debit_invoice: null,
        credit_invoice: null,
      };
    }
    const created = await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [source.tenancyId]);
      // Chứng từ điều chỉnh lập trong tháng hiện tại.
      await assertPeriodOpen(tx, source.workspaceId, firstDayOfMonth(this.clock.today()), 'lập chứng từ điều chỉnh');
      const result = this.calc.compute(await this.calc.load(tx, source.tenancyId), onlyPublished);
      if (!result.lines.length) throw new AppError('BUSINESS_RULE_VIOLATION', 'Không có chênh lệch nào cần điều chỉnh.');
      if (result.errors.length) throw new AppError('BUSINESS_RULE_VIOLATION', `Chưa điều chỉnh được: ${result.errors.map((e) => e.message).join(' ')}`);
      const draft = await tx.invoice.findFirst({ where: { tenancyId: source.tenancyId, lifecycle: 'DRAFT' }, include: { statementPeriod: true } });
      const now = this.clock.now();
      if (draft) {
        await tx.invoice.update({
          where: { id: draft.id },
          data: { lifecycle: 'CANCELLED', cancelledAt: now, cancelledBy: user.id, cancelReason: `Hủy để điều chỉnh ngay: ${input.reason}`, version: { increment: 1 } },
        });
      }
      const monthKey = firstDayOfMonth(this.clock.today());
      const ids: Record<'DEBIT' | 'CREDIT', string | null> = { DEBIT: null, CREDIT: null };
      for (const direction of ['DEBIT', 'CREDIT'] as const) {
        const lines = result.lines.filter((l) => l.direction === direction);
        if (!lines.length) continue;
        const type = direction === 'DEBIT' ? 'DEBIT_ADJUSTMENT' : 'CREDIT_ADJUSTMENT';
        const total = lines.reduce((s, l) => s + l.amount, 0n);
        const inv = await tx.invoice.create({
          data: {
            workspaceId: source.workspaceId,
            tenancyId: source.tenancyId,
            type,
            lifecycle: 'PUBLISHED',
            number: await this.number(tx, source.workspaceId, type, monthKey),
            issueDate: toDbDate(this.clock.today()),
            dueDate: toDbDate(this.clock.today()),
            subtotalVnd: total,
            totalVnd: total,
            sourceInvoiceId: source.id,
            sourceHash: sourceHash({ lines, errors: [] }),
            publishedAt: now,
            publishedBy: user.id,
            createdBy: user.id,
          },
        });
        await this.writeItems(tx, inv.id, lines);
        ids[direction] = inv.id;
      }
      await this.audit.record(tx, {
        workspaceId: source.workspaceId,
        actorId: user.id,
        action: 'invoice.adjust_now',
        entityType: 'invoice',
        entityId: source.id,
        reason: input.reason,
        after: { debit_invoice_id: ids.DEBIT, credit_invoice_id: ids.CREDIT, cancelled_draft_id: draft?.id ?? null },
      });
      // Tạo lại nháp tháng đã hủy, tính từ Δ mới (D-023).
      if (draft?.type === 'MONTHLY' && draft.statementPeriod) await this.generateInTx(tx, user, source.tenancyId, fromDbDate(draft.statementPeriod.monthStart));
      return ids;
    });
    const t = totals(preview);
    const pick = async (invoiceId: string | null) => (invoiceId ? (await this.summaries(this.prisma, [await this.getRow(this.prisma, user, invoiceId)]))[0]! : null);
    return {
      confirmed: true,
      lines: preview.lines.map((l) => lineDto(l)),
      debit_total_vnd: t.debit.toString(),
      credit_total_vnd: t.credit.toString(),
      open_draft_id: openDraft?.id ?? null,
      debit_invoice: await pick(created.DEBIT),
      credit_invoice: await pick(created.CREDIT),
    };
  }

  // ------------------------------------------------------------------ Đọc

  async list(user: AuthUser, q: z.output<typeof invoiceListQuerySchema>): Promise<Paged<InvoiceSummary>> {
    const rows = await this.prisma.invoice.findMany({
      where: {
        workspaceId: user.workspaceId,
        tenancy: { room: { ...this.rooms.roomWhere(user), ...(q.building_id ? { buildingId: q.building_id } : {}) } },
        ...(q.tenancy_id ? { tenancyId: q.tenancy_id } : {}),
        ...(q.lifecycle ? { lifecycle: q.lifecycle } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.period ? { statementPeriod: { monthStart: toDbDate(`${q.period}-01`) } } : {}),
      },
      include,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    });
    let items = await this.summaries(this.prisma, rows);
    if (q.q) {
      const needle = q.q.toLowerCase();
      items = items.filter((i) => [i.number, i.room_code, i.tenancy_code, i.primary_tenant_name].some((v) => v?.toLowerCase().includes(needle)));
    }
    if (q.payment_status) {
      items = items.filter((i) => (q.payment_status === 'OVERDUE' ? i.overdue : i.lifecycle === 'PUBLISHED' && i.payment_status === q.payment_status));
    }
    if (!q.tenancy_id) items.sort((a, b) => (a.period ?? '') < (b.period ?? '') ? 1 : (a.period ?? '') > (b.period ?? '') ? -1 : naturalCompare(a.building_code, b.building_code) || naturalCompare(a.room_code, b.room_code));
    return paged(items, q.page, q.page_size);
  }

  async get(user: AuthUser, id: string): Promise<InvoiceDetail> {
    const inv = await this.getRow(this.prisma, user, id);
    const items = await this.prisma.invoiceItem.findMany({ where: { invoiceId: id }, orderBy: { sortOrder: 'asc' } });
    const adjustments = await this.prisma.invoice.findMany({ where: { sourceInvoiceId: id }, orderBy: { createdAt: 'asc' } });
    const source = inv.sourceInvoiceId ? await this.prisma.invoice.findUnique({ where: { id: inv.sourceInvoiceId }, select: { number: true } }) : null;
    const [summary] = await this.summaries(this.prisma, [inv]);
    return {
      ...summary!,
      source_hash: inv.sourceHash,
      source_invoice_number: source?.number ?? null,
      adjustments: adjustments.map((a) => ({ id: a.id, number: a.number, type: a.type, total_vnd: a.totalVnd.toString(), lifecycle: a.lifecycle })),
      items: items.map(itemDto),
      room_address: inv.tenancy.room.building.address,
      building_name: inv.tenancy.room.building.name,
    };
  }

  /** Tóm tắt kèm trạng thái thanh toán tính toán (5.4): UNPAID/PARTIAL/PAID + cờ quá hạn. */
  async summaries(db: Db, rows: InvoiceFull[]): Promise<InvoiceSummary[]> {
    const settled = await this.settlement.settled(db, rows.filter((r) => r.lifecycle === 'PUBLISHED').map((r) => r.id));
    const today = this.clock.today();
    return rows.map((r) => {
      const s = settled.get(r.id) ?? 0n;
      const isCredit = r.type === 'CREDIT_ADJUSTMENT';
      const remaining = r.lifecycle === 'PUBLISHED' ? (r.totalVnd > s ? r.totalVnd - s : 0n) : r.lifecycle === 'DRAFT' ? r.totalVnd : 0n;
      const status = r.lifecycle !== 'PUBLISHED' || isCredit ? null : remaining === 0n ? 'PAID' : s > 0n ? 'PARTIAL' : 'UNPAID';
      return {
        id: r.id,
        number: r.number,
        type: r.type,
        lifecycle: r.lifecycle,
        tenancy_id: r.tenancyId,
        tenancy_code: r.tenancy.code,
        tenancy_status: r.tenancy.status,
        room_id: r.tenancy.roomId,
        room_code: r.tenancy.room.code,
        building_id: r.tenancy.room.buildingId,
        building_code: r.tenancy.room.building.code,
        primary_tenant_name: r.tenancy.members[0]?.tenant.fullName ?? null,
        period: r.statementPeriod ? periodOf(fromDbDate(r.statementPeriod.monthStart)) : null,
        issue_date: day(r.issueDate),
        due_date: day(r.dueDate),
        subtotal_vnd: r.subtotalVnd.toString(),
        discount_vnd: r.discountVnd.toString(),
        total_vnd: r.totalVnd.toString(),
        settled_vnd: s.toString(),
        remaining_vnd: remaining.toString(),
        payment_status: status,
        overdue: status !== null && status !== 'PAID' && day(r.dueDate) < today,
        blocking_errors: (r.blockingErrors as unknown as BlockingError[]) ?? [],
        source_invoice_id: r.sourceInvoiceId,
        published_at: iso(r.publishedAt),
        cancelled_at: iso(r.cancelledAt),
        cancel_reason: r.cancelReason,
        version: r.version,
      };
    });
  }

  // ------------------------------------------------------------------ Hỗ trợ

  private cutoffOf(inv: Invoice & { statementPeriod: { monthStart: Date } | null }): Cutoff {
    if (inv.type === 'MONTHLY' && inv.statementPeriod) return monthlyCutoff(fromDbDate(inv.statementPeriod.monthStart));
    throw new AppError('BUSINESS_RULE_VIOLATION', 'Loại thông báo này không tính lại được ở đây.');
  }

  private async assignNumberAndPublish(tx: Prisma.TransactionClient, inv: Invoice, monthKey: DateOnly, userId: string, now: Date) {
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        lifecycle: 'PUBLISHED',
        number: await this.number(tx, inv.workspaceId, inv.type, monthKey),
        publishedAt: now,
        publishedBy: userId,
        ...(await this.monthlyDue(tx, inv)),
        version: { increment: 1 },
      },
    });
  }

  /** Thông báo tháng: tính lại hạn theo ngày hôm nay (lập/tính lại/phát hành muộn → thêm 7 ngày, D-044). Loại khác giữ hạn đã có. */
  private async monthlyDue(tx: Prisma.TransactionClient, inv: Invoice): Promise<{ dueDate?: Date }> {
    if (inv.type !== 'MONTHLY' || !inv.statementPeriodId) return {};
    const period = await tx.statementPeriod.findUniqueOrThrow({ where: { id: inv.statementPeriodId } });
    const tenancy = await tx.tenancy.findUniqueOrThrow({ where: { id: inv.tenancyId } });
    return { dueDate: toDbDate(effectiveDueDate(scheduledDue(tenancy, fromDbDate(period.monthStart)), this.clock.today())) };
  }

  /** Số chứng từ <loại>-<YYYYMM>-<số thứ tự>, cấp trong transaction phát hành (5.4). */
  private async number(tx: Prisma.TransactionClient, workspaceId: string, type: InvoiceType, monthKey: DateOnly): Promise<string> {
    const yyyymm = monthKey.slice(0, 7).replace('-', '');
    const seq = await nextSequence(tx, workspaceId, `INVOICE_${type}`, yyyymm);
    return `${NUMBER_PREFIX[type]}-${yyyymm}-${String(seq).padStart(4, '0')}`;
  }

  private async writeItems(tx: Prisma.TransactionClient, invoiceId: string, lines: ComputedLine[]) {
    if (lines.length) await tx.invoiceItem.createMany({ data: lines.map((l, i) => toItemData(l, invoiceId, i)) });
  }

  private async getRow(db: Db, user: AuthUser, id: string): Promise<InvoiceFull> {
    const row = await db.invoice.findFirst({ where: { id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } }, include });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async runTenancies(user: AuthUser, run: z.output<typeof billingRunSchema>): Promise<TenancyRow[]> {
    const monthStart = `${run.period}-01`;
    const rows = await this.prisma.tenancy.findMany({
      where: {
        workspaceId: user.workspaceId,
        status: { in: [...OPEN_TENANCY_STATUSES] },
        startDate: { lt: toDbDate(addMonths(monthStart, 1)) },
        room: { ...this.rooms.roomWhere(user), ...(run.building_id ? { buildingId: run.building_id } : {}) },
        ...(run.tenancy_ids ? { id: { in: run.tenancy_ids } } : {}),
      },
      include: { room: { include: { building: true } }, members: { where: { role: 'PRIMARY' }, include: { tenant: { select: { fullName: true } } } } },
    });
    return rows.sort((a, b) => naturalCompare(a.room.building.code, b.room.building.code) || naturalCompare(a.room.code, b.room.code));
  }

  private resultBase(t: TenancyRow) {
    return {
      tenancy_id: t.id,
      tenancy_code: t.code,
      room_code: t.room.code,
      building_code: t.room.building.code,
      primary_tenant_name: t.members.find((m) => !m.leftOnExclusive)?.tenant.fullName ?? t.members[0]?.tenant.fullName ?? null,
    };
  }

  private async mapUnique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (pgErrorCode(error) === PG.UNIQUE_VIOLATION) {
        const c = violatedConstraint(error);
        if (c === 'one_draft_invoice_per_tenancy') throw new AppError('CONFLICT', 'Còn nháp chưa phát hành của lần thuê này.');
        if (c === 'one_monthly_invoice_per_period') throw new AppError('CONFLICT', 'Đã có thông báo tháng của kỳ này.');
      }
      throw error;
    }
  }
}

// ------------------------------------------------------------------ DTO dòng

function lineDto(l: ComputedLine): InvoiceLine {
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

function itemDto(i: InvoiceItem): InvoiceLine {
  const calc = i.calculationSnapshot as { group?: InvoiceLine['group'] };
  return {
    id: i.id,
    group: calc.group ?? (i.correctsItemId ? 'ADJUSTMENT' : i.chargeTiming),
    charge_kind: i.chargeKind,
    charge_timing: i.chargeTiming,
    direction: i.direction,
    label: i.labelSnapshot,
    quantity: i.quantity.toString(),
    unit_price: i.unitPrice.toString(),
    amount_vnd: i.amountVnd.toString(),
    charge_start: dayOrNull(i.chargeStart),
    charge_end_exclusive: dayOrNull(i.chargeEndExclusive),
    source_key: i.sourceKey,
    unit_key: i.unitKey,
    corrects_item_id: i.correctsItemId,
  };
}

/** Hạn theo lịch: thông báo đầu tiên đến hạn ngày nhận phòng (7.2 bước 8); các tháng sau theo ngày đến hạn của lần thuê. */
function scheduledDue(tenancy: { startDate: Date; billingDueDay: number }, monthStart: DateOnly): DateOnly {
  const start = fromDbDate(tenancy.startDate);
  return firstDayOfMonth(start) === monthStart ? start : dayOfMonthClamped(monthStart, tenancy.billingDueDay);
}
