import { Injectable } from '@nestjs/common';
import {
  AUDIT_FINANCE_PREFIXES,
  AUDIT_OPERATIONS_PREFIXES,
  type AuditCategory,
  auditCategory,
  type AuditLogDto,
  type auditListQuerySchema,
  type Paged,
  PERMISSIONS,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { userNames } from '../utilities/user-names.js';

const startsWithAny = (prefixes: string[]): Prisma.AuditLogWhereInput[] => prefixes.map((p) => ({ action: { startsWith: `${p}.` } }));

/** Điều kiện SQL cho một nhóm nhật ký, khớp `auditCategory()` dùng chung. */
function categoryWhere(c: AuditCategory): Prisma.AuditLogWhereInput {
  if (c === 'FINANCE') return { OR: startsWithAny(AUDIT_FINANCE_PREFIXES) };
  if (c === 'OPERATIONS') return { OR: startsWithAny(AUDIT_OPERATIONS_PREFIXES) };
  return { NOT: { OR: startsWithAny([...AUDIT_FINANCE_PREFIXES, ...AUDIT_OPERATIONS_PREFIXES]) } };
}

/** Ngày nghiệp vụ (giờ Việt Nam) → mốc UTC. */
const vnStart = (d: string) => new Date(`${d}T00:00:00+07:00`);

/**
 * Tra cứu nhật ký (V1.1, MASTER_PLAN 11.2): `audit.view` xem toàn bộ (chủ trọ); `audit.view_operations` /
 * `audit.view_finance` chỉ xem nhóm tương ứng và chỉ nhật ký gắn với tòa được giao (nhật ký cấp nhà trọ không có tòa → ẩn).
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  allowedCategories(user: AuthUser): AuditCategory[] {
    if (user.permissions.has(PERMISSIONS.AUDIT_VIEW)) return ['OPERATIONS', 'FINANCE', 'SYSTEM'];
    const out: AuditCategory[] = [];
    if (user.permissions.has(PERMISSIONS.AUDIT_VIEW_OPERATIONS)) out.push('OPERATIONS');
    if (user.permissions.has(PERMISSIONS.AUDIT_VIEW_FINANCE)) out.push('FINANCE');
    return out;
  }

  async list(user: AuthUser, q: z.output<typeof auditListQuerySchema>): Promise<Paged<AuditLogDto> & { categories: AuditCategory[] }> {
    const allowed = this.allowedCategories(user);
    if (!allowed.length) throw new AppError('FORBIDDEN');
    const categories = q.category ? allowed.filter((c) => c === q.category) : allowed;
    const full = user.permissions.has(PERMISSIONS.AUDIT_VIEW) && user.allBuildings;
    if (q.building_id && !full && !user.buildingIds.includes(q.building_id)) throw new AppError('NOT_FOUND');

    const and: Prisma.AuditLogWhereInput[] = [{ workspaceId: user.workspaceId }];
    if (categories.length === 0) and.push({ id: { in: [] } });
    else if (categories.length < 3) and.push({ OR: categories.map(categoryWhere) });
    if (!full) and.push({ buildingId: { in: [...user.buildingIds] } });
    if (q.building_id) and.push({ buildingId: q.building_id });
    if (q.actor_id) and.push({ actorId: q.actor_id });
    if (q.entity_type) and.push({ entityType: q.entity_type });
    if (q.entity_id) and.push({ entityId: q.entity_id });
    if (q.action) and.push({ action: { startsWith: q.action } });
    if (q.from) and.push({ occurredAt: { gte: vnStart(q.from) } });
    if (q.to) and.push({ occurredAt: { lt: new Date(vnStart(q.to).getTime() + 86_400_000) } });
    const where: Prisma.AuditLogWhereInput = { AND: and };

    const total = await this.prisma.auditLog.count({ where });
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.page_size,
      take: q.page_size,
    });
    const names = await userNames(this.prisma, rows.map((r) => r.actorId));
    const buildingIds = [...new Set(rows.map((r) => r.buildingId).filter((b): b is string => !!b))];
    const buildings = buildingIds.length ? await this.prisma.building.findMany({ where: { id: { in: buildingIds } }, select: { id: true, code: true } }) : [];
    const codeOf = new Map(buildings.map((b) => [b.id, b.code]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        occurred_at: iso(r.occurredAt)!,
        actor_id: r.actorId,
        actor_name: r.actorId ? (names.get(r.actorId) ?? null) : null,
        action: r.action,
        category: auditCategory(r.action),
        entity_type: r.entityType,
        entity_id: r.entityId,
        building_code: r.buildingId ? (codeOf.get(r.buildingId) ?? null) : null,
        before: r.before ?? null,
        after: r.after ?? null,
        reason: r.reason,
        request_id: r.requestId,
      })),
      total,
      page: q.page,
      page_size: q.page_size,
      categories: allowed,
    };
  }
}
