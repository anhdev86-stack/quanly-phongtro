import { Inject, Injectable } from '@nestjs/common';
import type {
  Paged,
  Reservation,
  reservationCancelSchema,
  reservationCreateSchema,
  reservationListQuerySchema,
  reservationRescheduleSchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode } from '../../common/db/pg-errors.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { day, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import { reservationDisplayStatus } from '../../domain/rooms/room-status.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { RoomsService } from '../rooms/rooms.service.js';

const OVERLAP_MESSAGE = 'Trùng lịch với một lượt giữ phòng khác của phòng này.';

type ReservationRow = Prisma.ReservationGetPayload<{ include: { room: { include: { building: true } } } }>;

/** Hook cho các phase sau: số dư tiền giữ chỗ (Phase 2), xung đột lịch với báo trả (Phase 7). */
export interface ReservationExtras {
  holdingBalances(db: Db, reservationIds: string[]): Promise<Map<string, bigint>>;
  scheduleConflicts(db: Db, reservations: { id: string; roomId: string; holdFrom: string }[]): Promise<Set<string>>;
  /** Ném lỗi nếu phòng đang có khách mà lịch giữ chỗ không hợp lệ (MASTER_PLAN 5.6). */
  assertNotBlockedByTenancy(db: Db, roomId: string, holdFrom: string): Promise<void>;
}

