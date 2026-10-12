import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  type BankConfigDto,
  type BankReconcileOptions,
  type BankSyncResult,
  type BankTransactionDto,
  type bankAllocateSchema,
  type bankLinkPaymentSchema,
  type bankSimulateSchema,
  type bankTransactionListQuerySchema,
  type Paged,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { day, iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { type NormalizedBankTransaction, normalizeAccount, preCheck } from '../../domain/bank/normalize.js';
import { extractPaymentCodes, invoiceNumberOf } from '../../domain/bank/payment-code.js';
import { BankPayloadError } from '../../domain/bank/sepay-format.js';
import { toBusinessDate } from '../../domain/dates/business-date.js';
import { toDbDate } from '../../domain/dates/date-only.js';
import type { BankTransaction, Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { InvoiceBalances } from '../payments/balances.js';
import { PaymentsService } from '../payments/payments.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { userNames } from '../utilities/user-names.js';
import { BANK_ADAPTER, type BankAdapter } from './bank-adapter.js';

/** Phiếu thu ghi tay trong khoảng này quanh thời điểm giao dịch được coi là có thể trùng (không tự cộng tiền lần hai). */
const MANUAL_WINDOW_DAYS = 7;
const SYNC_PAGE_SIZE = 100;
const SYNC_MAX_PAGES = 50;
const DEBT_TYPES = ['MONTHLY', 'FINAL', 'DEBIT_ADJUSTMENT'] as const;

const include = {
  invoice: { select: { id: true, number: true, tenancy: { select: { room: { select: { code: true, building: { select: { code: true } } } } } } } },
  payments: { include: { payment: { select: { id: true, number: true, amountVnd: true, status: true, tenancyId: true } } }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.BankTransactionInclude;
type Row = Prisma.BankTransactionGetPayload<{ include: typeof include }>;

const allocatedOf = (r: Row) => r.payments.reduce((s, l) => (l.payment.status === 'POSTED' ? s + l.payment.amountVnd : s), 0n);
const unallocatedOf = (r: Row) => {
  const left = r.amountVnd - allocatedOf(r) - r.dismissedVnd;
  return left > 0n ? left : 0n;
};
const vnd = (v: bigint) => `${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

/**
 * Giao dịch ngân hàng tự động (D-047). Webhook/đồng bộ → lưu bền vững (unique theo nhà cung cấp/môi trường/tài khoản/mã giao dịch)
 * → đối chiếu theo mã thanh toán → ghi phiếu thu bằng chính `PaymentsService.createInTx` (cùng quy tắc không vượt số còn nợ, khóa,
 * audit). Không đoán theo số tiền; mọi trường hợp không chắc chắn vào “Chờ đối chiếu”.
 */
@Injectable()
export class BankTransactionsService {
  private readonly logger = new Logger(BankTransactionsService.name);
  /** Test có thể trỏ công cụ giả lập tới server đang lắng nghe. */
  mockWebhookUrlOverride: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly balances: InvoiceBalances,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly rooms: RoomsService,
    @Inject(BANK_ADAPTER) private readonly adapter: BankAdapter | null,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ Webhook và lưu giao dịch

  /** Endpoint webhook: xác thực theo adapter → đọc payload → lưu → đối chiếu. Trả phản hồi nhà cung cấp coi là đã nhận. */
  async handleWebhook(provider: string, headers: Record<string, string | string[] | undefined>, body: unknown) {
    const a = this.adapter;
    // Không bật hoặc khác nhà cung cấp đang cấu hình: coi như không có endpoint (không lộ cấu hình).
    if (!a || a.provider !== provider) throw new AppError('ROUTE_NOT_FOUND');
    a.verifyWebhook(headers);
    let t: NormalizedBankTransaction;
    try {
      t = a.parseWebhook(body);
    } catch (e) {
      if (e instanceof BankPayloadError) throw new AppError('VALIDATION_FAILED', e.message);
      throw e;
    }
    await this.ingest(t, body, 'WEBHOOK');
    return a.webhookAck;
  }

  /**
   * Lưu giao dịch trước (commit riêng), rồi mới đối chiếu. Trùng khóa → không ghi lại; nếu lần trước chưa xử lý xong (RECEIVED) thì
   * xử lý tiếp — an toàn vì bước đối chiếu khóa dòng và kiểm tra lại trạng thái.
   */
  async ingest(t: NormalizedBankTransaction, raw: unknown, source: 'WEBHOOK' | 'SYNC'): Promise<{ id: string; duplicate: boolean }> {
    const a = this.requireAdapter();
    const workspaceId = await this.workspaceFor(t.accountNumber);
    const key = { provider: a.provider, environment: a.environment, accountNumber: t.accountNumber, providerTransactionId: t.providerTransactionId };
    const created = await this.prisma.bankTransaction.createMany({
      data: [
        {
          ...key,
          workspaceId,
          direction: t.direction,
          amountVnd: t.amountVnd,
          currency: t.currency,
          content: t.content,
          referenceCode: t.referenceCode,
          occurredAt: t.occurredAt,
          source,
          rawPayload: JSON.parse(JSON.stringify(raw, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue,
          mockTransactionId: a.environment === 'MOCK' && /^\d+$/.test(t.providerTransactionId) ? BigInt(t.providerTransactionId) : null,
        },
      ],
      skipDuplicates: true,
    });
    const row = await this.prisma.bankTransaction.findUniqueOrThrow({ where: { provider_environment_accountNumber_providerTransactionId: key } });
    if (created.count === 1) {
      await this.audit.record(this.prisma, {
        workspaceId,
        actorId: null,
        action: 'bank_transaction.receive',
        entityType: 'bank_transaction',
        entityId: row.id,
        after: { source: source === 'WEBHOOK' ? 'BANK_WEBHOOK' : 'BANK_SYNC', provider: a.provider, environment: a.environment, provider_transaction_id: t.providerTransactionId, direction: t.direction, amount_vnd: t.amountVnd },
      });
    }
    if (row.status === 'RECEIVED') await this.process(row.id);
    return { id: row.id, duplicate: created.count === 0 };
  }

  /** Đối chiếu tự động; lỗi bất ngờ → ERROR (giao dịch vẫn đã lưu, có thể “Xử lý lại”). */
  private async process(id: string): Promise<void> {
    try {
      await this.autoMatch(id);
    } catch (e) {
      const message = e instanceof AppError && e.code === 'BUSINESS_RULE_VIOLATION' ? e.message : 'Lỗi khi đối chiếu tự động — bấm “Xử lý lại”.';
      if (!(e instanceof AppError)) this.logger.error(`Đối chiếu giao dịch ngân hàng ${id} lỗi: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.bankTransaction.updateMany({ where: { id, status: { in: ['RECEIVED', 'ERROR'] } }, data: { status: e instanceof AppError ? 'PENDING_REVIEW' : 'ERROR', reason: message } });
    }
  }

  private async autoMatch(id: string): Promise<void> {
    const row = await this.prisma.bankTransaction.findUniqueOrThrow({ where: { id } });
    if (row.status !== 'RECEIVED' && row.status !== 'ERROR') return;
    const account = await this.prisma.paymentAccount.findFirst({ where: { workspaceId: row.workspaceId, isActive: true } });
    const codes = extractPaymentCodes(row.content);
    const pre = preCheck(row, account?.accountNumber ?? null, codes);
    if (pre.kind === 'skip') return this.setOutcome(id, pre.status, pre.reason, { paymentCode: codes[0] ?? null });
    if (row.environment === 'LIVE' && account?.isDemo) return this.setOutcome(id, 'PENDING_REVIEW', 'Tài khoản nhận tiền đang là tài khoản demo — không tự ghi nhận ở môi trường thật.', { paymentCode: pre.code });

    const number = invoiceNumberOf(pre.code)!;
    const inv = await this.prisma.invoice.findFirst({ where: { workspaceId: row.workspaceId, number } });
    if (!inv) return this.setOutcome(id, 'PENDING_REVIEW', `Mã ${pre.code} không khớp thông báo nào.`, { paymentCode: pre.code });
    if (inv.lifecycle !== 'PUBLISHED' || !(DEBT_TYPES as readonly string[]).includes(inv.type)) {
      return this.setOutcome(id, 'PENDING_REVIEW', `Thông báo ${number} không còn nhận tiền (đã hủy hoặc không phải thông báo thu tiền).`, { paymentCode: pre.code, invoiceId: inv.id });
    }

    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [inv.tenancyId]);
      await lockRows(tx, 'invoices', [inv.id]);
      await lockRows(tx, 'bank_transactions', [id]);
      const cur = await tx.bankTransaction.findUniqueOrThrow({ where: { id } });
      if (cur.status !== 'RECEIVED' && cur.status !== 'ERROR') return;
      const base = { paymentCode: pre.code, invoiceId: inv.id };

      // Đã ghi nhận chuyển khoản tay trước khi webhook đến? Chỉ liên kết khi chắc chắn cùng giao dịch (cùng mã tham chiếu + cùng số tiền).
      const occurredDay = toBusinessDate(row.occurredAt, this.config.BUSINESS_TIMEZONE);
      const from = new Date(toDbDate(occurredDay).getTime() - MANUAL_WINDOW_DAYS * 86_400_000);
      const to = new Date(toDbDate(occurredDay).getTime() + MANUAL_WINDOW_DAYS * 86_400_000);
      const manual = await tx.payment.findMany({
        where: { status: 'POSTED', method: { not: 'CASH' }, bankLink: null, allocations: { some: { invoiceId: inv.id } }, paidAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
      });
      if (manual.length) {
        const refs = [row.referenceCode, row.providerTransactionId].filter((x): x is string => !!x).map(normalizeAccount);
        const same = manual.filter((p) => p.amountVnd === row.amountVnd && p.reference && refs.includes(normalizeAccount(p.reference)));
        if (same.length === 1) {
          await tx.bankTransactionPayment.create({ data: { bankTransactionId: id, paymentId: same[0]!.id, kind: 'LINKED_EXISTING', createdBy: null } });
          await this.updateOutcome(tx, row, 'MATCHED', `Đã có phiếu thu ghi tay ${same[0]!.number} cùng mã giao dịch — đã liên kết, không tạo khoản thu mới.`, base);
          return;
        }
        await this.updateOutcome(tx, row, 'PENDING_REVIEW', `Thông báo đã có phiếu thu chuyển khoản ghi tay (${manual.map((p) => p.number).join(', ')}) gần thời điểm này — cần xác nhận có phải cùng giao dịch, tránh thu hai lần.`, base);
        return;
      }

      const remaining = (await this.balances.remaining(tx, [inv])).get(inv.id) ?? 0n;
      if (remaining <= 0n) {
        await this.updateOutcome(tx, row, 'PENDING_REVIEW', `Thông báo ${number} đã thanh toán đủ — khoản chuyển thêm ${vnd(row.amountVnd)} cần đối chiếu (trả thừa hoặc chuyển trùng).`, base);
        return;
      }
      const amount = row.amountVnd < remaining ? row.amountVnd : remaining;
      const holder = await this.accountHolder(tx, row.workspaceId);
      const payment = await this.payments.createInTx(
        tx,
        holder,
        {
          tenancy_id: inv.tenancyId,
          amount_vnd: amount.toString(),
          method: 'BANK_TRANSFER',
          paid_at: this.paidAtOf(row),
          reference: (row.referenceCode ?? `${row.provider}#${row.providerTransactionId}`).slice(0, 100),
          note: `Tự động từ giao dịch ngân hàng ${row.provider} #${row.providerTransactionId}`,
          received_by: holder.id,
          allocations: [{ invoice_id: inv.id, amount_vnd: amount.toString() }],
        },
        { source: 'BANK_AUTO', auditActorId: null, auditExtra: { source_channel: 'BANK_WEBHOOK', bank_transaction_id: id, provider: row.provider, provider_transaction_id: row.providerTransactionId } },
      );
      await tx.bankTransactionPayment.create({ data: { bankTransactionId: id, paymentId: payment.id, kind: 'CREATED', createdBy: null } });
      const over = row.amountVnd - amount;
      await this.updateOutcome(
        tx,
        row,
        over > 0n ? 'PENDING_REVIEW' : 'MATCHED',
        over > 0n ? `Trả thừa ${vnd(over)} so với số còn nợ — đã ghi nhận ${vnd(amount)} vào ${number}, phần dư chưa phân bổ cần đối chiếu.` : null,
        base,
      );
    });
  }

  // ------------------------------------------------------------------ Đối chiếu thủ công

  /** Ghi phiếu thu từ giao dịch vào một thông báo (chủ trọ / người được cấp quyền, trong phạm vi tòa). Không vượt phần chưa phân bổ. */
  async allocate(user: AuthUser, id: string, input: z.output<typeof bankAllocateSchema>, key: string | undefined) {
    await this.visibleRow(user, id);
    const result = await this.idempotency.execute({ user, route: `POST /bank-transactions/${id}/allocate`, key, payload: input }, async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id: input.invoice_id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } } });
      if (!inv) throw new AppError('NOT_FOUND');
      await lockRows(tx, 'tenancies', [inv.tenancyId]);
      await lockRows(tx, 'invoices', [inv.id]);
      await lockRows(tx, 'bank_transactions', [id]);
      const row = await this.loadForResolve(tx, id);
      if (BigInt(input.amount_vnd) > unallocatedOf(row)) {
        throw new AppError('BUSINESS_RULE_VIOLATION', `Chỉ còn ${vnd(unallocatedOf(row))} chưa phân bổ.`, { amount_vnd: [`Tối đa ${unallocatedOf(row).toString()}đ.`] });
      }
      const holder = await this.accountHolder(tx, user.workspaceId);
      const payment = await this.payments.createInTx(
        tx,
        user,
        {
          tenancy_id: inv.tenancyId,
          amount_vnd: input.amount_vnd,
          method: 'BANK_TRANSFER',
          paid_at: this.paidAtOf(row),
          reference: (row.referenceCode ?? `${row.provider}#${row.providerTransactionId}`).slice(0, 100),
          note: input.note ?? `Đối chiếu giao dịch ngân hàng ${row.provider} #${row.providerTransactionId}`,
          received_by: input.received_by ?? holder.id,
          allocations: [{ invoice_id: inv.id, amount_vnd: input.amount_vnd }],
        },
        { source: 'BANK_RECONCILE', auditExtra: { source_channel: 'BANK_RECONCILE', bank_transaction_id: id, provider: row.provider, provider_transaction_id: row.providerTransactionId } },
      );
      await tx.bankTransactionPayment.create({ data: { bankTransactionId: id, paymentId: payment.id, kind: 'CREATED', createdBy: user.id } });
      await this.afterResolve(tx, user, id, 'bank_transaction.allocate', { payment_id: payment.id, invoice_id: inv.id, amount_vnd: input.amount_vnd });
      return { body: { id }, resultReference: id };
    });
    return { status: result.status, body: await this.get(user, id) };
  }

  /** Xác nhận giao dịch chính là phiếu thu chuyển khoản đã ghi tay → chỉ liên kết, không tạo khoản thu mới. */
  async linkPayment(user: AuthUser, id: string, input: z.output<typeof bankLinkPaymentSchema>, key: string | undefined) {
    await this.visibleRow(user, id);
    const result = await this.idempotency.execute({ user, route: `POST /bank-transactions/${id}/link-payment`, key, payload: input }, async (tx) => {
      const p = await tx.payment.findFirst({ where: { id: input.payment_id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } } });
      if (!p) throw new AppError('NOT_FOUND');
      await lockRows(tx, 'tenancies', [p.tenancyId]);
      await lockRows(tx, 'payments', [p.id]);
      await lockRows(tx, 'bank_transactions', [id]);
      const row = await this.loadForResolve(tx, id);
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: p.id }, include: { bankLink: true } });
      if (fresh.status !== 'POSTED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Phiếu thu đã bị đảo.');
      if (fresh.method === 'CASH') throw new AppError('BUSINESS_RULE_VIOLATION', 'Phiếu thu tiền mặt không thể là giao dịch ngân hàng.');
      if (fresh.bankLink) throw new AppError('BUSINESS_RULE_VIOLATION', 'Phiếu thu đã liên kết với một giao dịch ngân hàng khác.');
      if (fresh.amountVnd > unallocatedOf(row)) throw new AppError('BUSINESS_RULE_VIOLATION', `Phiếu thu ${vnd(fresh.amountVnd)} lớn hơn phần chưa phân bổ ${vnd(unallocatedOf(row))}.`);
      await tx.bankTransactionPayment.create({ data: { bankTransactionId: id, paymentId: p.id, kind: 'LINKED_EXISTING', createdBy: user.id } });
      await this.afterResolve(tx, user, id, 'bank_transaction.link_payment', { payment_id: p.id, note: input.note });
      return { body: { id }, resultReference: id };
    });
    return { status: result.status, body: await this.get(user, id) };
  }

  /** Phần chưa phân bổ không áp dụng (VD giao dịch không liên quan, đã trả lại người gửi) — bắt buộc lý do. */
  async dismiss(user: AuthUser, id: string, reason: string, key: string | undefined) {
    await this.visibleRow(user, id);
    const result = await this.idempotency.execute({ user, route: `POST /bank-transactions/${id}/dismiss`, key, payload: { reason } }, async (tx) => {
      await lockRows(tx, 'bank_transactions', [id]);
      const row = await this.loadForResolve(tx, id, true);
      const left = unallocatedOf(row);
      await tx.bankTransaction.update({
        where: { id },
        data: {
          dismissedVnd: row.dismissedVnd + left,
          status: allocatedOf(row) > 0n ? 'MATCHED' : 'NOT_APPLICABLE',
          reason: null,
          resolvedBy: user.id,
          resolvedAt: this.clock.now(),
          resolutionNote: reason,
        },
      });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'bank_transaction.dismiss', entityType: 'bank_transaction', entityId: id, reason, after: { dismissed_vnd: left } });
      return { body: { id }, resultReference: id };
    });
    return { status: result.status, body: await this.get(user, id) };
  }

  /** Xử lý lại giao dịch lỗi/chưa xử lý xong bằng đúng luồng tự động. */
  async retry(user: AuthUser, id: string) {
    const row = await this.visibleRow(user, id);
    if (row.status !== 'ERROR' && row.status !== 'RECEIVED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ xử lý lại giao dịch lỗi hoặc chưa xử lý.');
    await this.prisma.bankTransaction.updateMany({ where: { id, status: 'ERROR' }, data: { status: 'RECEIVED' } });
    await this.process(id);
    return this.get(user, id);
  }

  // ------------------------------------------------------------------ Đồng bộ (lấy bù giao dịch bị lỡ)

  /** Lấy giao dịch sau mốc đã lưu, theo trang; mốc chỉ tiến sau khi cả trang đã lưu — lỗi giữa chừng không làm mất giao dịch. */
  async sync(user: AuthUser): Promise<BankSyncResult> {
    const a = this.requireAdapter();
    const account = await this.prisma.paymentAccount.findFirst({ where: { workspaceId: user.workspaceId, isActive: true } });
    if (!account) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chưa cấu hình tài khoản nhận tiền.');
    const where = { provider_environment_accountNumber: { provider: a.provider, environment: a.environment, accountNumber: account.accountNumber } };
    let state = await this.prisma.bankSyncState.upsert({ where, update: {}, create: { provider: a.provider, environment: a.environment, accountNumber: account.accountNumber } });
    const out = { fetched: 0, created: 0, duplicates: 0, last_provider_id: state.lastProviderId };
    try {
      for (let i = 0; i < SYNC_MAX_PAGES; i++) {
        const page = await a.fetchAfter(account.accountNumber, state.lastProviderId, SYNC_PAGE_SIZE);
        for (const t of page.items) {
          const r = await this.ingest(t, { via: 'sync', ...t, amountVnd: t.amountVnd.toString() }, 'SYNC');
          out.fetched++;
          if (r.duplicate) out.duplicates++;
          else out.created++;
        }
        state = await this.prisma.bankSyncState.update({ where: { id: state.id }, data: { lastProviderId: page.lastId ?? state.lastProviderId, lastSyncedAt: this.clock.now(), lastError: null } });
        out.last_provider_id = state.lastProviderId;
        if (!page.full) break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 300) : 'Lỗi không xác định';
      await this.prisma.bankSyncState.update({ where: { id: state.id }, data: { lastError: msg } });
      throw new AppError('SERVICE_UNAVAILABLE', `Đồng bộ giao dịch lỗi: ${msg}. Đã lưu tới mốc ${state.lastProviderId ?? '(đầu)'}, chạy lại sẽ tiếp tục.`);
    }
    await this.audit.record(this.prisma, { workspaceId: user.workspaceId, actorId: user.id, action: 'bank_transaction.sync', entityType: 'bank_sync_state', entityId: state.id, after: out });
    return out;
  }

  // ------------------------------------------------------------------ Công cụ giả lập (chỉ mock)

  /** Tạo giao dịch trong “ngân hàng giả” rồi (tùy chọn) gửi webhook qua HTTP tới chính endpoint webhook. Bị chặn ở backend nếu không phải mock. */
  async simulate(user: AuthUser, input: z.output<typeof bankSimulateSchema>) {
    this.requireMock();
    const account = await this.prisma.paymentAccount.findFirst({ where: { workspaceId: user.workspaceId, isActive: true } });
    if (!account && !input.account_number) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chưa cấu hình tài khoản nhận tiền.', { account_number: ['Nhập số tài khoản.'] });
    const mock = await runInTransaction(this.prisma, async (tx) => {
      const r = await tx.mockBankTransaction.create({ data: { payload: {}, createdBy: user.id } });
      const at = toVnDateTime(this.clock.now(), this.config.BUSINESS_TIMEZONE);
      const payload = {
        id: Number(r.id),
        gateway: account?.bankName ?? 'MockBank',
        transactionDate: at,
        accountNumber: input.account_number ?? account!.accountNumber,
        subAccount: null,
        code: extractPaymentCodes(input.content)[0] ?? null,
        content: input.content,
        transferType: input.direction === 'IN' ? 'in' : 'out',
        transferAmount: Number(input.amount_vnd),
        accumulated: null,
        referenceCode: `MOCK${r.id.toString()}`,
        description: `GIA LAP ${input.content}`.slice(0, 200),
      };
      await tx.mockBankTransaction.update({ where: { id: r.id }, data: { payload } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'bank_transaction.simulate', entityType: 'mock_bank_transaction', entityId: r.id.toString(), after: { ...input, delivery: input.delivery } });
      return { id: r.id, payload };
    });
    const webhookStatus = input.delivery === 'LOST' ? null : await this.deliver(mock.payload, input.delivery === 'BAD_SIGNATURE');
    return { mock_id: mock.id.toString(), delivery: input.delivery, webhook_status: webhookStatus, transaction: await this.byMockId(user, mock.id) };
  }

  /** Gửi lại đúng webhook của một giao dịch giả lập (chứng minh không ghi trùng). */
  async resend(user: AuthUser, mockId: string) {
    this.requireMock();
    if (!/^\d{1,18}$/.test(mockId)) throw new AppError('NOT_FOUND');
    const m = await this.prisma.mockBankTransaction.findUnique({ where: { id: BigInt(mockId) } });
    if (!m) throw new AppError('NOT_FOUND');
    const status = await this.deliver(m.payload, false);
    await this.audit.record(this.prisma, { workspaceId: user.workspaceId, actorId: user.id, action: 'bank_transaction.simulate_resend', entityType: 'mock_bank_transaction', entityId: mockId, after: { webhook_status: status } });
    return { mock_id: mockId, delivery: 'WEBHOOK' as const, webhook_status: status, transaction: await this.byMockId(user, m.id) };
  }

  private async deliver(payload: unknown, badKey: boolean): Promise<number> {
    const url = this.mockWebhookUrlOverride ?? this.config.BANK_MOCK_WEBHOOK_URL ?? `http://127.0.0.1:${this.config.API_PORT}/api/v1/bank-webhooks/mock`;
    const key = badKey ? `sai-${this.config.BANK_WEBHOOK_API_KEY ?? ''}` : this.config.BANK_WEBHOOK_API_KEY!;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${key}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
    await res.text();
    return res.status;
  }

  private async byMockId(user: AuthUser, mockId: bigint): Promise<BankTransactionDto | null> {
    const row = await this.prisma.bankTransaction.findFirst({ where: { workspaceId: user.workspaceId, environment: 'MOCK', mockTransactionId: mockId }, include });
    return row ? (await this.dtos([row]))[0]! : null;
  }

  // ------------------------------------------------------------------ Xem

  async configView(user: AuthUser): Promise<BankConfigDto> {
    const a = this.adapter;
    const account = await this.prisma.paymentAccount.findFirst({ where: { workspaceId: user.workspaceId, isActive: true } });
    const state =
      a && account ? await this.prisma.bankSyncState.findUnique({ where: { provider_environment_accountNumber: { provider: a.provider, environment: a.environment, accountNumber: account.accountNumber } } }) : null;
    return {
      mode: this.config.BANK_INTEGRATION_MODE,
      provider: a?.provider ?? null,
      webhook_path: a ? `/api/v1/bank-webhooks/${a.provider}` : null,
      simulator_enabled: this.config.BANK_INTEGRATION_MODE === 'mock' && a?.provider === 'mock',
      sync_supported: !!a,
      last_synced_at: iso(state?.lastSyncedAt),
      last_sync_error: state?.lastError ?? null,
      account_number: account?.accountNumber ?? null,
    };
  }

  async list(user: AuthUser, q: z.output<typeof bankTransactionListQuerySchema>): Promise<Paged<BankTransactionDto>> {
    const where: Prisma.BankTransactionWhereInput = {
      ...this.visibleWhere(user),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ content: { contains: q.q, mode: 'insensitive' } }, { providerTransactionId: { contains: q.q } }, { referenceCode: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [total, rows] = [
      await this.prisma.bankTransaction.count({ where }),
      await this.prisma.bankTransaction.findMany({ where, include, orderBy: [{ occurredAt: 'desc' }, { receivedAt: 'desc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    ];
    return { items: await this.dtos(rows), total, page: q.page, page_size: q.page_size };
  }

  async get(user: AuthUser, id: string): Promise<BankTransactionDto> {
    return (await this.dtos([await this.visibleRow(user, id)]))[0]!;
  }

  /** Gợi ý đối chiếu: thông báo còn nợ (khớp mã lên đầu) và phiếu thu chuyển khoản chưa liên kết, trong phạm vi tòa. */
  async options(user: AuthUser, id: string): Promise<BankReconcileOptions> {
    const row = await this.visibleRow(user, id);
    const left = unallocatedOf(row);
    const invoices = await this.prisma.invoice.findMany({
      where: { workspaceId: user.workspaceId, lifecycle: 'PUBLISHED', type: { in: [...DEBT_TYPES] }, tenancy: { room: this.rooms.roomWhere(user) } },
      include: { tenancy: { include: { room: { include: { building: true } }, members: { where: { role: 'PRIMARY' }, include: { tenant: { select: { fullName: true } } }, orderBy: { joinedOn: 'desc' } } } } },
      orderBy: { dueDate: 'asc' },
      take: 500,
    });
    const remaining = await this.balances.remaining(this.prisma, invoices);
    const open = invoices
      .filter((i) => (remaining.get(i.id) ?? 0n) > 0n && i.number)
      .map((i) => ({
        id: i.id,
        number: i.number!,
        tenancy_id: i.tenancyId,
        room_code: i.tenancy.room.code,
        building_code: i.tenancy.room.building.code,
        primary_tenant_name: i.tenancy.members[0]?.tenant.fullName ?? null,
        remaining_vnd: remaining.get(i.id)!.toString(),
        due_date: day(i.dueDate),
        matches_code: i.id === row.invoiceId,
      }))
      .sort((x, y) => Number(y.matches_code) - Number(x.matches_code))
      .slice(0, 50);
    const since = new Date(row.occurredAt.getTime() - 60 * 86_400_000);
    const payments = await this.prisma.payment.findMany({
      where: { workspaceId: user.workspaceId, status: 'POSTED', method: { not: 'CASH' }, bankLink: null, amountVnd: { lte: left }, paidAt: { gte: since }, tenancy: { room: this.rooms.roomWhere(user) } },
      include: { tenancy: { include: { room: true } }, allocations: { include: { invoice: { select: { number: true } } } } },
      orderBy: { paidAt: 'desc' },
      take: 50,
    });
    return {
      open_invoices: open,
      unlinked_payments: payments.map((p) => ({
        id: p.id,
        number: p.number,
        amount_vnd: p.amountVnd.toString(),
        method: p.method,
        paid_at: day(p.paidAt),
        reference: p.reference,
        room_code: p.tenancy.room.code,
        invoice_numbers: p.allocations.map((a) => a.invoice.number).filter((n): n is string => !!n),
      })),
    };
  }

  // ------------------------------------------------------------------ Hỗ trợ

  /**
   * Phạm vi xem: chủ trọ (mọi tòa) thấy tất cả; người giới hạn theo tòa chỉ thấy giao dịch đã khớp thông báo trong tòa được giao —
   * không lộ giao dịch chưa khớp hay của tòa khác.
   */
  private visibleWhere(user: AuthUser): Prisma.BankTransactionWhereInput {
    return user.allBuildings ? { workspaceId: user.workspaceId } : { workspaceId: user.workspaceId, invoice: { tenancy: { room: this.rooms.roomWhere(user) } } };
  }

  private async visibleRow(user: AuthUser, id: string): Promise<Row> {
    const row = await this.prisma.bankTransaction.findFirst({ where: { id, ...this.visibleWhere(user) }, include });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  /** Đọc lại sau khi khóa; chỉ giao dịch tiền vào đang chờ/lỗi còn phần chưa phân bổ mới được xử lý — đã liên kết đủ thì không xử lý lại. */
  private async loadForResolve(tx: Prisma.TransactionClient, id: string, allowOut = false): Promise<Row> {
    const row = await tx.bankTransaction.findUniqueOrThrow({ where: { id }, include });
    if (!allowOut && row.direction !== 'IN') throw new AppError('BUSINESS_RULE_VIOLATION', 'Giao dịch tiền ra không thể ghi nhận là khách thanh toán.');
    if (!['PENDING_REVIEW', 'ERROR', 'RECEIVED'].includes(row.status) || unallocatedOf(row) <= 0n) {
      throw new AppError('BUSINESS_RULE_VIOLATION', 'Giao dịch đã được đối chiếu xong — không xử lý lại.');
    }
    return row;
  }

  private async afterResolve(tx: Prisma.TransactionClient, user: AuthUser, id: string, action: string, after: Record<string, unknown>) {
    const row = await tx.bankTransaction.findUniqueOrThrow({ where: { id }, include });
    const left = unallocatedOf(row);
    await tx.bankTransaction.update({
      where: { id },
      data: { status: left > 0n ? 'PENDING_REVIEW' : 'MATCHED', reason: left > 0n ? `Còn ${vnd(left)} chưa phân bổ.` : null, resolvedBy: user.id, resolvedAt: this.clock.now() },
    });
    await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action, entityType: 'bank_transaction', entityId: id, after: { ...after, unallocated_vnd: left } });
  }

  private async setOutcome(id: string, status: BankTransaction['status'], reason: string | null, extra: { paymentCode?: string | null; invoiceId?: string | null }) {
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'bank_transactions', [id]);
      const row = await tx.bankTransaction.findUniqueOrThrow({ where: { id } });
      if (row.status !== 'RECEIVED' && row.status !== 'ERROR') return;
      await this.updateOutcome(tx, row, status, reason, extra);
    });
  }

  private async updateOutcome(tx: Prisma.TransactionClient, row: BankTransaction, status: BankTransaction['status'], reason: string | null, extra: { paymentCode?: string | null; invoiceId?: string | null }) {
    await tx.bankTransaction.update({ where: { id: row.id }, data: { status, reason, ...extra } });
    await this.audit.record(tx, {
      workspaceId: row.workspaceId,
      actorId: null,
      action: 'bank_transaction.auto_match',
      entityType: 'bank_transaction',
      entityId: row.id,
      after: { source: 'BANK_WEBHOOK', status, reason, payment_code: extra.paymentCode ?? null, invoice_id: extra.invoiceId ?? null },
    });
  }

  /**
   * Người “nhận tiền” của khoản chuyển khoản tự động = người quản lý tài khoản nhận (người cấu hình tài khoản VietQR, D-045).
   * Nhật ký ghi actor = hệ thống (null) với nguồn BANK_WEBHOOK; phiếu thu hiển thị “Tự động (ngân hàng)”.
   */
  private async accountHolder(tx: Prisma.TransactionClient, workspaceId: string): Promise<AuthUser> {
    const account = await tx.paymentAccount.findFirst({ where: { workspaceId, isActive: true } });
    let holder = account ? await tx.user.findFirst({ where: { id: account.createdBy, workspaceId, isActive: true } }) : null;
    holder ??= await tx.user.findFirst({ where: { workspaceId, isActive: true, roles: { some: { role: { code: 'OWNER' } } } }, orderBy: { createdAt: 'asc' } });
    if (!holder) throw new Error('Không có tài khoản chủ trọ đang hoạt động để làm người nhận tiền.');
    return { id: holder.id, workspaceId, email: holder.email, displayName: holder.displayName, roles: ['OWNER'], permissions: new Set(ALL_PERMISSIONS), allBuildings: true, buildingIds: [], sessionId: 'bank-webhook' };
  }

  /** Ngày thực nhận = ngày giao dịch theo giờ Việt Nam, không vượt hôm nay. */
  private paidAtOf(row: BankTransaction): string {
    const d = toBusinessDate(row.occurredAt, this.config.BUSINESS_TIMEZONE);
    const today = this.clock.today();
    return d > today ? today : d;
  }

  /** Một chủ trọ: tìm nhà trọ theo tài khoản nhận tiền; không khớp thì dùng nhà trọ duy nhất. */
  private async workspaceFor(accountNumber: string): Promise<string> {
    const acc = await this.prisma.paymentAccount.findFirst({ where: { accountNumber }, orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] });
    if (acc) return acc.workspaceId;
    const ws = await this.prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!ws) throw new AppError('SERVICE_UNAVAILABLE', 'Chưa khởi tạo nhà trọ.');
    return ws.id;
  }

  private requireAdapter(): BankAdapter {
    if (!this.adapter) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chưa bật tích hợp ngân hàng (BANK_INTEGRATION_MODE=off).');
    return this.adapter;
  }

  /** Công cụ giả lập chỉ chạy khi cấu hình là mock — kiểm tra ở backend, không chỉ ẩn nút. */
  private requireMock() {
    if (this.config.BANK_INTEGRATION_MODE !== 'mock' || this.adapter?.provider !== 'mock') throw new AppError('FORBIDDEN', 'Công cụ giả lập chỉ dùng ở môi trường mock.');
  }

  private async dtos(rows: Row[]): Promise<BankTransactionDto[]> {
    const names = await userNames(this.prisma, rows.map((r) => r.resolvedBy).filter((x): x is string => !!x));
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      environment: r.environment,
      provider_transaction_id: r.providerTransactionId,
      account_number: r.accountNumber,
      direction: r.direction,
      amount_vnd: r.amountVnd.toString(),
      currency: r.currency,
      content: r.content,
      reference_code: r.referenceCode,
      occurred_at: iso(r.occurredAt)!,
      received_at: iso(r.receivedAt)!,
      source: r.source,
      status: r.status,
      reason: r.reason,
      payment_code: r.paymentCode,
      invoice: r.invoice ? { id: r.invoice.id, number: r.invoice.number, room_code: r.invoice.tenancy.room.code, building_code: r.invoice.tenancy.room.building.code } : null,
      allocated_vnd: allocatedOf(r).toString(),
      dismissed_vnd: r.dismissedVnd.toString(),
      unallocated_vnd: r.direction === 'IN' ? unallocatedOf(r).toString() : '0',
      payments: r.payments.map((l) => ({ payment_id: l.payment.id, number: l.payment.number, amount_vnd: l.payment.amountVnd.toString(), status: l.payment.status, link: l.kind, tenancy_id: l.payment.tenancyId })),
      resolved_by_name: r.resolvedBy ? (names.get(r.resolvedBy) ?? null) : null,
      resolved_at: iso(r.resolvedAt),
      resolution_note: r.resolutionNote,
      mock_id: r.mockTransactionId?.toString() ?? null,
    }));
  }
}

/** Date → "YYYY-MM-DD HH:mm:ss" theo giờ Việt Nam (định dạng `transactionDate` của SePay). */
function toVnDateTime(d: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}
