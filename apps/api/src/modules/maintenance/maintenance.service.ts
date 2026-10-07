import { Inject, Injectable } from '@nestjs/common';
import { type MaintenanceDto, type maintenanceCreateSchema, type maintenanceListQuerySchema, type maintenanceUpdateSchema, type Paged } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { nextSequence, yymm } from '../../common/db/sequences.js';
import { iso, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { OPEN_TENANCY_STATUSES, RoomsService } from '../rooms/rooms.service.js';
import { userNames } from '../utilities/user-names.js';

const include = { room: { include: { building: true } } } satisfies Prisma.MaintenanceRequestInclude;
type Row = Prisma.MaintenanceRequestGetPayload<{ include: typeof include }>;

/** Chuyển trạng thái hợp lệ. Đã xong/đã hủy có thể mở lại (về OPEN). */
const NEXT: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  IN_PROGRESS: ['OPEN', 'DONE', 'CANCELLED'],
  DONE: ['OPEN'],
  CANCELLED: ['OPEN'],
};

/**
 * Yêu cầu bảo trì (V1.1). Gắn phòng (và lần thuê đang mở nếu có). Không tự đổi trạng thái vận hành của phòng: việc đóng phòng để sửa
 * vẫn làm ở trang phòng. Có thể liên kết khoản chi đã ghi cho việc sửa. Phạm vi theo tòa của phòng.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly expenses: ExpensesService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: AuthUser, q: z.output<typeof maintenanceListQuerySchema>): Promise<Paged<MaintenanceDto>> {
    const rows = await this.prisma.maintenanceRequest.findMany({
      where: {
        workspaceId: user.workspaceId,
        room: { AND: [this.rooms.roomWhere(user), ...(q.building_id ? [{ buildingId: q.building_id }] : [])] },
        ...(q.room_id ? { roomId: q.room_id } : {}),
        ...(q.status ? { status: q.status } : q.open_only === 'true' ? { status: { in: ['OPEN', 'IN_PROGRESS'] as ('OPEN' | 'IN_PROGRESS')[] } } : {}),
      },
      include,
    });
    const rank = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;
    const active = (s: string) => (s === 'OPEN' || s === 'IN_PROGRESS' ? 0 : 1);
    rows.sort((a, b) => active(a.status) - active(b.status) || rank[a.priority] - rank[b.priority] || b.createdAt.getTime() - a.createdAt.getTime());
    return paged(await this.dtos(this.prisma, rows), q.page, q.page_size);
  }

  async get(user: AuthUser, id: string): Promise<MaintenanceDto> {
    return (await this.dtos(this.prisma, [await this.row(this.prisma, user, id)]))[0]!;
  }

  /** Số yêu cầu đang mở trong phạm vi (dùng cho “Việc cần xử lý”). */
  async openCount(user: AuthUser, buildingId?: string): Promise<number> {
    return this.prisma.maintenanceRequest.count({
      where: { workspaceId: user.workspaceId, status: { in: ['OPEN', 'IN_PROGRESS'] }, room: { AND: [this.rooms.roomWhere(user), ...(buildingId ? [{ buildingId }] : [])] } },
    });
  }

  async create(user: AuthUser, input: z.output<typeof maintenanceCreateSchema>): Promise<MaintenanceDto> {
    const id = await runInTransaction(this.prisma, async (tx) => {
      const room = await tx.room.findFirst({ where: { id: input.room_id, workspaceId: user.workspaceId, ...this.rooms.roomWhere(user) } });
      if (!room) throw new AppError('NOT_FOUND');
      if (input.assignee_id) await this.assertAssignee(tx, user, input.assignee_id);
      const tenancy = await tx.tenancy.findFirst({ where: { roomId: room.id, status: { in: [...OPEN_TENANCY_STATUSES] } }, select: { id: true } });
      const today = this.clock.today();
      const seq = await nextSequence(tx, user.workspaceId, 'MAINTENANCE', yymm(today));
      const m = await tx.maintenanceRequest.create({
        data: {
          workspaceId: user.workspaceId,
          code: `BT-${yymm(today)}-${String(seq).padStart(4, '0')}`,
          roomId: room.id,
          tenancyId: tenancy?.id ?? null,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          assigneeId: input.assignee_id,
          reportedBy: input.reported_by ?? null,
          createdBy: user.id,
        },
      });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'maintenance.create', entityType: 'room', entityId: room.id, after: { code: m.code, title: input.title, priority: input.priority } });
      return m.id;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, input: z.output<typeof maintenanceUpdateSchema>): Promise<MaintenanceDto> {
    await runInTransaction(this.prisma, async (tx) => {
      const before = await this.row(tx, user, id);
      await tx.$queryRaw`SELECT "id" FROM "maintenance_requests" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const cur = await tx.maintenanceRequest.findUniqueOrThrow({ where: { id } });
      if (cur.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      if (input.status && input.status !== cur.status && !NEXT[cur.status]!.includes(input.status)) {
        throw new AppError('BUSINESS_RULE_VIOLATION', 'Không chuyển được sang trạng thái này.', { status: ['Chuyển trạng thái không hợp lệ.'] });
      }
      if (input.assignee_id) await this.assertAssignee(tx, user, input.assignee_id);
      if (input.expense_id) {
        const e = await tx.expense.findFirst({ where: { AND: [{ id: input.expense_id, status: 'POSTED' }, this.expenses.scopeWhere(user)] } });
        if (!e) throw new AppError('VALIDATION_FAILED', undefined, { expense_id: ['Không tìm thấy khoản chi còn hiệu lực.'] });
      }
      const status = input.status ?? cur.status;
      const resolvedAt = status === 'DONE' ? (cur.status === 'DONE' ? cur.resolvedAt : this.clock.now()) : null;
      await tx.maintenanceRequest.update({
        where: { id },
        data: {
          status,
          resolvedAt,
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.assignee_id !== undefined ? { assigneeId: input.assignee_id } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description ?? null } : {}),
          ...(input.resolution_note !== undefined ? { resolutionNote: input.resolution_note ?? null } : {}),
          ...(input.expense_id !== undefined ? { expenseId: input.expense_id } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'maintenance.update',
        entityType: 'room',
        entityId: before.roomId,
        before: { code: cur.code, status: cur.status, priority: cur.priority, assignee_id: cur.assigneeId },
        after: { code: cur.code, ...input, expected_version: undefined },
      });
    });
    return this.get(user, id);
  }

  private async assertAssignee(db: Db, user: AuthUser, assigneeId: string) {
    const u = await db.user.findFirst({ where: { id: assigneeId, workspaceId: user.workspaceId, isActive: true } });
    if (!u) throw new AppError('VALIDATION_FAILED', undefined, { assignee_id: ['Người phụ trách không hợp lệ.'] });
  }

  private async row(db: Db, user: AuthUser, id: string): Promise<Row> {
    const r = await db.maintenanceRequest.findFirst({ where: { id, workspaceId: user.workspaceId, room: this.rooms.roomWhere(user) }, include });
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private async dtos(db: Db, rows: Row[]): Promise<MaintenanceDto[]> {
    const names = await userNames(db, rows.flatMap((r) => [r.assigneeId, r.createdBy]));
    const expenseIds = rows.map((r) => r.expenseId).filter((x): x is string => !!x);
    const expenses = expenseIds.length ? await db.expense.findMany({ where: { id: { in: expenseIds } }, select: { id: true, number: true } }) : [];
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      room_id: r.roomId,
      room_code: r.room.code,
      building_code: r.room.building.code,
      tenancy_id: r.tenancyId,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      assignee_id: r.assigneeId,
      assignee_name: r.assigneeId ? (names.get(r.assigneeId) ?? null) : null,
      reported_by: r.reportedBy,
      resolved_at: iso(r.resolvedAt),
      resolution_note: r.resolutionNote,
      expense_id: r.expenseId,
      expense_number: expenses.find((e) => e.id === r.expenseId)?.number ?? null,
      created_by_name: names.get(r.createdBy) ?? null,
      created_at: iso(r.createdAt)!,
      version: r.version,
    }));
  }
}
