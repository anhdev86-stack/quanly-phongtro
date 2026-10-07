import { Inject, Injectable } from '@nestjs/common';
import { type periodCloseSchema, type periodReopenSchema, type StatementPeriodDto } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { type DateOnly, firstDayOfMonth, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { userNames } from '../utilities/user-names.js';

const label = (monthStart: DateOnly) => `${monthStart.slice(5, 7)}/${monthStart.slice(0, 4)}`;

/**
 * Kiểm tra tháng phát hành còn mở (V1.1, MASTER_PLAN 8.7, T36). Gọi trong transaction: khóa FOR SHARE dòng kỳ để không chạy
 * song song với thao tác đóng kỳ (đóng kỳ khóa FOR UPDATE). Tháng chưa có dòng kỳ coi như mở.
 */
export async function assertPeriodOpen(db: Db, workspaceId: string, monthStart: DateOnly, action = 'thay đổi chứng từ'): Promise<void> {
  const rows = await db.$queryRaw<{ status: string }[]>`
    SELECT "status"::text AS status FROM "statement_periods"
    WHERE "workspace_id" = ${workspaceId}::uuid AND "month_start" = ${monthStart}::date FOR SHARE`;
  if (rows[0]?.status === 'CLOSED') {
    throw new AppError('BUSINESS_RULE_VIOLATION', `Tháng ${label(monthStart)} đã đóng, không ${action}. Người có quyền mở lại kỳ (kèm lý do) trước khi sửa.`);
  }
}

/** Tháng của chứng từ: tháng phát hành nếu có, ngược lại tháng của ngày lập (D-033). */
export const invoiceMonth = (inv: { issueDate: Date; statementPeriod: { monthStart: Date } | null }): DateOnly =>
  inv.statementPeriod ? fromDbDate(inv.statementPeriod.monthStart) : firstDayOfMonth(fromDbDate(inv.issueDate));

/**
 * Đóng/mở lại tháng phát hành (V1.1). Đóng kỳ áp cho cả nhà trọ nên cần phạm vi mọi tòa; còn nháp trong kỳ thì không đóng được.
 * Kỳ CLOSED chặn tạo/tính lại/phát hành/hủy chứng từ và nhập/sửa chỉ số của kỳ; thu tiền vào nợ cũ vẫn làm bình thường.
 */
@Injectable()
export class PeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: AuthUser): Promise<StatementPeriodDto[]> {
    const periods = await this.prisma.statementPeriod.findMany({ where: { workspaceId: user.workspaceId }, orderBy: { monthStart: 'desc' }, take: 36 });
    const counts = await this.prisma.invoice.groupBy({
      by: ['statementPeriodId', 'lifecycle'],
      where: { workspaceId: user.workspaceId, type: 'MONTHLY', tenancy: { room: this.rooms.roomWhere(user) } },
      _count: { _all: true },
    });
    const names = await userNames(this.prisma, periods.map((p) => p.closedBy));
    return periods.map((p) => ({
      id: p.id,
      period: fromDbDate(p.monthStart).slice(0, 7),
      month_start: fromDbDate(p.monthStart),
      status: p.status,
      draft_count: counts.find((c) => c.statementPeriodId === p.id && c.lifecycle === 'DRAFT')?._count._all ?? 0,
      published_count: counts.find((c) => c.statementPeriodId === p.id && c.lifecycle === 'PUBLISHED')?._count._all ?? 0,
      closed_at: iso(p.closedAt),
      closed_by_name: p.closedBy ? (names.get(p.closedBy) ?? null) : null,
      reopened_at: iso(p.reopenedAt),
      reopen_reason: p.reopenReason,
      version: p.version,
    }));
  }

  async close(user: AuthUser, id: string, input: z.output<typeof periodCloseSchema>): Promise<StatementPeriodDto> {
    this.assertWorkspaceWide(user);
    await runInTransaction(this.prisma, async (tx) => {
      const p = await this.lockPeriod(tx, user, id);
      if (p.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      if (p.status === 'CLOSED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Kỳ đã đóng.');
      const monthStart = fromDbDate(p.monthStart);
      if (monthStart >= firstDayOfMonth(this.clock.today())) {
        throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ đóng được tháng đã qua.');
      }
      const drafts = await tx.invoice.count({ where: { statementPeriodId: id, lifecycle: 'DRAFT' } });
      if (drafts > 0) throw new AppError('BUSINESS_RULE_VIOLATION', `Kỳ ${label(monthStart)} còn ${drafts} thông báo nháp. Phát hành hoặc hủy nháp trước khi đóng kỳ.`);
      await tx.statementPeriod.update({ where: { id }, data: { status: 'CLOSED', closedAt: this.clock.now(), closedBy: user.id, version: { increment: 1 } } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'billing.period_close', entityType: 'statement_period', entityId: id, after: { period: monthStart.slice(0, 7) } });
    });
    return this.one(user, id);
  }

  async reopen(user: AuthUser, id: string, input: z.output<typeof periodReopenSchema>): Promise<StatementPeriodDto> {
    this.assertWorkspaceWide(user);
    await runInTransaction(this.prisma, async (tx) => {
      const p = await this.lockPeriod(tx, user, id);
      if (p.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      if (p.status !== 'CLOSED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Kỳ đang mở.');
      await tx.statementPeriod.update({
        where: { id },
        data: { status: 'OPEN', closedAt: null, closedBy: null, reopenedAt: this.clock.now(), reopenedBy: user.id, reopenReason: input.reason, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'billing.period_reopen',
        entityType: 'statement_period',
        entityId: id,
        reason: input.reason,
        before: { closed_at: p.closedAt, closed_by: p.closedBy },
        after: { period: fromDbDate(p.monthStart).slice(0, 7) },
      });
    });
    return this.one(user, id);
  }

  /** Đảm bảo có dòng kỳ cho tháng (tạo OPEN nếu chưa có). */
  async ensure(db: Db, workspaceId: string, monthStart: DateOnly) {
    return db.statementPeriod.upsert({
      where: { workspaceId_monthStart: { workspaceId, monthStart: toDbDate(monthStart) } },
      update: {},
      create: { workspaceId, monthStart: toDbDate(monthStart) },
    });
  }

  private assertWorkspaceWide(user: AuthUser) {
    // Đóng/mở kỳ áp cho mọi tòa: người chỉ được giao một số tòa không thao tác được.
    if (!user.allBuildings) throw new AppError('FORBIDDEN', 'Đóng/mở kỳ áp dụng cho mọi tòa; cần phạm vi mọi tòa.');
  }

  private async lockPeriod(tx: Prisma.TransactionClient, user: AuthUser, id: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "statement_periods" WHERE "id" = ${id}::uuid AND "workspace_id" = ${user.workspaceId}::uuid FOR UPDATE`;
    if (!locked.length) throw new AppError('NOT_FOUND');
    return tx.statementPeriod.findUniqueOrThrow({ where: { id } });
  }

  private async one(user: AuthUser, id: string): Promise<StatementPeriodDto> {
    return (await this.list(user)).find((p) => p.id === id)!;
  }
}
