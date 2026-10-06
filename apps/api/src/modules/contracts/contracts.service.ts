import { Inject, Injectable } from '@nestjs/common';
import {
  type ContractDto,
  type contractCancelSchema,
  type contractCreateSchema,
  type contractListQuerySchema,
  type contractSignSchema,
  type Paged,
  PERMISSIONS,
  type rentPriceCreateSchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode, violatedConstraint } from '../../common/db/pg-errors.js';
import { nextSequence, yymm } from '../../common/db/sequences.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { day, dayOrNull, naturalCompare, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { contractStatus, type ContractDates, daysUntil, latestStartedSigned } from '../../domain/contracts/contract-status.js';
import { addMonths, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { Contract, Prisma, Tenancy } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { RoomsService } from '../rooms/rooms.service.js';

type CreateInput = z.output<typeof contractCreateSchema>;

interface Terms {
  notice_days: number;
  deposit_required_vnd: string | null;
  monthly_rent_vnd: string | null;
  terms_note: string | null;
}

const include = {
  tenancy: {
    include: {
      room: { include: { building: true } },
      members: { where: { role: 'PRIMARY' as const }, include: { tenant: true }, orderBy: { joinedOn: 'desc' as const } },
    },
  },
} satisfies Prisma.ContractInclude;
type ContractFull = Prisma.ContractGetPayload<{ include: typeof include }>;

export const toDates = (c: Pick<Contract, 'lifecycle' | 'termStart' | 'termEnd' | 'terminatedOn'>): ContractDates => ({
  lifecycle: c.lifecycle,
  termStart: fromDbDate(c.termStart),
  termEnd: fromDbDate(c.termEnd),
  terminatedOn: c.terminatedOn ? fromDbDate(c.terminatedOn) : null,
});

/** Hợp đồng và giá thuê (MASTER_PLAN 5.3, 7.3, 7.4; D-022 giảm giá theo tháng). */
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ Đọc

  async list(user: AuthUser, q: z.output<typeof contractListQuerySchema>): Promise<Paged<ContractDto>> {
    const rows = await this.prisma.contract.findMany({
      where: {
        workspaceId: user.workspaceId,
        tenancy: { room: { ...this.rooms.roomWhere(user), ...(q.building_id ? { buildingId: q.building_id } : {}) } },
        ...(q.tenancy_id ? { tenancyId: q.tenancy_id } : {}),
      },
      include,
      orderBy: [{ termStart: 'desc' }, { createdAt: 'desc' }],
    });
    let dtos = rows.map((r) => this.toDto(r));
    if (q.status) dtos = dtos.filter((c) => c.status === q.status);
    if (q.expiring_within_days !== undefined) {
      const n = q.expiring_within_days;
      // Hợp đồng đang hiệu lực, tenancy chưa kết thúc, chưa có kỳ tiếp theo đã ký.
      const renewed = new Set(rows.filter((r) => r.lifecycle === 'SIGNED' && r.previousContractId).map((r) => r.previousContractId));
      dtos = dtos
        .filter((c) => c.status === 'ACTIVE' && c.tenancy_status !== 'ENDED' && c.days_to_expiry !== null && c.days_to_expiry <= n && !renewed.has(c.id))
        .sort((a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0));
    }
    if (!q.tenancy_id && q.expiring_within_days === undefined) {
      dtos.sort((a, b) => naturalCompare(a.building_code, b.building_code) || naturalCompare(a.room_code, b.room_code) || (a.term_start < b.term_start ? 1 : -1));
    }
    return paged(dtos, q.page, q.page_size);
  }

  async get(user: AuthUser, id: string): Promise<ContractDto> {
    return this.toDto(await this.getRow(this.prisma, user, id));
  }

  private async getRow(db: Db, user: AuthUser, id: string): Promise<ContractFull> {
    const row = await db.contract.findFirst({ where: { id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } }, include });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  // ------------------------------------------------------------------ Tạo, gia hạn, ký

  /** Tạo hợp đồng (nháp hoặc đã ký) cho lần thuê. Gia hạn dùng cùng hàm với previous = kỳ SIGNED gần nhất. */
  async create(user: AuthUser, tenancyId: string, input: CreateInput, renewal = false): Promise<ContractDto> {
    const id = await this.mapErrors(() =>
      runInTransaction(this.prisma, async (tx) => {
        await lockRows(tx, 'tenancies', [tenancyId]);
        const tenancy = await this.tenancyInScope(tx, user, tenancyId);
        const c = await this.createInTx(tx, user, tenancy, input, renewal);
        return c.id;
      }),
    );
    return this.get(user, id);
  }

  async createInTx(tx: Prisma.TransactionClient, user: AuthUser, tenancy: Tenancy, input: CreateInput, renewal: boolean): Promise<Contract> {
    if (tenancy.status === 'ENDED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê đã kết thúc.');
    if (input.term_start < fromDbDate(tenancy.startDate)) {
      throw new AppError('BUSINESS_RULE_VIOLATION', 'Hợp đồng không bắt đầu trước ngày nhận phòng.', { term_start: ['Trước ngày nhận phòng.'] });
    }
    const existing = await tx.contract.findMany({ where: { tenancyId: tenancy.id } });
    const previous = renewal
      ? (existing.filter((c) => c.lifecycle === 'SIGNED').sort((a, b) => a.termEnd.getTime() - b.termEnd.getTime()).at(-1) ?? null)
      : null;
    if (renewal && !previous) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chưa có hợp đồng đã ký để gia hạn. Hãy tạo hợp đồng mới.');

    const today = this.clock.today();
    const seq = await nextSequence(tx, user.workspaceId, 'CONTRACT', yymm(today));
    const terms: Terms = {
      notice_days: input.notice_days,
      deposit_required_vnd: input.deposit_required_vnd ?? (await this.requiredDepositOn(tx, tenancy, input.term_start)).toString(),
      monthly_rent_vnd: input.monthly_rent_vnd ?? (await this.rentOn(tx, tenancy.id, input.term_start))?.toString() ?? null,
      terms_note: input.terms_note,
    };
    const contract = await tx.contract.create({
      data: {
        workspaceId: user.workspaceId,
        tenancyId: tenancy.id,
        code: `HD${yymm(today)}-${String(seq).padStart(4, '0')}`,
        termStart: toDbDate(input.term_start),
        termEnd: toDbDate(input.term_end),
        previousContractId: previous?.id ?? null,
        termsSnapshot: terms as unknown as Prisma.InputJsonValue,
        createdBy: user.id,
      },
    });
    await this.audit.record(tx, {
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: renewal ? 'contract.renew' : 'contract.create',
      entityType: 'contract',
      entityId: contract.id,
      after: { tenancy_id: tenancy.id, ...input },
    });
    if (input.signed) {
      return this.signInTx(tx, user, contract, tenancy, input.signed_at ?? today, input.confirm_mid_month_price);
    }
    return contract;
  }

  async sign(user: AuthUser, id: string, input: z.output<typeof contractSignSchema>): Promise<ContractDto> {
    await this.mapErrors(() =>
      runInTransaction(this.prisma, async (tx) => {
        const row = await this.getRow(tx, user, id);
        await lockRows(tx, 'tenancies', [row.tenancyId]);
        if (row.lifecycle !== 'DRAFT') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ ký được hợp đồng nháp.');
        if (row.tenancy.status === 'ENDED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê đã kết thúc.');
        await updateVersioned(tx.contract, { id, workspaceId: user.workspaceId }, input.expected_version, {});
        const fresh = await tx.contract.findUniqueOrThrow({ where: { id } });
        await this.signInTx(tx, user, fresh, row.tenancy, input.signed_at, input.confirm_mid_month_price);
      }),
    );
    return this.get(user, id);
  }

  /**
   * Ký: chuyển SIGNED (EXCLUDE chặn chồng kỳ). Giá theo hợp đồng khác giá hiện hành thì tạo phiên bản giá
   * có source_contract_id, hiệu lực từ term_start (MASTER_PLAN 7.4).
   */
  private async signInTx(tx: Prisma.TransactionClient, user: AuthUser, contract: Contract, tenancy: Tenancy, signedAt: string, confirmMidMonth: boolean) {
    const signed = await tx.contract.update({
      where: { id: contract.id },
      data: { lifecycle: 'SIGNED', signedAt: toDbDate(signedAt), version: { increment: 1 } },
    });
    const terms = contract.termsSnapshot as unknown as Terms;
    const start = fromDbDate(contract.termStart);
    if (terms.monthly_rent_vnd !== null) {
      const current = await this.rentOn(tx, tenancy.id, start);
      if (current === null || current !== BigInt(terms.monthly_rent_vnd)) {
        this.assertMonthBoundary(start, confirmMidMonth, 'confirm_mid_month_price');
        await tx.rentPriceHistory.create({
          data: {
            tenancyId: tenancy.id,
            effectiveFrom: toDbDate(start),
            monthlyRentVnd: BigInt(terms.monthly_rent_vnd),
            sourceContractId: contract.id,
            reason: `Giá theo hợp đồng ${contract.code}`,
            createdBy: user.id,
          },
        });
      }
    }
    await tx.tenancy.update({ where: { id: tenancy.id }, data: { noticeDaysSnapshot: terms.notice_days } });
    await this.audit.record(tx, {
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: 'contract.sign',
      entityType: 'contract',
      entityId: contract.id,
      after: { signed_at: signedAt, term_start: start, term_end: fromDbDate(contract.termEnd) },
    });
    return signed;
  }

  // ------------------------------------------------------------------ Hủy

  /**
   * Hủy nháp, hoặc hủy hợp đồng SIGNED chưa bắt đầu (cần contracts.cancel_signed). Mọi phiên bản giá/dịch vụ
   * phát sinh từ hợp đồng bị vô hiệu hóa trong cùng transaction, có lịch sử (MASTER_PLAN 5.3).
   */
  async cancel(user: AuthUser, id: string, input: z.output<typeof contractCancelSchema>) {
    const result = await runInTransaction(this.prisma, async (tx) => {
      const row = await this.getRow(tx, user, id);
      await lockRows(tx, 'tenancies', [row.tenancyId]);
      const status = contractStatus(toDates(row), this.clock.today());
      if (status === 'CANCELLED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Hợp đồng đã hủy.');
      if (row.lifecycle === 'SIGNED') {
        if (status !== 'SCHEDULED') {
          throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ hủy được hợp đồng đã ký nhưng chưa bắt đầu. Hợp đồng đang hiệu lực kết thúc qua quy trình trả phòng.');
        }
        if (!user.permissions.has(PERMISSIONS.CONTRACTS_CANCEL_SIGNED)) throw new AppError('FORBIDDEN');
      }
      await updateVersioned(tx.contract, { id, workspaceId: user.workspaceId }, input.expected_version, {
        lifecycle: 'CANCELLED',
        cancelledAt: this.clock.now(),
        cancellationReason: input.reason,
      });
      const voided = await this.voidDependents(tx, user, id, input.reason);
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: row.lifecycle === 'SIGNED' ? 'contract.cancel_signed' : 'contract.cancel_draft',
        entityType: 'contract',
        entityId: id,
        reason: input.reason,
        after: voided,
      });
      return voided;
    });
    return { ...(await this.get(user, id)), voided_rent_price_ids: result.rent, voided_service_ids: result.services };
  }

  /** Vô hiệu hóa giá và dịch vụ có source_contract_id = hợp đồng; không đụng tới thay đổi độc lập. */
  async voidDependents(tx: Prisma.TransactionClient, user: AuthUser, contractId: string, reason: string) {
    const now = this.clock.now();
    const data = { status: 'VOIDED' as const, voidedAt: now, voidedBy: user.id, voidReason: `Hủy hợp đồng: ${reason}` };
    const rent = await tx.rentPriceHistory.findMany({ where: { sourceContractId: contractId, status: 'ACTIVE' }, select: { id: true } });
    const services = await tx.tenancyService.findMany({ where: { sourceContractId: contractId, status: 'ACTIVE' }, select: { id: true } });
    if (rent.length) await tx.rentPriceHistory.updateMany({ where: { id: { in: rent.map((r) => r.id) } }, data });
    if (services.length) await tx.tenancyService.updateMany({ where: { id: { in: services.map((s) => s.id) } }, data });
    return { rent: rent.map((r) => r.id), services: services.map((s) => s.id) };
  }

  // ------------------------------------------------------------------ Giá thuê

  async listRentPrices(user: AuthUser, tenancyId: string) {
    await this.tenancyInScope(this.prisma, user, tenancyId);
    const rows = await this.prisma.rentPriceHistory.findMany({ where: { tenancyId }, orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((p) => ({
      id: p.id,
      effective_from: day(p.effectiveFrom),
      monthly_rent_vnd: p.monthlyRentVnd.toString(),
      source_contract_id: p.sourceContractId,
      reason: p.reason,
      status: p.status,
      void_reason: p.voidReason,
    }));
  }

  /**
   * Đổi giá có hiệu lực từ ngày (MASTER_PLAN 4.4). Mặc định từ đầu tháng; giữa tháng cần xác nhận.
   * only_month (D-022): áp dụng đúng một tháng rồi tự quay về giá trước đó.
   */
  async createRentPrice(user: AuthUser, tenancyId: string, input: z.output<typeof rentPriceCreateSchema>) {
    await this.mapErrors(() =>
      runInTransaction(this.prisma, async (tx) => {
        await lockRows(tx, 'tenancies', [tenancyId]);
        const tenancy = await this.tenancyInScope(tx, user, tenancyId);
        if (tenancy.status === 'ENDED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê đã kết thúc.');
        if (input.effective_from < fromDbDate(tenancy.startDate)) {
          throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày hiệu lực trước ngày nhận phòng.', { effective_from: ['Trước ngày nhận phòng.'] });
        }
        this.assertMonthBoundary(input.effective_from, input.confirm_mid_month, 'confirm_mid_month');
        const previous = await this.rentOn(tx, tenancyId, input.effective_from, true);
        await tx.rentPriceHistory.create({
          data: { tenancyId, effectiveFrom: toDbDate(input.effective_from), monthlyRentVnd: BigInt(input.monthly_rent_vnd), reason: input.reason, createdBy: user.id },
        });
        let restoreFrom: string | null = null;
        if (input.only_month && previous !== null) {
          restoreFrom = addMonths(input.effective_from, 1);
          const later = await tx.rentPriceHistory.findFirst({
            where: { tenancyId, status: 'ACTIVE', effectiveFrom: { gt: toDbDate(input.effective_from), lte: toDbDate(restoreFrom) } },
          });
          // Tháng sau đã có phiên bản giá khác thì không tạo phiên bản khôi phục (D-022).
          if (!later) {
            await tx.rentPriceHistory.create({
              data: { tenancyId, effectiveFrom: toDbDate(restoreFrom), monthlyRentVnd: previous, reason: `Khôi phục giá sau điều chỉnh tháng ${input.effective_from.slice(0, 7)}`, createdBy: user.id },
            });
          } else restoreFrom = null;
        }
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: input.only_month ? 'rent.change_one_month' : 'rent.change',
          entityType: 'tenancy',
          entityId: tenancyId,
          reason: input.reason,
          before: { monthly_rent_vnd: previous },
          after: { ...input, restore_from: restoreFrom },
        });
      }),
    );
    return this.listRentPrices(user, tenancyId);
  }

  // ------------------------------------------------------------------ Hỗ trợ

  /** Giá ACTIVE có hiệu lực tại ngày; strictBefore = chỉ xét phiên bản bắt đầu trước ngày đó. */
  async rentOn(db: Db, tenancyId: string, onDate: string, strictBefore = false): Promise<bigint | null> {
    const p = await db.rentPriceHistory.findFirst({
      where: { tenancyId, status: 'ACTIVE', effectiveFrom: strictBefore ? { lt: toDbDate(onDate) } : { lte: toDbDate(onDate) } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return p?.monthlyRentVnd ?? null;
  }

  /** Mức cọc yêu cầu hiện hành: từ hợp đồng SIGNED đã bắt đầu gần nhất, ngược lại giá trị lúc nhận phòng (7.4). */
  async requiredDepositOn(db: Db, tenancy: Pick<Tenancy, 'id' | 'initialDepositRequiredVnd'>, onDate: string): Promise<bigint> {
    const contracts = await db.contract.findMany({ where: { tenancyId: tenancy.id, lifecycle: 'SIGNED' } });
    const current = latestStartedSigned(contracts.map((c) => ({ ...toDates(c), terms: c.termsSnapshot as unknown as Terms })), onDate);
    const value = current?.terms.deposit_required_vnd;
    return value !== null && value !== undefined ? BigInt(value) : tenancy.initialDepositRequiredVnd;
  }

  private assertMonthBoundary(date: string, confirmed: boolean, field: string) {
    if (!date.endsWith('-01') && !confirmed) {
      throw new AppError(
        'BUSINESS_RULE_VIOLATION',
        'Giá mới có hiệu lực giữa tháng: tiền phòng tháng đó sẽ chia theo ngày. Hãy xác nhận để tiếp tục.',
        { [field]: ['Cần xác nhận đổi giá giữa tháng.'] },
      );
    }
  }

  private async tenancyInScope(db: Db, user: AuthUser, tenancyId: string): Promise<Tenancy> {
    const t = await db.tenancy.findFirst({ where: { id: tenancyId, room: this.rooms.roomWhere(user) } });
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  private async mapErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const code = pgErrorCode(error);
      const constraint = violatedConstraint(error);
      if (code === PG.EXCLUSION_VIOLATION && constraint === 'no_overlapping_signed_contracts') {
        throw new AppError('CONFLICT', 'Trùng thời gian với một kỳ hợp đồng đã ký của lần thuê này.', { term_start: ['Chồng kỳ hợp đồng đã ký.'] });
      }
      if (code === PG.UNIQUE_VIOLATION && constraint === 'one_active_rent_price_per_day') {
        throw new AppError('CONFLICT', 'Đã có một mức giá có hiệu lực từ đúng ngày này.', { effective_from: ['Trùng ngày hiệu lực.'] });
      }
      throw error;
    }
  }

  toDto(r: ContractFull): ContractDto {
    const today = this.clock.today();
    const dates = toDates(r);
    const status = contractStatus(dates, today);
    const terms = r.termsSnapshot as unknown as Terms;
    return {
      id: r.id,
      code: r.code,
      tenancy_id: r.tenancyId,
      tenancy_code: r.tenancy.code,
      tenancy_status: r.tenancy.status,
      room_id: r.tenancy.roomId,
      room_code: r.tenancy.room.code,
      building_code: r.tenancy.room.building.code,
      primary_tenant_name: r.tenancy.members[0]?.tenant.fullName ?? null,
      term_start: dates.termStart,
      term_end: dates.termEnd,
      lifecycle: r.lifecycle,
      status,
      signed_at: dayOrNull(r.signedAt),
      terminated_on: dates.terminatedOn,
      previous_contract_id: r.previousContractId,
      terms: {
        notice_days: terms.notice_days ?? 30,
        deposit_required_vnd: terms.deposit_required_vnd ?? null,
        monthly_rent_vnd: terms.monthly_rent_vnd ?? null,
        terms_note: terms.terms_note ?? null,
      },
      days_to_expiry: r.lifecycle === 'SIGNED' ? daysUntil(today, dates.termEnd) : null,
      cancellation_reason: r.cancellationReason,
      version: r.version,
    };
  }
}
