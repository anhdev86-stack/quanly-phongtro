import { Injectable } from '@nestjs/common';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { currentRequestId } from '../../common/context/request-context.js';
import { redact } from './redact.js';

export interface AuditEntry {
  workspaceId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
  /** Tòa của đối tượng; bỏ trống thì suy ra từ entityType/entityId (xem BUILDING_OF). */
  buildingId?: string | null;
}

const T = (table: string) => `SELECT r."building_id" AS id FROM "${table}" x JOIN "tenancies" t ON t."id" = x."tenancy_id" JOIN "rooms" r ON r."id" = t."room_id" WHERE x."id" = $1::uuid`;

/**
 * Cách tìm tòa của đối tượng trong nhật ký (V1.1: lọc nhật ký theo tòa được giao). Cùng quy tắc với backfill trong migration
 * `phase10_permissions_audit`. Đối tượng cấp nhà trọ (người dùng, cấu hình, người thuê, dịch vụ) không có tòa → chỉ chủ trọ xem.
 */
const BUILDING_OF: Record<string, string> = {
  building: 'SELECT "id" FROM "buildings" WHERE "id" = $1::uuid',
  room: 'SELECT "building_id" AS id FROM "rooms" WHERE "id" = $1::uuid',
  reservation: 'SELECT r."building_id" AS id FROM "reservations" x JOIN "rooms" r ON r."id" = x."room_id" WHERE x."id" = $1::uuid',
  tenancy: 'SELECT r."building_id" AS id FROM "tenancies" t JOIN "rooms" r ON r."id" = t."room_id" WHERE t."id" = $1::uuid',
  meter: 'SELECT r."building_id" AS id FROM "meters" m JOIN "rooms" r ON r."id" = m."room_id" WHERE m."id" = $1::uuid',
  meter_reading:
    'SELECT r."building_id" AS id FROM "meter_readings" x JOIN "meters" m ON m."id" = x."meter_id" JOIN "rooms" r ON r."id" = m."room_id" WHERE x."id" = $1::uuid',
  contract: T('contracts'),
  invoice: T('invoices'),
  payment: T('payments'),
  settlement: T('move_out_settlements'),
  credit_refund: T('credit_refunds'),
  credit_application: T('credit_applications'),
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ghi nhật ký thao tác. Với thao tác tài chính, truyền `tx` để audit nằm trong cùng transaction nghiệp vụ:
 * nghiệp vụ rollback thì audit cũng rollback, nghiệp vụ commit thì audit chắc chắn có.
 */
@Injectable()
export class AuditService {
  async record(db: Db, entry: AuditEntry): Promise<string> {
    const buildingId = entry.buildingId !== undefined ? entry.buildingId : await this.buildingOf(db, entry.entityType, entry.entityId);
    const row = await db.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason ?? null,
        requestId: entry.requestId ?? currentRequestId() ?? null,
        buildingId,
      },
      select: { id: true },
    });
    return row.id;
  }

  private async buildingOf(db: Db, entityType: string, entityId: string | null | undefined): Promise<string | null> {
    const sql = BUILDING_OF[entityType];
    if (!sql || !entityId || !UUID_RE.test(entityId)) return null;
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(sql, entityId);
    return rows[0]?.id ?? null;
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return redact(value) as Prisma.InputJsonValue;
}
