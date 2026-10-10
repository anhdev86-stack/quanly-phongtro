import { Inject, Injectable } from '@nestjs/common';
import { type Building, type buildingCreateSchema, type buildingUpdateSchema, PERMISSIONS } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode } from '../../common/db/pg-errors.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { iso, naturalCompare } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { firstDayOfMonth } from '../../domain/dates/date-only.js';
import type { Building as BuildingRow, Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PricesService } from '../utilities/prices.service.js';

type CreateInput = z.output<typeof buildingCreateSchema>;
type UpdateInput = z.output<typeof buildingUpdateSchema>;

@Injectable()
export class BuildingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly prices: PricesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: AuthUser, includeArchived: boolean): Promise<Building[]> {
    const rows = await this.prisma.building.findMany({
      where: { ...this.access.buildingWhere(user), ...(includeArchived ? {} : { archivedAt: null }) },
      include: { _count: { select: { rooms: { where: { archivedAt: null } } } }, userScopes: MANAGER_SCOPES },
    });
    return rows.sort((a, b) => naturalCompare(a.code, b.code)).map((b) => toDto(b, b._count.rooms, managersOf(b.userScopes)));
  }

  async get(user: AuthUser, id: string): Promise<Building> {
    const b = await this.access.getBuildingInScope(this.prisma, user, id);
    const roomCount = await this.prisma.room.count({ where: { buildingId: b.id, archivedAt: null } });
    const scopes = await this.prisma.userBuildingScope.findMany({ ...MANAGER_SCOPES, where: { buildingId: b.id, user: { isActive: true } } });
    return toDto(b, roomCount, managersOf(scopes));
  }

  async create(user: AuthUser, input: CreateInput): Promise<Building> {
    try {
      const created = await runInTransaction(this.prisma, async (tx) => {
        const b = await tx.building.create({
          data: {
            workspaceId: user.workspaceId,
            code: input.code,
            name: input.name,
            address: input.address,
            floors: input.floors,
            contactName: input.contact_name,
            contactPhone: input.contact_phone,
            note: input.note,
          },
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'building.create',
          entityType: 'building',
          entityId: b.id,
          after: input,
        });
        // Giá điện nước nhập ngay khi tạo tòa (không bắt buộc, D-043): phiên bản giá đầu tiên, mặc định từ kỳ hiện tại.
        const mp = input.meter_prices;
        if (mp) {
          await this.setMeterPrices(tx, user, b.id, mp, {
            effective_from: mp.effective_from ?? firstDayOfMonth(this.clock.today()),
            reason: 'Giá ban đầu khi tạo tòa',
            confirm_existing_readings: false,
          });
        }
        return b;
      });
      return toDto(created, 0);
    } catch (error) {
      throw duplicateCode(error);
    }
  }

  async update(user: AuthUser, id: string, input: UpdateInput): Promise<Building> {
    const before = await this.access.getBuildingInScope(this.prisma, user, id);
    const { expected_version, ...fields } = input;
    try {
      await runInTransaction(this.prisma, async (tx) => {
        if (fields.meter_prices) await lockRows(tx, 'buildings', [id]);
        await updateVersioned(tx.building, { id, workspaceId: user.workspaceId }, expected_version, {
          ...(fields.code !== undefined ? { code: fields.code } : {}),
          ...(fields.name !== undefined ? { name: fields.name } : {}),
          ...(fields.address !== undefined ? { address: fields.address } : {}),
          ...(fields.floors !== undefined ? { floors: fields.floors } : {}),
          ...(fields.contact_name !== undefined ? { contactName: fields.contact_name } : {}),
          ...(fields.contact_phone !== undefined ? { contactPhone: fields.contact_phone } : {}),
          ...(fields.note !== undefined ? { note: fields.note } : {}),
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'building.update',
          entityType: 'building',
          entityId: id,
          before: toDto(before, 0),
          after: fields,
        });
        // Đổi giá điện nước ngay trong “Sửa tòa” (D-043): vẫn là phiên bản giá mới, có kỳ áp dụng và lý do.
        const mp = fields.meter_prices;
        if (mp) await this.setMeterPrices(tx, user, id, mp, mp);
      });
    } catch (error) {
      throw duplicateCode(error);
    }
    return this.get(user, id);
  }

  async setArchived(user: AuthUser, id: string, expectedVersion: number, archived: boolean): Promise<Building> {
    await this.access.getBuildingInScope(this.prisma, user, id);
    await runInTransaction(this.prisma, async (tx) => {
      if (archived) {
        const activeRooms = await tx.room.count({ where: { buildingId: id, archivedAt: null } });
        if (activeRooms > 0) {
          throw new AppError('BUSINESS_RULE_VIOLATION', `Tòa còn ${activeRooms} phòng chưa lưu trữ. Hãy lưu trữ các phòng trước.`);
        }
      }
      await updateVersioned(tx.building, { id, workspaceId: user.workspaceId }, expectedVersion, {
        archivedAt: archived ? new Date() : null,
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: archived ? 'building.archive' : 'building.unarchive',
        entityType: 'building',
        entityId: id,
      });
    });
    return this.get(user, id);
  }

  /** Ghi giá điện/nước nhập trong form tòa; cần quyền đặt giá điện nước (mặc định chỉ Chủ trọ). */
  private async setMeterPrices(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    buildingId: string,
    values: { ELECTRICITY: string | null; WATER: string | null },
    meta: { effective_from: string; reason: string; confirm_existing_readings: boolean },
  ): Promise<void> {
    const entries = (['ELECTRICITY', 'WATER'] as const).flatMap((t) => (values[t] ? [[t, values[t]] as const] : []));
    if (!entries.length) return;
    if (!user.permissions.has(PERMISSIONS.METER_PRICES_MANAGE)) throw new AppError('FORBIDDEN', 'Bạn không có quyền đặt giá điện nước.');
    for (const [meter_type, unit_price] of entries) {
      await this.prices.applyMeterPriceInTx(tx, user, buildingId, { meter_type, unit_price, ...meta }, 'meter_prices.');
    }
  }
}

/** Người được giao phụ trách tòa: chỉ tài khoản đang hoạt động, sắp theo tên. */
const MANAGER_SCOPES = {
  where: { user: { isActive: true } },
  include: { user: { select: { id: true, displayName: true } } },
  orderBy: { user: { displayName: 'asc' as const } },
};
const managersOf = (scopes: { user: { id: string; displayName: string } }[]) => scopes.map((s) => ({ id: s.user.id, display_name: s.user.displayName }));

function toDto(b: BuildingRow, roomCount: number, managers: Building['managers'] = []): Building {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    address: b.address,
    floors: b.floors,
    contact_name: b.contactName,
    contact_phone: b.contactPhone,
    note: b.note,
    archived_at: iso(b.archivedAt),
    version: b.version,
    room_count: roomCount,
    managers,
  };
}

function duplicateCode(error: unknown): unknown {
  const code = (error as { code?: string }).code;
  if (code === 'P2002' || pgErrorCode(error) === PG.UNIQUE_VIOLATION) {
    return new AppError('CONFLICT', 'Mã tòa đã tồn tại.', { code: ['Mã tòa đã tồn tại.'] });
  }
  return error;
}
