import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type Paged, type TenantDto, type tenantInputSchema, type tenantListQuerySchema, type tenantUpdateSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { dayOrNull, iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma, Tenant } from '../../generated/prisma/client.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { maskIdentityNumber } from '../audit/redact.js';
import { RoomsService } from '../rooms/rooms.service.js';

type TenantInput = z.output<typeof tenantInputSchema>;

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Người thuê nằm trong phạm vi nếu: có lần thuê ở phòng thuộc tòa được giao, hoặc chưa từng thuê (vừa tạo).
   * OWNER thấy tất cả.
   */
  tenantWhere(user: AuthUser): Prisma.TenantWhereInput {
    if (user.allBuildings) return { workspaceId: user.workspaceId };
    return {
      workspaceId: user.workspaceId,
      OR: [{ memberships: { some: { tenancy: { room: this.rooms.roomWhere(user) } } } }, { memberships: { none: {} } }],
    };
  }

  async list(user: AuthUser, q: z.output<typeof tenantListQuerySchema>): Promise<Paged<TenantDto>> {
    const needle = q.q?.trim();
    const where: Prisma.TenantWhereInput = {
      AND: [
        this.tenantWhere(user),
        q.include_archived === 'true' ? {} : { archivedAt: null },
        needle
          ? {
              OR: [
                { fullName: { contains: needle, mode: 'insensitive' } },
                { phone: { contains: needle.replace(/\s/g, '') } },
                ...(user.permissions.has(PERMISSIONS.SENSITIVE_DATA_VIEW) ? [{ identityNumber: { contains: needle } }] : []),
              ],
            }
          : {},
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({ where, orderBy: { fullName: 'asc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
    ]);
    const items = await this.toDtos(this.prisma, user, rows, false);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async getRow(db: Db, user: AuthUser, id: string): Promise<Tenant> {
    const row = await db.tenant.findFirst({ where: { AND: [{ id }, this.tenantWhere(user)] } });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  async get(user: AuthUser, id: string): Promise<TenantDto> {
    const row = await this.getRow(this.prisma, user, id);
    return (await this.toDtos(this.prisma, user, [row], true))[0]!;
  }

  /** Tạo người thuê (dùng trong transaction nhận phòng hoặc gọi riêng). */
  async createInTx(tx: Prisma.TransactionClient, user: AuthUser, input: TenantInput): Promise<Tenant> {
    const t = await tx.tenant.create({ data: { ...toData(input), workspaceId: user.workspaceId } });
    await this.audit.record(tx, {
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: 'tenant.create',
      entityType: 'tenant',
      entityId: t.id,
      after: input,
    });
    return t;
  }

  async create(user: AuthUser, input: TenantInput): Promise<TenantDto> {
    const t = await runInTransaction(this.prisma, (tx) => this.createInTx(tx, user, input));
    return this.get(user, t.id);
  }

  async update(user: AuthUser, id: string, input: z.output<typeof tenantUpdateSchema>): Promise<TenantDto> {
    const before = await this.getRow(this.prisma, user, id);
    const { expected_version, ...fields } = input;
    const data = toData(fields as TenantInput, true);
    await runInTransaction(this.prisma, async (tx) => {
      await updateVersioned(tx.tenant, { id, workspaceId: user.workspaceId }, expected_version, data);
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'tenant.update',
        entityType: 'tenant',
        entityId: id,
        before: { full_name: before.fullName, phone: before.phone, identity_number: before.identityNumber },
        after: fields,
      });
    });
    return this.get(user, id);
  }

  async toDtos(db: Db, user: AuthUser, rows: Tenant[], withDuplicates: boolean): Promise<TenantDto[]> {
    if (rows.length === 0) return [];
    const canSeeId = user.permissions.has(PERMISSIONS.SENSITIVE_DATA_VIEW);
    const ids = rows.map((r) => r.id);
    const current = await db.tenancyTenant.findMany({
      where: { tenantId: { in: ids }, leftOnExclusive: null, tenancy: { status: { not: 'ENDED' } } },
      include: { tenancy: { include: { room: { include: { building: true } } } } },
    });
    const roomOf = new Map(current.map((m) => [m.tenantId, `${m.tenancy.room.building.code} · ${m.tenancy.room.code}`]));
    const dupMap = new Map<string, { id: string; full_name: string }[]>();
    if (withDuplicates) {
      const numbers = rows.map((r) => r.identityNumber).filter((n): n is string => !!n);
      if (numbers.length) {
        const dups = await db.tenant.findMany({
          where: { workspaceId: user.workspaceId, identityNumber: { in: numbers }, id: { notIn: ids } },
          select: { id: true, fullName: true, identityNumber: true },
        });
        for (const d of dups) dupMap.set(d.identityNumber!, [...(dupMap.get(d.identityNumber!) ?? []), { id: d.id, full_name: d.fullName }]);
      }
    }
    return rows.map((t) => ({
      id: t.id,
      full_name: t.fullName,
      birth_date: dayOrNull(t.birthDate),
      gender: t.gender,
      phone: t.phone,
      email: t.email,
      identity_number: t.identityNumber ? (canSeeId ? t.identityNumber : maskIdentityNumber(t.identityNumber)) : null,
      identity_masked: !!t.identityNumber && !canSeeId,
      issue_date: canSeeId ? dayOrNull(t.issueDate) : null,
      issue_place: canSeeId ? t.issuePlace : null,
      permanent_address: canSeeId ? t.permanentAddress : null,
      hometown: t.hometown,
      note: t.note,
      reminder_opt_in: t.reminderOptIn,
      reminder_consent_at: iso(t.reminderConsentAt),
      archived_at: iso(t.archivedAt),
      version: t.version,
      current_room: roomOf.get(t.id) ?? null,
      duplicate_identity: t.identityNumber ? (dupMap.get(t.identityNumber) ?? []) : [],
    }));
  }
}

function toData(input: Partial<TenantInput>, partial = false): Prisma.TenantUncheckedUpdateInput & Prisma.TenantUncheckedCreateInput {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (!partial || value !== undefined) out[key] = value;
  };
  set('fullName', input.full_name);
  set('birthDate', input.birth_date === undefined ? undefined : input.birth_date ? toDbDate(input.birth_date) : null);
  set('gender', input.gender);
  set('phone', input.phone);
  set('email', input.email);
  set('identityNumber', input.identity_number);
  set('issueDate', input.issue_date === undefined ? undefined : input.issue_date ? toDbDate(input.issue_date) : null);
  set('issuePlace', input.issue_place);
  set('permanentAddress', input.permanent_address);
  set('hometown', input.hometown);
  set('note', input.note);
  return out as Prisma.TenantUncheckedUpdateInput & Prisma.TenantUncheckedCreateInput;
}

