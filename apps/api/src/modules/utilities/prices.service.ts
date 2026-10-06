import { Inject, Injectable } from '@nestjs/common';
import {
  type MeterPrices,
  type meterPriceCreateSchema,
  type ServiceDetail,
  type ServiceDto,
  type ServicePriceDto,
  type serviceCreateSchema,
  type servicePriceCreateSchema,
  type serviceUpdateSchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode, violatedConstraint } from '../../common/db/pg-errors.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { day, decimal, iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { firstDayOfMonth, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import { nextReadingPeriod, priceOn } from '../../domain/utilities/meter-price.js';
import type { MeterType, Prisma, Service, ServicePriceHistory } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { userNames } from './user-names.js';

type PriceRow = ServicePriceHistory & { building: { code: string } | null };

export const toServiceDto = (s: Service): ServiceDto => ({
  id: s.id,
  code: s.code,
  name: s.name,
  type: s.type,
  unit: s.unit,
  charge_timing: s.chargeTiming,
  meter_type: s.meterType,
  substitutes_meter: s.substitutesMeter,
  archived_at: iso(s.archivedAt),
  version: s.version,
});

/**
 * Danh mục dịch vụ và giá có phiên bản (MASTER_PLAN 4.4, 6.4). Giá điện nước riêng từng tòa,
 * áp dụng theo kỳ đọc (D-028): nút “Thay đổi giá” mặc định áp dụng từ kỳ đọc tiếp theo.
 */
