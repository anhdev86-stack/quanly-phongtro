import { Inject, Injectable } from '@nestjs/common';
import { CONTRACT_ALERT_MILESTONES, type ContractAlertDto, type contractAlertQuerySchema, type Paged } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { day, iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { daysUntil } from '../../domain/contracts/contract-status.js';
import { addDays, toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { userNames } from '../utilities/user-names.js';

/** Mốc nhỏ nhất ≥ số ngày còn lại (VD còn 10 ngày → mốc 15). null nếu còn hơn mốc lớn nhất. */
export function milestoneFor(daysLeft: number): number | null {
  const sorted = [...CONTRACT_ALERT_MILESTONES].sort((a, b) => a - b);
  return sorted.find((m) => daysLeft <= m) ?? null;
}

const include = {
  contract: {
    include: {
      tenancy: {
        include: {
          room: { include: { building: true } },
          members: { where: { role: 'PRIMARY' as const }, include: { tenant: true }, orderBy: { joinedOn: 'desc' as const } },
          contracts: { where: { lifecycle: 'SIGNED' as const }, select: { id: true, termStart: true } },
        },
      },
    },
  },
} satisfies Prisma.ContractAlertInclude;

/**
 * Cảnh báo hợp đồng sắp hết hạn theo mốc 30/15/7 ngày (V1.1). Sinh khi đọc danh sách (không cần cron): idempotent nhờ unique
 * (hợp đồng, ngày hết hạn, mốc) nên đọc lặp hay song song không tạo trùng. Hợp đồng đã có kỳ ký tiếp (gia hạn) không cảnh báo.
 * Phụ lục đổi ngày kết thúc → cảnh báo theo ngày mới; cảnh báo theo ngày cũ không còn hiện.
 */
@Injectable()
export class ContractAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Tạo cảnh báo còn thiếu cho nhà trọ. Trả số cảnh báo mới. */
  async sync(workspaceId: string): Promise<number> {
    const today = this.clock.today();
    const max = Math.max(...CONTRACT_ALERT_MILESTONES);
    const contracts = await this.prisma.contract.findMany({
      where: {
        workspaceId,
        lifecycle: 'SIGNED',
        terminatedOn: null,
        termStart: { lte: toDbDate(today) },
        termEnd: { gte: toDbDate(today), lte: toDbDate(addDays(today, max)) },
        tenancy: { status: { not: 'ENDED' } },
      },
      include: { tenancy: { include: { contracts: { where: { lifecycle: 'SIGNED' }, select: { id: true, termStart: true } } } } },
    });
    const rows: Prisma.ContractAlertCreateManyInput[] = [];
    for (const c of contracts) {
      if (c.tenancy.contracts.some((o) => o.id !== c.id && o.termStart > c.termStart)) continue; // đã gia hạn
      const m = milestoneFor(daysUntil(today, day(c.termEnd)));
      if (m !== null) rows.push({ workspaceId, contractId: c.id, termEnd: c.termEnd, milestoneDays: m });
    }
    if (!rows.length) return 0;
    return (await this.prisma.contractAlert.createMany({ data: rows, skipDuplicates: true })).count;
  }

  async list(user: AuthUser, q: z.output<typeof contractAlertQuerySchema>): Promise<Paged<ContractAlertDto>> {
    await this.sync(user.workspaceId);
    const today = this.clock.today();
    const rows = await this.prisma.contractAlert.findMany({
      where: {
        workspaceId: user.workspaceId,
        contract: { tenancy: { room: { AND: [this.rooms.roomWhere(user), ...(q.building_id ? [{ buildingId: q.building_id }] : [])] } } },
      },
      include,
      orderBy: [{ termEnd: 'asc' }, { milestoneDays: 'asc' }],
    });
    const names = await userNames(this.prisma, rows.map((r) => r.acknowledgedBy));
    const dtos = rows.map((r) => {
      const c = r.contract;
      const renewed = c.tenancy.contracts.some((o) => o.id !== c.id && o.termStart > c.termStart);
      return {
        dto: {
          id: r.id,
          contract_id: c.id,
          contract_code: c.code,
          tenancy_id: c.tenancyId,
          room_code: c.tenancy.room.code,
          building_code: c.tenancy.room.building.code,
          primary_tenant_name: c.tenancy.members[0]?.tenant.fullName ?? null,
          term_end: day(r.termEnd),
          milestone_days: r.milestoneDays,
          days_to_expiry: daysUntil(today, day(c.termEnd)),
          renewed,
          created_at: iso(r.createdAt)!,
          acknowledged_at: iso(r.acknowledgedAt),
          acknowledged_by_name: r.acknowledgedBy ? (names.get(r.acknowledgedBy) ?? null) : null,
        },
        // Cảnh báo cũ: hợp đồng đã gia hạn, đã đổi ngày kết thúc, đã hủy/kết thúc sớm, hoặc mốc nhỏ hơn đã thay thế.
        stale: renewed || day(c.termEnd) !== day(r.termEnd) || c.lifecycle !== 'SIGNED' || c.terminatedOn !== null,
      };
    });
    // Mốc mới nhất (nhỏ nhất) của mỗi hợp đồng, tính trên mọi cảnh báo kể cả đã xác nhận.
    const latest = new Map<string, number>();
    for (const { dto } of dtos) latest.set(dto.contract_id, Math.min(latest.get(dto.contract_id) ?? Infinity, dto.milestone_days));
    // Danh sách đang mở: chưa xác nhận, chưa cũ, và là mốc mới nhất (đã xác nhận mốc mới thì mốc cũ hơn không hiện lại).
    const visible = dtos
      .filter(({ dto, stale }) => q.include_acknowledged === 'true' || (!dto.acknowledged_at && !stale && latest.get(dto.contract_id) === dto.milestone_days))
      .map((x) => x.dto);
    const start = (q.page - 1) * q.page_size;
    return { items: visible.slice(start, start + q.page_size), total: visible.length, page: q.page, page_size: q.page_size };
  }

  /** Đánh dấu đã xem/xử lý (một người xác nhận cho cả nhà trọ). */
  async acknowledge(user: AuthUser, id: string): Promise<ContractAlertDto> {
    const alert = await this.prisma.contractAlert.findFirst({ where: { id, workspaceId: user.workspaceId, contract: { tenancy: { room: this.rooms.roomWhere(user) } } } });
    if (!alert) throw new AppError('NOT_FOUND');
    if (!alert.acknowledgedAt) {
      await runInTransaction(this.prisma, async (tx) => {
        await tx.contractAlert.update({ where: { id }, data: { acknowledgedAt: this.clock.now(), acknowledgedBy: user.id } });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'contract.alert_ack',
          entityType: 'contract',
          entityId: alert.contractId,
          after: { alert_id: id, milestone_days: alert.milestoneDays },
        });
      });
    }
    const page = await this.list(user, { include_acknowledged: 'true', page: 1, page_size: 100 });
    return page.items.find((a) => a.id === id)!;
  }
}