export const RESERVATION_EXTRAS = Symbol('RESERVATION_EXTRAS');

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RESERVATION_EXTRAS) private readonly extras: ReservationExtras,
  ) {}

  async list(user: AuthUser, q: z.output<typeof reservationListQuerySchema>): Promise<Paged<Reservation>> {
    const rows = await this.prisma.reservation.findMany({
      where: {
        room: { ...this.rooms.roomWhere(user), ...(q.building_id ? { buildingId: q.building_id } : {}) },
        ...(q.room_id ? { roomId: q.room_id } : {}),
      },
      include: { room: { include: { building: true } } },
      orderBy: [{ holdFrom: 'desc' }],
    });
    let dtos = await this.toDtos(this.prisma, rows);
    if (q.status) dtos = dtos.filter((r) => r.display_status === q.status);
    return paged(dtos, q.page, q.page_size);
  }

  async get(user: AuthUser, id: string): Promise<Reservation> {
    const row = await this.getRow(this.prisma, user, id);
    return (await this.toDtos(this.prisma, [row]))[0]!;
  }

  async getRow(db: Db, user: AuthUser, id: string): Promise<ReservationRow> {
    const row = await db.reservation.findFirst({
      where: { id, room: this.rooms.roomWhere(user) },
      include: { room: { include: { building: true } } },
    });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  async create(user: AuthUser, input: z.output<typeof reservationCreateSchema>): Promise<Reservation> {
    const today = this.clock.today();
    if (input.hold_until < today) throw new AppError('BUSINESS_RULE_VIOLATION', 'Hạn giữ chỗ đã qua.', { hold_until: ['Hạn giữ chỗ đã qua.'] });
    const id = await this.withOverlapGuard(() =>
      runInTransaction(this.prisma, async (tx) => {
        await lockRows(tx, 'rooms', [input.room_id]);
        const room = await this.rooms.getRow(tx, user, input.room_id);
        if (room.archivedAt) throw new AppError('BUSINESS_RULE_VIOLATION', 'Phòng đã lưu trữ.');
        await this.extras.assertNotBlockedByTenancy(tx, room.id, input.hold_from);
        const r = await tx.reservation.create({
          data: {
            workspaceId: user.workspaceId,
            roomId: room.id,
            holdFrom: toDbDate(input.hold_from),
            expectedMoveIn: toDbDate(input.expected_move_in),
            holdUntil: toDbDate(input.hold_until),
            contactName: input.contact_name,
            contactPhone: input.contact_phone,
            note: input.note,
            createdBy: user.id,
          },
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'reservation.create',
          entityType: 'reservation',
          entityId: r.id,
          after: input,
        });
        return r.id;
      }),
    );
    return this.get(user, id);
  }

  async reschedule(user: AuthUser, id: string, input: z.output<typeof reservationRescheduleSchema>): Promise<Reservation> {
    const current = await this.getRow(this.prisma, user, id);
    if (current.status !== 'ACTIVE') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ đổi lịch được lượt giữ chỗ đang hiệu lực.');
    if (input.hold_until < this.clock.today()) throw new AppError('BUSINESS_RULE_VIOLATION', 'Hạn giữ chỗ đã qua.');
    await this.withOverlapGuard(() =>
      runInTransaction(this.prisma, async (tx) => {
        await lockRows(tx, 'rooms', [current.roomId]);
        await this.extras.assertNotBlockedByTenancy(tx, current.roomId, input.hold_from);
        await updateVersioned(tx.reservation, { id, workspaceId: user.workspaceId, status: 'ACTIVE' }, input.expected_version, {
          holdFrom: toDbDate(input.hold_from),
          expectedMoveIn: toDbDate(input.expected_move_in),
          holdUntil: toDbDate(input.hold_until),
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'reservation.reschedule',
          entityType: 'reservation',
          entityId: id,
          before: { hold_from: day(current.holdFrom), expected_move_in: day(current.expectedMoveIn), hold_until: day(current.holdUntil) },
          after: input,
        });
      }),
    );
    return this.get(user, id);
  }

  /** Hủy giữ chỗ. Số dư tiền giữ chỗ (nếu có) được giữ nguyên, không tự mất (MASTER_PLAN 5.6). */
  async cancel(user: AuthUser, id: string, input: z.output<typeof reservationCancelSchema>): Promise<Reservation> {
    const current = await this.getRow(this.prisma, user, id);
    if (current.status !== 'ACTIVE') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lượt giữ chỗ không còn hiệu lực.');
    await runInTransaction(this.prisma, async (tx) => {
      await updateVersioned(tx.reservation, { id, workspaceId: user.workspaceId, status: 'ACTIVE' }, input.expected_version, {
        status: 'CANCELLED',
        cancelledReason: input.reason,
        cancelledAt: this.clock.now(),
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'reservation.cancel',
        entityType: 'reservation',
        entityId: id,
        reason: input.reason,
      });
    });
    return this.get(user, id);
  }

  async toDtos(db: Db, rows: ReservationRow[]): Promise<Reservation[]> {
    if (rows.length === 0) return [];
    const today = this.clock.today();
    const [balances, conflicts] = await Promise.all([
      this.extras.holdingBalances(db, rows.map((r) => r.id)),
      this.extras.scheduleConflicts(
        db,
        rows.filter((r) => r.status === 'ACTIVE').map((r) => ({ id: r.id, roomId: r.roomId, holdFrom: fromDbDate(r.holdFrom) })),
      ),
    ]);
    return rows.map((r) => ({
      id: r.id,
      room_id: r.roomId,
      room_code: r.room.code,
      building_id: r.room.buildingId,
      building_code: r.room.building.code,
      hold_from: day(r.holdFrom),
      expected_move_in: day(r.expectedMoveIn),
      hold_until: day(r.holdUntil),
      status: r.status,
      display_status: reservationDisplayStatus(r.status, fromDbDate(r.holdUntil), today),
      contact_name: r.contactName,
      contact_phone: r.contactPhone,
      note: r.note,
      cancelled_reason: r.cancelledReason,
      schedule_conflict: conflicts.has(r.id),
      holding_balance_vnd: (balances.get(r.id) ?? 0n).toString(),
      version: r.version,
    }));
  }

  private async withOverlapGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (pgErrorCode(error) === PG.EXCLUSION_VIOLATION) {
        throw new AppError('CONFLICT', OVERLAP_MESSAGE, { hold_from: [OVERLAP_MESSAGE] });
      }
      throw error;
    }
  }
}