@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ Danh mục

  async listServices(user: AuthUser): Promise<ServiceDto[]> {
    const rows = await this.prisma.service.findMany({ where: { workspaceId: user.workspaceId }, orderBy: [{ type: 'desc' }, { code: 'asc' }] });
    return rows.map(toServiceDto);
  }

  async getService(user: AuthUser, id: string): Promise<ServiceDetail> {
    const s = await this.serviceRow(this.prisma, user, id);
    const prices = await this.prisma.servicePriceHistory.findMany({
      where: { serviceId: id, OR: [{ buildingId: null }, { building: this.access.buildingWhere(user) }] },
      include: { building: { select: { code: true } } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const dtos = await this.priceDtos(prices);
    const general = prices.filter((p) => p.buildingId === null).map((p) => ({ ...p, effectiveFrom: day(p.effectiveFrom) }));
    return {
      ...toServiceDto(s),
      current_price: s.type === 'METER' ? null : (decimal(priceOn(general, this.clock.today())?.unitPrice) ?? null),
      prices: dtos,
    };
  }

  async createService(user: AuthUser, input: z.output<typeof serviceCreateSchema>): Promise<ServiceDetail> {
    try {
      const id = await runInTransaction(this.prisma, async (tx) => {
        const s = await tx.service.create({
          data: {
            workspaceId: user.workspaceId,
            code: input.code,
            name: input.name,
            type: input.type,
            unit: input.unit,
            chargeTiming: input.charge_timing,
            substitutesMeter: input.substitutes_meter,
          },
        });
        await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'service.create', entityType: 'service', entityId: s.id, after: input });
        return s.id;
      });
      return this.getService(user, id);
    } catch (error) {
      if (pgErrorCode(error) === PG.UNIQUE_VIOLATION) throw new AppError('CONFLICT', 'Mã dịch vụ đã tồn tại.', { code: ['Mã đã được dùng.'] });
      throw error;
    }
  }

  /** Sửa tên/đơn vị/thời điểm thu, lưu trữ. Không đổi loại dịch vụ; điện nước luôn thu sau. */
  async updateService(user: AuthUser, id: string, input: z.output<typeof serviceUpdateSchema>): Promise<ServiceDetail> {
    await runInTransaction(this.prisma, async (tx) => {
      const s = await this.serviceRow(tx, user, id);
      if (s.type === 'METER' && (input.charge_timing === 'ADVANCE' || input.substitutes_meter || input.archived)) {
        throw new AppError('BUSINESS_RULE_VIOLATION', 'Điện, nước theo đồng hồ luôn thu sau và không lưu trữ được.');
      }
      const data: Prisma.ServiceUpdateManyMutationInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.charge_timing !== undefined ? { chargeTiming: input.charge_timing } : {}),
        ...(input.substitutes_meter !== undefined ? { substitutesMeter: input.substitutes_meter } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? this.clock.now() : null } : {}),
      };
      await updateVersioned(tx.service, { id, workspaceId: user.workspaceId }, input.expected_version, data);
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'service.update', entityType: 'service', entityId: id, before: toServiceDto(s), after: input });
    });
    return this.getService(user, id);
  }

  /** Giá dịch vụ không đồng hồ: chung (building_id null) hoặc riêng một tòa. Đổi giữa tháng cần xác nhận (4.4). */
  async createServicePrice(user: AuthUser, id: string, input: z.output<typeof servicePriceCreateSchema>): Promise<ServiceDetail> {
    await this.mapErrors(() =>
      runInTransaction(this.prisma, async (tx) => {
        const s = await this.serviceRow(tx, user, id);
        if (s.type === 'METER') throw new AppError('BUSINESS_RULE_VIOLATION', 'Giá điện nước đặt theo từng tòa ở trang tòa (nút “Thay đổi giá”).');
        if (input.building_id) await this.access.getBuildingInScope(tx, user, input.building_id);
        if (!input.effective_from.endsWith('-01') && !input.confirm_mid_month) {
          throw new AppError('BUSINESS_RULE_VIOLATION', 'Giá mới có hiệu lực giữa tháng: phí tháng đó sẽ chia theo ngày. Hãy xác nhận để tiếp tục.', {
            confirm_mid_month: ['Cần xác nhận đổi giá giữa tháng.'],
          });
        }
        const p = await tx.servicePriceHistory.create({
          data: {
            workspaceId: user.workspaceId,
            serviceId: id,
            buildingId: input.building_id,
            effectiveFrom: toDbDate(input.effective_from),
            unitPrice: input.unit_price,
            reason: input.reason,
            createdBy: user.id,
          },
        });
        await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'service.price', entityType: 'service', entityId: id, reason: input.reason, after: { ...input, id: p.id } });
      }),
    );
    return this.getService(user, id);
  }

  // ------------------------------------------------------------------ Giá điện nước theo tòa

  async meterPrices(user: AuthUser, buildingId: string): Promise<MeterPrices> {
    await this.access.getBuildingInScope(this.prisma, user, buildingId);
    const today = this.clock.today();
    const currentPeriod = firstDayOfMonth(today);
    const services = await this.meterServices(this.prisma, user.workspaceId);
    const rows = await this.prisma.servicePriceHistory.findMany({
      where: { buildingId, serviceId: { in: services.map((s) => s.id) } },
      include: { building: { select: { code: true } } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const dtos = await this.priceDtos(rows);
    return {
      building_id: buildingId,
      next_period_start: nextReadingPeriod(await this.latestReadPeriod(this.prisma, buildingId), today),
      items: services.map((s) => {
        const mine = dtos.filter((d) => d.service_id === s.id);
        return {
          meter_type: s.meterType!,
          service_id: s.id,
          name: s.name,
          unit: s.unit,
          current: priceOn(mine.map((d) => ({ effectiveFrom: d.effective_from, d })), currentPeriod)?.d ?? null,
          upcoming: mine.filter((d) => d.effective_from > currentPeriod).reverse(),
          history: mine,
        };
      }),
    };
  }

  /**
   * “Thay đổi giá”: tạo phiên bản giá mới cho tòa, áp dụng từ đầu một kỳ. Không sửa phiên bản cũ.
   * Kỳ áp dụng đã có chỉ số chốt thì phải xác nhận (tiền tạm tính kỳ đó đổi). Phase 5 chặn kỳ đã phát hành.
   */
  async createMeterPrice(user: AuthUser, buildingId: string, input: z.output<typeof meterPriceCreateSchema>): Promise<MeterPrices> {
    await this.mapErrors(() =>
      runInTransaction(this.prisma, async (tx) => {
        await lockRows(tx, 'buildings', [buildingId]);
        await this.access.getBuildingInScope(tx, user, buildingId);
        const service = (await this.meterServices(tx, user.workspaceId)).find((s) => s.meterType === input.meter_type);
        if (!service) throw new AppError('NOT_FOUND', 'Chưa có dịch vụ điện/nước theo đồng hồ.');
        const latest = await this.latestReadPeriod(tx, buildingId);
        if (latest && input.effective_from <= latest && !input.confirm_existing_readings) {
          throw new AppError('BUSINESS_RULE_VIOLATION', `Kỳ ${input.effective_from.slice(5, 7)}/${input.effective_from.slice(0, 4)} đã có chỉ số chốt; tiền tạm tính của kỳ đó sẽ đổi theo giá mới. Hãy xác nhận để tiếp tục.`, {
            confirm_existing_readings: ['Cần xác nhận áp dụng cho kỳ đã có chỉ số.'],
          });
        }
        const before = await tx.servicePriceHistory.findFirst({
          where: { serviceId: service.id, buildingId, effectiveFrom: { lte: toDbDate(input.effective_from) } },
          orderBy: { effectiveFrom: 'desc' },
        });
        const p = await tx.servicePriceHistory.create({
          data: {
            workspaceId: user.workspaceId,
            serviceId: service.id,
            buildingId,
            effectiveFrom: toDbDate(input.effective_from),
            unitPrice: input.unit_price,
            reason: input.reason,
            createdBy: user.id,
          },
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'meter_price.change',
          entityType: 'building',
          entityId: buildingId,
          reason: input.reason,
          before: before ? { unit_price: before.unitPrice.toString(), effective_from: day(before.effectiveFrom) } : null,
          after: { ...input, id: p.id },
        });
      }),
    );
    return this.meterPrices(user, buildingId);
  }

  // ------------------------------------------------------------------ Tra giá (dùng cho tạm tính và billing)

  /** Đơn giá điện/nước của tòa áp dụng cho kỳ có ngày đầu `periodStart`; null = tòa chưa đặt giá. */
  async meterUnitPrices(db: Db, workspaceId: string, buildingId: string, periodStart: string): Promise<Record<MeterType, string | null>> {
    const services = await this.meterServices(db, workspaceId);
    const rows = await db.servicePriceHistory.findMany({ where: { buildingId, serviceId: { in: services.map((s) => s.id) }, effectiveFrom: { lte: toDbDate(periodStart) } } });
    const result: Record<MeterType, string | null> = { ELECTRICITY: null, WATER: null };
    for (const s of services) {
      const v = priceOn(
        rows.filter((r) => r.serviceId === s.id).map((r) => ({ effectiveFrom: day(r.effectiveFrom), price: r.unitPrice.toString() })),
        periodStart,
      );
      result[s.meterType!] = v?.price ?? null;
    }
    return result;
  }

  /** Kỳ mới nhất đã có chỉ số chốt của một tòa. */
  async latestReadPeriod(db: Db, buildingId: string): Promise<string | null> {
    const r = await db.meterReading.findFirst({
      where: { kind: 'PERIODIC', meter: { room: { buildingId } } },
      include: { statementPeriod: true },
      orderBy: { statementPeriod: { monthStart: 'desc' } },
    });
    return r?.statementPeriod ? fromDbDate(r.statementPeriod.monthStart) : null;
  }

  // ------------------------------------------------------------------ Hỗ trợ

  private meterServices(db: Db, workspaceId: string) {
    return db.service.findMany({ where: { workspaceId, type: 'METER', archivedAt: null }, orderBy: { meterType: 'asc' } });
  }

  private async serviceRow(db: Db, user: AuthUser, id: string): Promise<Service> {
    const s = await db.service.findFirst({ where: { id, workspaceId: user.workspaceId } });
    if (!s) throw new AppError('NOT_FOUND');
    return s;
  }

  private async priceDtos(rows: PriceRow[]): Promise<ServicePriceDto[]> {
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    return rows.map((p) => ({
      id: p.id,
      service_id: p.serviceId,
      building_id: p.buildingId,
      building_code: p.building?.code ?? null,
      effective_from: day(p.effectiveFrom),
      unit_price: p.unitPrice.toString(),
      reason: p.reason,
      created_by_name: names.get(p.createdBy) ?? null,
      created_at: iso(p.createdAt)!,
    }));
  }

  private async mapErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (pgErrorCode(error) === PG.UNIQUE_VIOLATION && ['one_building_service_price_per_day', 'one_general_service_price_per_day'].includes(violatedConstraint(error) ?? '')) {
        throw new AppError('CONFLICT', 'Đã có một mức giá có hiệu lực từ đúng ngày này.', { effective_from: ['Trùng ngày hiệu lực.'] });
      }
      throw error;
    }
  }
}
