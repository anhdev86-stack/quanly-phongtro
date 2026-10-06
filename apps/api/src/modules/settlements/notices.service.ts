import { Inject, Injectable } from '@nestjs/common';
import { type NoticeDto, type noticeCreateSchema, PERMISSIONS } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { day, iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { diffDays, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { MoveOutNotice, Tenancy } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { userNames } from '../utilities/user-names.js';

/**
 * Báo trả và hủy báo trả (MASTER_PLAN 7.5): ACTIVE → NOTICE_GIVEN, phòng vẫn OCCUPIED, không dừng tính phí tại ngày dự kiến.
 * Báo trả lùi ngày cần quyền và lý do. Hủy báo trả lưu lịch sử; giữ phòng của khách mới không tự hủy (hiện “xung đột lịch”).
 */
@Injectable()
export class NoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: AuthUser, tenancyId: string): Promise<NoticeDto[]> {
    const t = await this.tenancy(this.prisma, user, tenancyId);
    const rows = await this.prisma.moveOutNotice.findMany({ where: { tenancyId }, orderBy: { createdAt: 'desc' } });
    return this.dtos(rows, t);
  }

  async create(user: AuthUser, tenancyId: string, input: z.output<typeof noticeCreateSchema>): Promise<NoticeDto[]> {
    const today = this.clock.today();
    if (input.notice_date > today) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày báo không được ở tương lai.', { notice_date: ['Ngày ở tương lai.'] });
    if (input.notice_date < today) {
      if (!user.permissions.has(PERMISSIONS.SETTLEMENT_APPROVE)) throw new AppError('FORBIDDEN', 'Ghi nhận báo trả lùi ngày cần quyền duyệt quyết toán.');
      if (!input.reason) throw new AppError('BUSINESS_RULE_VIOLATION', 'Báo trả lùi ngày cần ghi lý do.', { reason: ['Cần lý do.'] });
    }
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [tenancyId]);
      const t = await this.tenancy(tx, user, tenancyId);
      if (t.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      if (t.status !== 'ACTIVE') throw new AppError('BUSINESS_RULE_VIOLATION', t.status === 'NOTICE_GIVEN' ? 'Lần thuê đã có báo trả.' : 'Lần thuê không còn ở trạng thái đang thuê.');
      if (input.planned_last_charge_date < fromDbDate(t.startDate)) {
        throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày dự kiến trả trước ngày nhận phòng.', { planned_last_charge_date: ['Trước ngày nhận phòng.'] });
      }
      const n = await tx.moveOutNotice.create({
        data: {
          workspaceId: user.workspaceId,
          tenancyId,
          noticeDate: toDbDate(input.notice_date),
          plannedLastChargeDate: toDbDate(input.planned_last_charge_date),
          reason: input.reason,
          createdBy: user.id,
        },
      });
      await tx.tenancy.update({ where: { id: tenancyId }, data: { status: 'NOTICE_GIVEN', version: { increment: 1 } } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'notice.create', entityType: 'tenancy', entityId: tenancyId, after: { notice_id: n.id, ...input } });
    });
    return this.list(user, tenancyId);
  }

  async cancel(user: AuthUser, noticeId: string, reason: string): Promise<NoticeDto[]> {
    const n = await this.prisma.moveOutNotice.findFirst({ where: { id: noticeId, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } } });
    if (!n) throw new AppError('NOT_FOUND');
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [n.tenancyId]);
      const cur = await tx.moveOutNotice.findUniqueOrThrow({ where: { id: noticeId } });
      if (cur.status !== 'ACTIVE') throw new AppError('BUSINESS_RULE_VIOLATION', 'Báo trả không còn hiệu lực.');
      const live = await tx.moveOutSettlement.findFirst({ where: { tenancyId: n.tenancyId, status: { in: ['DRAFT', 'APPROVED'] } } });
      if (live) throw new AppError('BUSINESS_RULE_VIOLATION', 'Đang có quyết toán trả phòng; hủy quyết toán trước.');
      await tx.moveOutNotice.update({ where: { id: noticeId }, data: { status: 'CANCELLED', cancelledAt: this.clock.now(), cancelledBy: user.id, cancelReason: reason } });
      await tx.tenancy.updateMany({ where: { id: n.tenancyId, status: 'NOTICE_GIVEN' }, data: { status: 'ACTIVE', version: { increment: 1 } } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'notice.cancel', entityType: 'tenancy', entityId: n.tenancyId, reason, after: { notice_id: noticeId } });
    });
    return this.list(user, n.tenancyId);
  }

  private async tenancy(db: Db, user: AuthUser, id: string): Promise<Tenancy> {
    const t = await db.tenancy.findFirst({ where: { id, room: this.rooms.roomWhere(user) } });
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  private async dtos(rows: MoveOutNotice[], t: Tenancy): Promise<NoticeDto[]> {
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    return rows.map((r) => {
      const given = diffDays(day(r.noticeDate), day(r.plannedLastChargeDate)) + 1;
      return {
        id: r.id,
        tenancy_id: r.tenancyId,
        notice_date: day(r.noticeDate),
        planned_last_charge_date: day(r.plannedLastChargeDate),
        status: r.status,
        reason: r.reason,
        cancel_reason: r.cancelReason,
        created_by_name: names.get(r.createdBy) ?? null,
        created_at: iso(r.createdAt)!,
        short_notice_days: Math.max(0, t.noticeDaysSnapshot - given),
      };
    });
  }
}
