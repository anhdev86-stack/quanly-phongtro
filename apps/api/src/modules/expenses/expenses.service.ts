import { Inject, Injectable } from '@nestjs/common';
import { type ExpenseDto, type expenseCreateSchema, type expenseListQuerySchema, type Paged } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { nextSequence, yymm } from '../../common/db/sequences.js';
import { day, iso, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { userNames } from '../utilities/user-names.js';

const include = { building: true, room: true } satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof include }>;

/**
 * Chi phí vận hành (V1.1, MASTER_PLAN 6.7). Ghi khi tiền đã thực chi; không sửa/xóa — sai thì đảo (cần finance.reverse, lý do,
 * audit). Chi theo tòa/phòng nằm trong phạm vi tòa; chi chung (không tòa) chỉ người có phạm vi mọi tòa thấy và ghi.
 * Hoàn cọc, hoàn tiền dư không phải chi phí (ghi ở sổ cọc / credit).
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Điều kiện phạm vi: chi chung chỉ cho người có mọi tòa. */
  scopeWhere(user: AuthUser, buildingId?: string): Prisma.ExpenseWhereInput {
    const scope: Prisma.ExpenseWhereInput = user.allBuildings ? {} : { buildingId: { in: [...user.buildingIds] } };
    return { AND: [{ workspaceId: user.workspaceId }, scope, ...(buildingId ? [{ buildingId }] : [])] };
  }

  async create(user: AuthUser, input: z.output<typeof expenseCreateSchema>, key: string | undefined) {
    if (input.spent_on > this.clock.today()) throw new AppError('VALIDATION_FAILED', undefined, { spent_on: ['Ngày chi không được ở tương lai.'] });
    const r = await this.idempotency.execute({ user, route: 'POST /expenses', key, payload: input, successStatus: 201 }, async (tx) => {
      let buildingId = input.building_id;
      if (input.room_id) {
        const room = await tx.room.findFirst({ where: { id: input.room_id, workspaceId: user.workspaceId } });
        if (!room || (buildingId && room.buildingId !== buildingId)) throw new AppError('VALIDATION_FAILED', undefined, { room_id: ['Phòng không thuộc tòa đã chọn.'] });
        buildingId = room.buildingId;
      }
      if (buildingId) {
        const b = await tx.building.findFirst({ where: { id: buildingId, workspaceId: user.workspaceId } });
        if (!b || (!user.allBuildings && !user.buildingIds.includes(buildingId))) throw new AppError('NOT_FOUND');
      } else if (!user.allBuildings) {
        throw new AppError('VALIDATION_FAILED', undefined, { building_id: ['Chọn tòa (chi chung cả nhà trọ cần phạm vi mọi tòa).'] });
      }
      const seq = await nextSequence(tx, user.workspaceId, 'EXPENSE', yymm(input.spent_on));
      const e = await tx.expense.create({
        data: {
          workspaceId: user.workspaceId,
          number: `PC-${yymm(input.spent_on)}-${String(seq).padStart(4, '0')}`,
          buildingId,
          roomId: input.room_id,
          category: input.category,
          amountVnd: BigInt(input.amount_vnd),
          spentOn: toDbDate(input.spent_on),
          method: input.method,
          payee: input.payee ?? null,
          note: input.note ?? null,
          createdBy: user.id,
        },
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'expense.create',
        entityType: 'expense',
        entityId: e.id,
        buildingId,
        after: { number: e.number, category: input.category, amount_vnd: input.amount_vnd, spent_on: input.spent_on, building_id: buildingId, room_id: input.room_id },
      });
      return { body: { id: e.id }, resultReference: e.id };
    });
    return { status: r.status, body: await this.get(user, r.body.id) };
  }

  async reverse(user: AuthUser, id: string, reason: string, key: string | undefined) {
    const r = await this.idempotency.execute({ user, route: `POST /expenses/${id}/reverse`, key, payload: { reason } }, async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "expenses" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const e = locked.length ? await tx.expense.findFirst({ where: { AND: [{ id }, this.scopeWhere(user)] } }) : null;
      if (!e) throw new AppError('NOT_FOUND');
      if (e.status === 'REVERSED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Khoản chi đã được đảo.');
      await tx.expense.update({ where: { id }, data: { status: 'REVERSED', reversedAt: this.clock.now(), reversedBy: user.id, reverseReason: reason } });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'expense.reverse',
        entityType: 'expense',
        entityId: id,
        buildingId: e.buildingId,
        reason,
        before: { number: e.number, amount_vnd: e.amountVnd, status: e.status },
      });
      return { body: { id } };
    });
    return { status: r.status, body: await this.get(user, r.body.id) };
  }

  async list(user: AuthUser, q: z.output<typeof expenseListQuerySchema>): Promise<Paged<ExpenseDto> & { total_vnd: string }> {
    const where: Prisma.ExpenseWhereInput = {
      AND: [
        this.scopeWhere(user, q.building_id),
        q.category ? { category: q.category } : {},
        q.status ? { status: q.status } : {},
        q.from || q.to ? { spentOn: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {},
      ],
    };
    const rows = await this.prisma.expense.findMany({ where, include, orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }] });
    const totalVnd = rows.filter((r) => r.status === 'POSTED').reduce((s, r) => s + r.amountVnd, 0n);
    const page = paged(await this.dtos(rows), q.page, q.page_size);
    return { ...page, total_vnd: totalVnd.toString() };
  }

  async get(user: AuthUser, id: string): Promise<ExpenseDto> {
    const row = await this.prisma.expense.findFirst({ where: { AND: [{ id }, this.scopeWhere(user)] }, include });
    if (!row) throw new AppError('NOT_FOUND');
    return (await this.dtos([row]))[0]!;
  }

  private async dtos(rows: ExpenseRow[]): Promise<ExpenseDto[]> {
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      building_id: r.buildingId,
      building_code: r.building?.code ?? null,
      room_id: r.roomId,
      room_code: r.room?.code ?? null,
      category: r.category,
      amount_vnd: r.amountVnd.toString(),
      spent_on: day(r.spentOn),
      method: r.method,
      payee: r.payee,
      note: r.note,
      status: r.status,
      reversed_at: iso(r.reversedAt),
      reverse_reason: r.reverseReason,
      created_by_name: names.get(r.createdBy) ?? null,
      created_at: iso(r.createdAt)!,
    }));
  }
}
