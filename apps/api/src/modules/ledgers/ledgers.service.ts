import { Inject, Injectable } from '@nestjs/common';
import type { depositTxCreateSchema, holdingTxCreateSchema, LedgerTxDto } from '@ql-tro/shared';
import { PERMISSIONS } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppError } from '../../common/errors/app-error.js';
import { dayOrNull } from '../../common/dto/mappers.js';
import { toDbDate } from '../../domain/dates/date-only.js';
import { DEPOSIT_SIGN, HOLDING_SIGN, ledgerBalance, type LedgerTx, reversedIds, signedAmounts, summarizeDeposit } from '../../domain/ledgers/ledger.js';
import type { DepositTransaction, HoldingTransaction, Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { REVERSAL_OBSERVERS, type ReversalObserver } from '../payments/payments.service.js';
import { RoomsService } from '../rooms/rooms.service.js';

/** Cung cấp mức cọc yêu cầu hiện hành (Phase 3 suy ra từ hợp đồng; mặc định lấy giá trị lúc nhận phòng). */
export interface DepositRequirementProvider {
  requiredDeposit(db: Db, tenancyId: string, onDate: string): Promise<bigint>;
}
export const DEPOSIT_REQUIREMENT = Symbol('DEPOSIT_REQUIREMENT');

const toLedger = (t: { id: string; type: string; amountVnd: bigint; reversesTransactionId: string | null }): LedgerTx => ({
  id: t.id,
  type: t.type,
  amount: t.amountVnd,
  reversesId: t.reversesTransactionId,
});

@Injectable()
export class LedgersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DEPOSIT_REQUIREMENT) private readonly requirement: DepositRequirementProvider,
    @Inject(REVERSAL_OBSERVERS) private readonly observers: ReversalObserver[],
  ) {}

  // ------------------------------------------------------------------ Cọc

  async depositTxs(db: Db, tenancyId: string): Promise<DepositTransaction[]> {
    return db.depositTransaction.findMany({ where: { tenancyId }, orderBy: { createdAt: 'asc' } });
  }

  async depositHeld(db: Db, tenancyId: string): Promise<bigint> {
    return ledgerBalance((await this.depositTxs(db, tenancyId)).map(toLedger), DEPOSIT_SIGN);
  }

  async depositHeldMany(db: Db, tenancyIds: string[]): Promise<Map<string, bigint>> {
    const txs = await db.depositTransaction.findMany({ where: { tenancyId: { in: tenancyIds } } });
    const groups = new Map<string, LedgerTx[]>();
    for (const t of txs) groups.set(t.tenancyId, [...(groups.get(t.tenancyId) ?? []), toLedger(t)]);
    return new Map(tenancyIds.map((id) => [id, ledgerBalance(groups.get(id) ?? [], DEPOSIT_SIGN)]));
  }

  async depositSummary(db: Db, tenancyId: string) {
    const txs = await this.depositTxs(db, tenancyId);
    const s = summarizeDeposit(txs.map(toLedger));
    const required = await this.requirement.requiredDeposit(db, tenancyId, this.clock.today());
    const shortfall = required > s.held ? required - s.held : 0n;
    const excess = s.held > required ? s.held - required : 0n;
    return {
      summary: {
        required_vnd: required.toString(),
        held_vnd: s.held.toString(),
        received_vnd: s.received.toString(),
        applied_vnd: s.applied.toString(),
        deducted_vnd: s.deducted.toString(),
        refunded_vnd: s.refunded.toString(),
        shortfall_vnd: shortfall.toString(),
        excess_vnd: excess.toString(),
      },
      txs,
    };
  }

  async depositLedger(user: AuthUser, tenancyId: string) {
    await this.assertTenancyInScope(this.prisma, user, tenancyId);
    const { summary, txs } = await this.depositSummary(this.prisma, tenancyId);
    return { summary, transactions: await this.toDtos(txs, DEPOSIT_SIGN, (t) => t.linkedHoldingTransactionId ?? t.linkedDepositTransactionId) };
  }

  async createDeposit(user: AuthUser, tenancyId: string, input: z.output<typeof depositTxCreateSchema>, key: string | undefined) {
    return this.idempotency.execute(
      { user, route: `POST /tenancies/${tenancyId}/deposit-transactions`, key, payload: input, successStatus: 201 },
      async (tx) => {
        const created = await this.createDepositInTx(tx, user, tenancyId, input, null);
        return { body: { id: created.id }, resultReference: created.id };
      },
    );
  }

  /** Ghi một giao dịch cọc thực tế trong transaction có sẵn (dùng cả cho hoàn cọc khi quyết toán). */
  async createDepositInTx(tx: Prisma.TransactionClient, user: AuthUser, tenancyId: string, input: z.output<typeof depositTxCreateSchema>, settlementId: string | null) {
    if (input.type === 'REFUND' && !user.permissions.has(PERMISSIONS.DEPOSIT_REFUND)) throw new AppError('FORBIDDEN');
    if (input.type === 'DEDUCTION' && !user.permissions.has(PERMISSIONS.SETTLEMENT_APPROVE)) throw new AppError('FORBIDDEN');
    await lockRows(tx, 'tenancies', [tenancyId]);
    const tenancy = await this.assertTenancyInScope(tx, user, tenancyId);
    if ((input.type === 'RECEIVED' || input.type === 'TOP_UP') && tenancy.status === 'ENDED') {
      throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê đã kết thúc, không nhận thêm cọc.');
    }
    const created = await tx.depositTransaction.create({
      data: {
        workspaceId: user.workspaceId,
        tenancyId,
        type: input.type,
        amountVnd: BigInt(input.amount_vnd),
        reason: input.reason,
        paidAt: toDbDate(input.paid_at),
        method: input.method,
        reference: input.reference,
        settlementId,
        createdBy: user.id,
      },
    });
    await this.assertNonNegativeDeposit(tx, tenancyId);
    await this.audit.record(tx, {
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: `deposit.${input.type.toLowerCase()}`,
      entityType: 'tenancy',
      entityId: tenancyId,
      after: { ...input, settlement_id: settlementId },
      reason: input.reason,
    });
    return created;
  }

  /** Đảo một giao dịch cọc. Giao dịch thuộc cặp liên kết thì đảo cả cặp (MASTER_PLAN 9.2). */
  async reverseDeposit(user: AuthUser, txId: string, reason: string, key: string | undefined) {
    const original = await this.prisma.depositTransaction.findFirst({ where: { id: txId, workspaceId: user.workspaceId } });
    if (!original) throw new AppError('NOT_FOUND');
    return this.idempotency.execute(
      { user, route: `POST /deposit-transactions/${txId}/reverse`, key, payload: { reason }, successStatus: 201 },
      async (tx) => {
        await this.reverseDepositInTx(tx, user, original, reason);
        return { body: { ok: true as const }, resultReference: txId };
      },
    );
  }

  async reverseDepositInTx(tx: Prisma.TransactionClient, user: AuthUser, original: DepositTransaction, reason: string): Promise<void> {
    await lockRows(tx, 'tenancies', [original.tenancyId]);
    await this.assertTenancyInScope(tx, user, original.tenancyId);
    if (original.type === 'REVERSAL') throw new AppError('BUSINESS_RULE_VIOLATION', 'Không đảo một giao dịch đảo.');
    if (original.type === 'APPLIED_TO_INVOICE') {
      // Đảo áp cọc có xử lý allocation riêng (Phase 7).
      await this.reverseAppliedHook(tx, user, original, reason);
      return;
    }
    if (original.type === 'CONVERTED_FROM_HOLDING') {
      const holding = await tx.holdingTransaction.findFirst({ where: { linkedDepositTransactionId: original.id, type: 'CONVERTED_TO_DEPOSIT' } });
      if (!holding) throw new AppError('BUSINESS_RULE_VIOLATION', 'Không tìm thấy giao dịch giữ chỗ liên kết.');
      await this.reversePair(tx, user, original, holding, reason);
      return;
    }
    if (original.type === 'TRANSFER_OUT' || original.type === 'TRANSFER_IN') {
      await this.reverseTransferHook(tx, user, original, reason);
      return;
    }
    await this.insertDepositReversal(tx, user, original, reason);
    await this.assertNonNegativeDeposit(tx, original.tenancyId, 'Không đảo được: số dư cọc sẽ âm. Hãy đảo các giao dịch hoàn/áp cọc trước.');
    await this.auditReverse(tx, user, 'deposit.reverse', original.tenancyId, original.id, reason);
    for (const o of this.observers) await o.afterReversal(tx, user, original.tenancyId, 'DEPOSIT_TX', original.id, reason);
  }

  /** Hook để Phase 7 xử lý đảo APPLIED_TO_INVOICE (allocation mất hiệu lực). */
  /**
   * Đảo áp cọc vào thông báo (T51): REVERSAL làm số dư cọc tăng lại; deposit_allocations của giao dịch gốc tự mất hiệu lực
   * (InvoiceBalances), nên remaining của các thông báo liên quan tăng lại đúng phần đó. Không sửa/xóa allocation.
   */
  protected async reverseAppliedHook(tx: Prisma.TransactionClient, user: AuthUser, original: DepositTransaction, reason: string): Promise<void> {
    const allocations = await tx.depositAllocation.findMany({ where: { depositTransactionId: original.id }, select: { invoiceId: true } });
    await lockRows(tx, 'invoices', allocations.map((a) => a.invoiceId));
    await this.insertDepositReversal(tx, user, original, reason);
    await this.auditReverse(tx, user, 'deposit.reverse_applied', original.tenancyId, original.id, reason);
    for (const o of this.observers) await o.afterReversal(tx, user, original.tenancyId, 'DEPOSIT_TX', original.id, reason);
  }

  /** Hook để V1.1 xử lý cặp chuyển cọc giữa hai lần thuê. */
  protected async reverseTransferHook(tx: Prisma.TransactionClient, user: AuthUser, original: DepositTransaction, reason: string): Promise<void> {
    const pairId = original.linkedDepositTransactionId;
    const pair = pairId ? await tx.depositTransaction.findUnique({ where: { id: pairId } }) : null;
    if (!pair) throw new AppError('BUSINESS_RULE_VIOLATION', 'Không tìm thấy giao dịch chuyển cọc liên kết.');
    const tenancyIds = [original.tenancyId, pair.tenancyId];
    await lockRows(tx, 'tenancies', tenancyIds);
    await this.insertDepositReversal(tx, user, original, reason);
    await this.insertDepositReversal(tx, user, pair, reason);
    for (const id of tenancyIds) await this.assertNonNegativeDeposit(tx, id, 'Không đảo được: cọc ở phòng mới đã được dùng. Hãy đảo các giao dịch đó trước.');
    await this.auditReverse(tx, user, 'deposit.reverse_transfer', original.tenancyId, original.id, reason);
  }

  private async insertDepositReversal(tx: Prisma.TransactionClient, user: AuthUser, original: DepositTransaction, reason: string) {
    const existing = await tx.depositTransaction.findUnique({ where: { reversesTransactionId: original.id } });
    if (existing) throw new AppError('CONFLICT', 'Giao dịch này đã được đảo.');
    return tx.depositTransaction.create({
      data: {
        workspaceId: original.workspaceId,
        tenancyId: original.tenancyId,
        type: 'REVERSAL',
        amountVnd: original.amountVnd,
        reason,
        reversesTransactionId: original.id,
        paidAt: toDbDate(this.clock.today()),
        createdBy: user.id,
      },
    });
  }

  async assertNonNegativeDeposit(tx: Db, tenancyId: string, message = 'Số tiền vượt quá số cọc đang giữ.'): Promise<void> {
    if ((await this.depositHeld(tx, tenancyId)) < 0n) throw new AppError('BUSINESS_RULE_VIOLATION', message);
  }

  // ------------------------------------------------------------------ Tiền giữ chỗ

  async holdingTxs(db: Db, reservationId: string): Promise<HoldingTransaction[]> {
    return db.holdingTransaction.findMany({ where: { reservationId }, orderBy: { createdAt: 'asc' } });
  }

  async holdingBalances(db: Db, reservationIds: string[]): Promise<Map<string, bigint>> {
    if (reservationIds.length === 0) return new Map();
    const txs = await db.holdingTransaction.findMany({ where: { reservationId: { in: reservationIds } } });
    const groups = new Map<string, LedgerTx[]>();
    for (const t of txs) groups.set(t.reservationId, [...(groups.get(t.reservationId) ?? []), toLedger(t)]);
    return new Map(reservationIds.map((id) => [id, ledgerBalance(groups.get(id) ?? [], HOLDING_SIGN)]));
  }

  async holdingLedger(user: AuthUser, reservationId: string) {
    await this.assertReservationInScope(this.prisma, user, reservationId);
    const txs = await this.holdingTxs(this.prisma, reservationId);
    return {
      balance_vnd: ledgerBalance(txs.map(toLedger), HOLDING_SIGN).toString(),
      transactions: await this.toDtos(txs, HOLDING_SIGN, (t) => t.linkedDepositTransactionId),
    };
  }

  async createHolding(user: AuthUser, reservationId: string, input: z.output<typeof holdingTxCreateSchema>, key: string | undefined) {
    const perm = { RECEIVED: PERMISSIONS.HOLDING_RECORD, REFUND: PERMISSIONS.HOLDING_REFUND, FORFEIT: PERMISSIONS.HOLDING_FORFEIT }[input.type];
    if (!user.permissions.has(perm)) throw new AppError('FORBIDDEN');
    return this.idempotency.execute(
      { user, route: `POST /reservations/${reservationId}/holding-transactions`, key, payload: input, successStatus: 201 },
      async (tx) => {
        await lockRows(tx, 'reservations', [reservationId]);
        const reservation = await this.assertReservationInScope(tx, user, reservationId);
        if (input.type === 'RECEIVED' && reservation.status !== 'ACTIVE') {
          throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ nhận tiền giữ chỗ cho lượt giữ phòng đang hiệu lực.');
        }
        const created = await tx.holdingTransaction.create({
          data: {
            workspaceId: user.workspaceId,
            reservationId,
            type: input.type,
            amountVnd: BigInt(input.amount_vnd),
            reason: input.reason,
            paidAt: toDbDate(input.paid_at),
            method: input.method,
            reference: input.reference,
            createdBy: user.id,
          },
        });
        await this.assertNonNegativeHolding(tx, reservationId);
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: `holding.${input.type.toLowerCase()}`,
          entityType: 'reservation',
          entityId: reservationId,
          after: input,
          reason: input.reason,
        });
        return { body: { id: created.id }, resultReference: created.id };
      },
    );
  }

  async reverseHolding(user: AuthUser, txId: string, reason: string, key: string | undefined) {
    const original = await this.prisma.holdingTransaction.findFirst({ where: { id: txId, workspaceId: user.workspaceId } });
    if (!original) throw new AppError('NOT_FOUND');
    return this.idempotency.execute(
      { user, route: `POST /holding-transactions/${txId}/reverse`, key, payload: { reason }, successStatus: 201 },
      async (tx) => {
        await this.assertReservationInScope(tx, user, original.reservationId);
        if (original.type === 'REVERSAL') throw new AppError('BUSINESS_RULE_VIOLATION', 'Không đảo một giao dịch đảo.');
        if (original.type === 'CONVERTED_TO_DEPOSIT') {
          const deposit = original.linkedDepositTransactionId
            ? await tx.depositTransaction.findUnique({ where: { id: original.linkedDepositTransactionId } })
            : null;
          if (!deposit) throw new AppError('BUSINESS_RULE_VIOLATION', 'Không tìm thấy giao dịch cọc liên kết.');
          await lockRows(tx, 'tenancies', [deposit.tenancyId]);
          await this.reversePair(tx, user, deposit, original, reason);
        } else {
          await lockRows(tx, 'reservations', [original.reservationId]);
          await this.insertHoldingReversal(tx, user, original, reason);
          await this.assertNonNegativeHolding(tx, original.reservationId, 'Không đảo được: số dư tiền giữ chỗ sẽ âm.');
          await this.auditReverse(tx, user, 'holding.reverse', original.reservationId, original.id, reason, 'reservation');
        }
        return { body: { ok: true as const }, resultReference: txId };
      },
    );
  }

  /**
   * Chuyển toàn bộ số dư giữ chỗ thành cọc bằng cặp giao dịch liên kết (MASTER_PLAN 5.6, 9.3). Không có tiền thu mới.
   * Trả về số tiền đã chuyển (0 nếu không có số dư).
   */
  async convertHoldingToDeposit(tx: Prisma.TransactionClient, user: AuthUser, reservationId: string, tenancyId: string, onDate: string): Promise<bigint> {
    await lockRows(tx, 'reservations', [reservationId]);
    const balance = ledgerBalance((await this.holdingTxs(tx, reservationId)).map(toLedger), HOLDING_SIGN);
    if (balance <= 0n) return 0n;
    const holding = await tx.holdingTransaction.create({
      data: {
        workspaceId: user.workspaceId,
        reservationId,
        type: 'CONVERTED_TO_DEPOSIT',
        amountVnd: balance,
        reason: 'Chuyển tiền giữ chỗ thành tiền cọc khi nhận phòng',
        paidAt: toDbDate(onDate),
        createdBy: user.id,
      },
    });
    const deposit = await tx.depositTransaction.create({
      data: {
        workspaceId: user.workspaceId,
        tenancyId,
        type: 'CONVERTED_FROM_HOLDING',
        amountVnd: balance,
        reason: 'Chuyển từ tiền giữ chỗ',
        linkedHoldingTransactionId: holding.id,
        paidAt: toDbDate(onDate),
        createdBy: user.id,
      },
    });
    await tx.holdingTransaction.update({ where: { id: holding.id }, data: { linkedDepositTransactionId: deposit.id } });
    return balance;
  }

  /** Đảo cả cặp chuyển giữ chỗ → cọc trong cùng transaction; một phía lỗi thì rollback cả hai. */
  private async reversePair(tx: Prisma.TransactionClient, user: AuthUser, deposit: DepositTransaction, holding: HoldingTransaction, reason: string) {
    await lockRows(tx, 'tenancies', [deposit.tenancyId]);
    await lockRows(tx, 'reservations', [holding.reservationId]);
    const depositRev = await this.insertDepositReversal(tx, user, deposit, reason);
    const holdingRev = await this.insertHoldingReversal(tx, user, holding, reason);
    await tx.depositTransaction.update({ where: { id: depositRev.id }, data: { linkedHoldingTransactionId: holdingRev.id } });
    await tx.holdingTransaction.update({ where: { id: holdingRev.id }, data: { linkedDepositTransactionId: depositRev.id } });
    await this.assertNonNegativeDeposit(
      tx,
      deposit.tenancyId,
      'Không đảo được: phần cọc chuyển từ tiền giữ chỗ đã được áp dụng hoặc hoàn. Hãy đảo các giao dịch đó trước.',
    );
    await this.assertNonNegativeHolding(tx, holding.reservationId);
    await this.auditReverse(tx, user, 'holding_conversion.reverse_pair', deposit.tenancyId, deposit.id, reason);
  }

  private async insertHoldingReversal(tx: Prisma.TransactionClient, user: AuthUser, original: HoldingTransaction, reason: string) {
    const existing = await tx.holdingTransaction.findUnique({ where: { reversesTransactionId: original.id } });
    if (existing) throw new AppError('CONFLICT', 'Giao dịch này đã được đảo.');
    return tx.holdingTransaction.create({
      data: {
        workspaceId: original.workspaceId,
        reservationId: original.reservationId,
        type: 'REVERSAL',
        amountVnd: original.amountVnd,
        reason,
        reversesTransactionId: original.id,
        paidAt: toDbDate(this.clock.today()),
        createdBy: user.id,
      },
    });
  }

  private async assertNonNegativeHolding(tx: Db, reservationId: string, message = 'Số tiền vượt quá số dư tiền giữ chỗ.'): Promise<void> {
    const balance = ledgerBalance((await this.holdingTxs(tx, reservationId)).map(toLedger), HOLDING_SIGN);
    if (balance < 0n) throw new AppError('BUSINESS_RULE_VIOLATION', message);
  }

  // ------------------------------------------------------------------ Chung

  private async assertTenancyInScope(db: Db, user: AuthUser, tenancyId: string) {
    const t = await db.tenancy.findFirst({ where: { id: tenancyId, room: this.rooms.roomWhere(user) } });
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  private async assertReservationInScope(db: Db, user: AuthUser, reservationId: string) {
    const r = await db.reservation.findFirst({ where: { id: reservationId, room: this.rooms.roomWhere(user) } });
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private async auditReverse(tx: Prisma.TransactionClient, user: AuthUser, action: string, entityId: string, txId: string, reason: string, entityType = 'tenancy') {
    await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action, entityType, entityId, after: { transaction_id: txId }, reason });
  }

  private async toDtos<T extends DepositTransaction | HoldingTransaction>(
    txs: T[],
    signs: Record<string, 1 | -1>,
    linked: (t: T) => string | null,
  ): Promise<LedgerTxDto[]> {
    const ledger = txs.map(toLedger);
    const signed = signedAmounts(ledger, signs);
    const reversed = reversedIds(ledger);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(txs.map((t) => t.createdBy))] } }, select: { id: true, displayName: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.displayName]));
    return txs.map((t) => ({
      id: t.id,
      type: t.type,
      amount_vnd: t.amountVnd.toString(),
      signed_amount_vnd: (signed.get(t.id) ?? 0n).toString(),
      reason: t.reason,
      paid_at: dayOrNull(t.paidAt),
      method: t.method,
      reference: t.reference,
      reverses_transaction_id: t.reversesTransactionId,
      reversed: reversed.has(t.id),
      linked_transaction_id: linked(t),
      created_at: t.createdAt.toISOString(),
      created_by_name: nameOf.get(t.createdBy) ?? null,
    }));
  }
}
