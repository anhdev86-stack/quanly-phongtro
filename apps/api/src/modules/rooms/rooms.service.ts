import { Inject, Injectable } from '@nestjs/common';
import type { Paged, Room, roomCreateSchema, roomListQuerySchema, roomOperationalStatusSchema, roomUpdateSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode } from '../../common/db/pg-errors.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { day, decimal, iso, money, naturalCompare, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { fromDbDate } from '../../domain/dates/date-only.js';
import { roomDisplayStatus } from '../../domain/rooms/room-status.js';
import type { Building, Prisma, Room as RoomRow } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';

type RoomWithBuilding = RoomRow & { building: Building };

export interface OpenTenancyInfo {
  id: string;
  code: string;
  status: string;
  primaryTenantName: string | null;
}

/** Trạng thái tenancy còn mở (chưa ENDED) — MASTER_PLAN 2.1. */
export const OPEN_TENANCY_STATUSES = ['ACTIVE', 'NOTICE_GIVEN', 'MOVE_OUT_PROCESSING'] as const;

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Điều kiện lọc phòng theo phạm vi tòa của người dùng. */
  roomWhere(user: AuthUser): Prisma.RoomWhereInput {
    return { workspaceId: user.workspaceId, building: this.access.buildingWhere(user) };
  }

  async list(user: AuthUser, q: z.output<typeof roomListQuerySchema>): Promise<Paged<Room>> {
    const where: Prisma.RoomWhereInput = {
      ...this.roomWhere(user),
      ...(q.include_archived === 'true' ? {} : { archivedAt: null, building: { ...this.access.buildingWhere(user), archivedAt: null } }),
      ...(q.building_id ? { buildingId: q.building_id } : {}),
      ...(q.floor !== undefined ? { floor: q.floor } : {}),
    };
    const rows = await this.prisma.room.findMany({ where, include: { building: true } });
    let dtos = await this.toDtos(this.prisma, rows);
    if (q.q) {
      const needle = q.q.toLowerCase();
      dtos = dtos.filter(
        (r) => r.code.toLowerCase().includes(needle) || (r.current_tenancy?.primary_tenant_name ?? '').toLowerCase().includes(needle),
      );
    }
    if (q.status) dtos = dtos.filter((r) => r.display_status === q.status);
    dtos.sort((a, b) => naturalCompare(a.building_code, b.building_code) || naturalCompare(a.code, b.code));
    return paged(dtos, q.page, q.page_size);
  }

  /** Lấy phòng trong phạm vi; ngoài phạm vi hoặc không tồn tại → NOT_FOUND. */
  async getRow(db: Db, user: AuthUser, id: string): Promise<RoomWithBuilding> {
    const room = await db.room.findFirst({ where: { id, ...this.roomWhere(user) }, include: { building: true } });
    if (!room) throw new AppError('NOT_FOUND');
    return room;
  }

  async get(user: AuthUser, id: string): Promise<Room> {
    const room = await this.getRow(this.prisma, user, id);
    const [dto] = await this.toDtos(this.prisma, [room]);
    return dto!;
  }

  async create(user: AuthUser, input: z.output<typeof roomCreateSchema>): Promise<Room> {
    const building = await this.access.getBuildingInScope(this.prisma, user, input.building_id);
    if (building.archivedAt) throw new AppError('BUSINESS_RULE_VIOLATION', 'Tòa đã lưu trữ, không thêm phòng được.');
    try {
      const id = await runInTransaction(this.prisma, async (tx) => {
        const room = await tx.room.create({
          data: {
            workspaceId: user.workspaceId,
            buildingId: building.id,
            code: input.code,
            floor: input.floor,
            areaM2: input.area_m2,
            defaultRentVnd: BigInt(input.default_rent_vnd),
            maxOccupants: input.max_occupants,
            amenities: input.amenities,
            note: input.note,
          },
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'room.create',
          entityType: 'room',
          entityId: room.id,
          after: input,
        });
        return room.id;
      });
      return this.get(user, id);
    } catch (error) {
      throw duplicateRoomCode(error);
    }
  }

  async update(user: AuthUser, id: string, input: z.output<typeof roomUpdateSchema>): Promise<Room> {
    const before = await this.getRow(this.prisma, user, id);
    const { expected_version, ...f } = input;
    try {
      await runInTransaction(this.prisma, async (tx) => {
        await updateVersioned(tx.room, { id, workspaceId: user.workspaceId }, expected_version, {
          ...(f.code !== undefined ? { code: f.code } : {}),
          ...(f.floor !== undefined ? { floor: f.floor } : {}),
          ...(f.area_m2 !== undefined ? { areaM2: f.area_m2 } : {}),
          // Đổi giá mặc định không ảnh hưởng tenancy đang thuê (MASTER_PLAN 4.4).
          ...(f.default_rent_vnd !== undefined ? { defaultRentVnd: BigInt(f.default_rent_vnd) } : {}),
          ...(f.max_occupants !== undefined ? { maxOccupants: f.max_occupants } : {}),
          ...(f.amenities !== undefined ? { amenities: f.amenities } : {}),
          ...(f.note !== undefined ? { note: f.note } : {}),
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'room.update',
          entityType: 'room',
          entityId: id,
          before: { code: before.code, default_rent_vnd: before.defaultRentVnd, max_occupants: before.maxOccupants },
          after: f,
        });
      });
    } catch (error) {
      throw duplicateRoomCode(error);
    }
    return this.get(user, id);
  }

  async setOperationalStatus(user: AuthUser, id: string, input: z.output<typeof roomOperationalStatusSchema>): Promise<Room> {
    const before = await this.getRow(this.prisma, user, id);
    await runInTransaction(this.prisma, async (tx) => {
      await updateVersioned(tx.room, { id, workspaceId: user.workspaceId }, input.expected_version, {
        operationalStatus: input.status,
        maintenanceNote: input.status === 'MAINTENANCE' ? input.note : null,
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'room.set_operational_status',
        entityType: 'room',
        entityId: id,
        before: { status: before.operationalStatus },
        after: { status: input.status, note: input.note },
      });
    });
    return this.get(user, id);
  }

  async setArchived(user: AuthUser, id: string, expectedVersion: number, archived: boolean): Promise<Room> {
    await this.getRow(this.prisma, user, id);
    await runInTransaction(this.prisma, async (tx) => {
      if (archived) {
        const today = this.clock.today();
        const [open, reservations] = await Promise.all([
          this.openTenancies(tx, [id]),
          tx.reservation.count({ where: { roomId: id, status: 'ACTIVE', holdUntil: { gte: new Date(`${today}T00:00:00Z`) } } }),
        ]);
        if (open.size > 0) throw new AppError('BUSINESS_RULE_VIOLATION', 'Phòng đang có khách thuê, không lưu trữ được.');
        if (reservations > 0) throw new AppError('BUSINESS_RULE_VIOLATION', 'Phòng còn lượt giữ chỗ đang hiệu lực. Hãy hủy trước.');
      }
      await updateVersioned(tx.room, { id, workspaceId: user.workspaceId }, expectedVersion, { archivedAt: archived ? new Date() : null });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: archived ? 'room.archive' : 'room.unarchive',
        entityType: 'room',
        entityId: id,
      });
    });
    return this.get(user, id);
  }

  /**
   * Tenancy còn mở theo phòng. Phase 1 chưa có bảng tenancy nên luôn rỗng; Phase 2 thay bằng truy vấn thật.
   */
  async openTenancies(_db: Db, _roomIds: string[]): Promise<Map<string, OpenTenancyInfo>> {
    return new Map();
  }

  /** Dựng DTO kèm trạng thái hiển thị tính toán (MASTER_PLAN 5.1). */
  async toDtos(db: Db, rooms: RoomWithBuilding[]): Promise<Room[]> {
    if (rooms.length === 0) return [];
    const ids = rooms.map((r) => r.id);
    const today = this.clock.today();
    const [reservations, tenancies] = await Promise.all([
      db.reservation.findMany({ where: { roomId: { in: ids }, status: 'ACTIVE' }, orderBy: { holdFrom: 'asc' } }),
      this.openTenancies(db, ids),
    ]);
    const byRoom = new Map<string, typeof reservations>();
    for (const r of reservations) byRoom.set(r.roomId, [...(byRoom.get(r.roomId) ?? []), r]);

    return rooms.map((room) => {
      const active = byRoom.get(room.id) ?? [];
      const tenancy = tenancies.get(room.id) ?? null;
      const { status, maintenanceBadge } = roomDisplayStatus({
        operationalStatus: room.operationalStatus,
        hasOpenTenancy: tenancy !== null,
        activeReservations: active.map((r) => ({ holdFrom: fromDbDate(r.holdFrom), holdUntil: fromDbDate(r.holdUntil) })),
        today,
      });
      const current = active.find((r) => fromDbDate(r.holdUntil) >= today) ?? null;
      return {
        id: room.id,
        building_id: room.buildingId,
        building_code: room.building.code,
        building_name: room.building.name,
        code: room.code,
        floor: room.floor,
        area_m2: decimal(room.areaM2),
        default_rent_vnd: money(room.defaultRentVnd),
        max_occupants: room.maxOccupants,
        amenities: room.amenities,
        operational_status: room.operationalStatus,
        maintenance_note: room.maintenanceNote,
        note: room.note,
        display_status: status,
        maintenance_badge: maintenanceBadge,
        current_reservation: current
          ? {
              id: current.id,
              hold_from: day(current.holdFrom),
              expected_move_in: day(current.expectedMoveIn),
              hold_until: day(current.holdUntil),
              contact_name: current.contactName,
              status: current.status,
            }
          : null,
        current_tenancy: tenancy
          ? { id: tenancy.id, code: tenancy.code, primary_tenant_name: tenancy.primaryTenantName, status: tenancy.status }
          : null,
        archived_at: iso(room.archivedAt),
        version: room.version,
      };
    });
  }
}

function duplicateRoomCode(error: unknown): unknown {
  const code = (error as { code?: string }).code;
  if (code === 'P2002' || pgErrorCode(error) === PG.UNIQUE_VIOLATION) {
    return new AppError('CONFLICT', 'Mã phòng đã tồn tại trong tòa.', { code: ['Mã phòng đã tồn tại trong tòa.'] });
  }
  return error;
}
