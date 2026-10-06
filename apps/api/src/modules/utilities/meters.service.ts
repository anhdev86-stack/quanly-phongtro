import { Inject, Injectable } from '@nestjs/common';
import {
  type meterCreateSchema,
  type meterInitialCorrectSchema,
  type meterReplaceSchema,
  type ReadingDto,
  type readingBatchSchema,
  type readingCorrectSchema,
  type ReadingSheet,
  type readingSheetQuerySchema,
  type RoomMeters,
  type SheetMeter,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode, violatedConstraint } from '../../common/db/pg-errors.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { day, dayOrNull, iso, naturalCompare } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { type DateOnly, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import { formatFixed2, parseFixed2 } from '../../domain/utilities/fixed2.js';
import { meterCharge, usageWarning } from '../../domain/utilities/meter-charge.js';
import { closedIntervalUsages, type MeterPoint, pendingInterval, usageFor } from '../../domain/utilities/meter-usage.js';
import type { Meter, MeterReading, MeterType, Prisma, Tenancy } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OPEN_TENANCY_STATUSES, RoomsService } from '../rooms/rooms.service.js';
import { PricesService } from './prices.service.js';
import { SettingsService } from './settings.service.js';
import { userNames } from './user-names.js';

const METER_TYPES: MeterType[] = ['ELECTRICITY', 'WATER'];
const TYPE_LABEL: Record<MeterType, string> = { ELECTRICITY: 'điện', WATER: 'nước' };

type ReadingWithPeriod = MeterReading & { statementPeriod: { monthStart: Date } | null };

const periodOf = (r: ReadingWithPeriod) => (r.statementPeriod ? fromDbDate(r.statementPeriod.monthStart).slice(0, 7) : null);

/**
 * Điểm đọc của một (phòng, loại) trong lần thuê: chỉ số gắn lần thuê + điểm lắp đồng hồ trong thời gian thuê.
 * Đồng hồ có từ trước mà lần thuê chưa có chỉ số nào: lấy chỉ số gần nhất của đồng hồ (hoặc chỉ số ban đầu) làm mốc.
 */
export function tenancyPoints(meters: Meter[], readings: MeterReading[], tenancy: Pick<Tenancy, 'id' | 'startDate'>): MeterPoint[] {
  const start = fromDbDate(tenancy.startDate);
  const points: MeterPoint[] = [];
  for (const m of meters) {
    const all = readings.filter((r) => r.meterId === m.id);
    const mine = all.filter((r) => r.tenancyId === tenancy.id);
    for (const r of mine) points.push({ meterId: m.id, readOn: day(r.readOn), value: parseFixed2(r.value.toString()), kind: r.kind, readingId: r.id });
    const installed = day(m.installedOn);
    if (installed >= start) points.push({ meterId: m.id, readOn: installed, value: parseFixed2(m.initialReading.toString()), kind: 'INSTALL' });
    else if (!mine.length && !m.retiredOn) {
      const last = [...all].sort((a, b) => (a.readOn < b.readOn ? 1 : -1))[0];
      points.push(
        last
          ? { meterId: m.id, readOn: day(last.readOn), value: parseFixed2(last.value.toString()), kind: 'INITIAL', readingId: last.id }
          : { meterId: m.id, readOn: installed, value: parseFixed2(m.initialReading.toString()), kind: 'INITIAL' },
      );
    }
  }
  return points;
}

/** Đồng hồ, chỉ số và tiền điện nước tạm tính (MASTER_PLAN 8.5, T13, T14, T61). */
@Injectable()
export class MetersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly rooms: RoomsService,
    private readonly prices: PricesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ Đồng hồ của phòng

  async roomMeters(user: AuthUser, roomId: string): Promise<RoomMeters> {
    await this.rooms.getRow(this.prisma, user, roomId);
    const meters = await this.prisma.meter.findMany({ where: { roomId }, orderBy: [{ type: 'asc' }, { installedOn: 'desc' }] });
    const ids = meters.map((m) => m.id);
    const readings = await this.prisma.meterReading.findMany({
      where: { meterId: { in: ids } },
      include: { statementPeriod: { select: { monthStart: true } } },
      orderBy: [{ readOn: 'desc' }, { createdAt: 'desc' }],
      take: 60,
    });
    const events = await this.prisma.meterEvent.findMany({ where: { meterId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 30 });
    const names = await userNames(this.prisma, [...readings.map((r) => r.createdBy), ...events.map((e) => e.createdBy)]);
    const typeOf = new Map(meters.map((m) => [m.id, m.type]));
    return {
      meters: meters.map((m) => {
        const last = readings.find((r) => r.meterId === m.id);
        return {
          id: m.id,
          room_id: m.roomId,
          type: m.type,
          serial: m.serial,
          installed_on: day(m.installedOn),
          retired_on: dayOrNull(m.retiredOn),
          initial_reading: m.initialReading.toString(),
          last_reading: last ? { value: last.value.toString(), read_on: day(last.readOn), kind: last.kind } : null,
        };
      }),
      readings: readings.map((r) => this.readingDto(r, typeOf.get(r.meterId)!, names)),
      events: events.map((e) => ({
        id: e.id,
        meter_id: e.meterId,
        meter_type: typeOf.get(e.meterId)!,
        kind: e.kind,
        reason: e.reason,
        old_value: e.oldValue?.toString() ?? null,
        new_value: e.newValue?.toString() ?? null,
        created_by_name: names.get(e.createdBy) ?? null,
        created_at: iso(e.createdAt)!,
      })),
    };
  }

  /** Gắn đồng hồ: chỉ số ban đầu nhập một lần; từ đó chỉ số trước luôn tự lấy. */
  async attach(user: AuthUser, roomId: string, input: z.output<typeof meterCreateSchema>): Promise<RoomMeters> {
    await this.mapErrors(() =>
      runInTransaction(this.prisma, async (tx) => {
        await lockRows(tx, 'rooms', [roomId]);
        await this.rooms.getRow(tx, user, roomId);
        if (input.installed_on > this.clock.today()) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày lắp không được ở tương lai.', { installed_on: ['Ngày ở tương lai.'] });
        const open = await this.openTenancy(tx, roomId);
        if (open && !input.confirm_dual_utility) {
          const substitute = await this.substituteService(tx, open.id, input.type, input.installed_on);
          if (substitute) {
            throw new AppError('BUSINESS_RULE_VIOLATION', `Lần thuê đang dùng “${substitute}”. Gắn thêm đồng hồ ${TYPE_LABEL[input.type]} nghĩa là có thể tính cả hai khoản; hãy xác nhận.`, {
              confirm_dual_utility: ['Cần xác nhận tính cả hai khoản.'],
            });
          }
        }
        const m = await tx.meter.create({
          data: {
            workspaceId: user.workspaceId,
            roomId,
            type: input.type,
            serial: input.serial,
            installedOn: toDbDate(input.installed_on),
            initialReading: input.initial_reading,
            createdBy: user.id,
          },
        });
        await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'meter.attach', entityType: 'meter', entityId: m.id, after: input });
      }),
    );
    return this.roomMeters(user, roomId);
  }

  /** Thay đồng hồ: chốt đồng hồ cũ (CLOSING), ngưng nó và lắp đồng hồ mới với chỉ số ban đầu riêng (T14). */
  async replace(user: AuthUser, meterId: string, input: z.output<typeof meterReplaceSchema>): Promise<RoomMeters> {
    const meter = await this.meterInScope(this.prisma, user, meterId);
    await this.mapErrors(() =>
      runInTransaction(this.prisma, async (tx) => {
        await lockRows(tx, 'rooms', [meter.roomId]);
        const m = await this.meterInScope(tx, user, meterId);
        if (m.retiredOn) throw new AppError('BUSINESS_RULE_VIOLATION', 'Đồng hồ đã ngưng sử dụng.');
        if (input.replaced_on > this.clock.today()) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày thay không được ở tương lai.', { replaced_on: ['Ngày ở tương lai.'] });
        const last = await tx.meterReading.findFirst({ where: { meterId }, orderBy: { readOn: 'desc' } });
        const lastDate = last ? day(last.readOn) : day(m.installedOn);
        if (last ? input.replaced_on <= lastDate : input.replaced_on < lastDate) {
          throw new AppError('BUSINESS_RULE_VIOLATION', `Ngày thay phải sau lần đọc gần nhất (${lastDate}).`, { replaced_on: ['Trước lần đọc gần nhất.'] });
        }
        const lastValue = last ? last.value : m.initialReading;
        if (parseFixed2(input.closing_value) < parseFixed2(lastValue.toString())) {
          throw new AppError('BUSINESS_RULE_VIOLATION', `Chỉ số chốt không được nhỏ hơn lần đọc trước (${lastValue.toString()}).`, { closing_value: ['Nhỏ hơn lần đọc trước.'] });
        }
        const open = await this.openTenancy(tx, m.roomId);
        await tx.meter.update({ where: { id: meterId }, data: { retiredOn: toDbDate(input.replaced_on) } });
        await tx.meterReading.create({
          data: { meterId, tenancyId: open?.id ?? null, readOn: toDbDate(input.replaced_on), value: input.closing_value, kind: 'CLOSING', note: input.reason, createdBy: user.id },
        });
        const fresh = await tx.meter.create({
          data: {
            workspaceId: user.workspaceId,
            roomId: m.roomId,
            type: m.type,
            serial: input.new_serial,
            installedOn: toDbDate(input.replaced_on),
            initialReading: input.new_initial_reading,
            createdBy: user.id,
          },
        });
        await tx.meterEvent.create({
          data: { meterId, kind: 'REPLACEMENT', reason: input.reason, oldValue: input.closing_value, newValue: input.new_initial_reading, createdBy: user.id },
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'meter.replace',
          entityType: 'meter',
          entityId: meterId,
          reason: input.reason,
          after: { ...input, new_meter_id: fresh.id },
        });
      }),
    );
    return this.roomMeters(user, meter.roomId);
  }

  /** Sửa chỉ số ban đầu của đồng hồ (nhập sai lúc gắn). Không được lớn hơn chỉ số đầu tiên đã đọc. */
  async correctInitial(user: AuthUser, meterId: string, input: z.output<typeof meterInitialCorrectSchema>): Promise<RoomMeters> {
    const meter = await this.meterInScope(this.prisma, user, meterId);
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'rooms', [meter.roomId]);
      const m = await this.meterInScope(tx, user, meterId);
      const first = await tx.meterReading.findFirst({ where: { meterId }, orderBy: { readOn: 'asc' } });
      if (first && parseFixed2(input.initial_reading) > parseFixed2(first.value.toString())) {
        throw new AppError('BUSINESS_RULE_VIOLATION', `Chỉ số ban đầu không được lớn hơn lần đọc đầu tiên (${first.value.toString()}).`, { initial_reading: ['Lớn hơn lần đọc sau.'] });
      }
      await tx.meter.update({ where: { id: meterId }, data: { initialReading: input.initial_reading } });
      await tx.meterEvent.create({
        data: { meterId, kind: 'CORRECTION', reason: input.reason, oldValue: m.initialReading, newValue: input.initial_reading, createdBy: user.id },
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'meter.correct_initial',
        entityType: 'meter',
        entityId: meterId,
        reason: input.reason,
        before: { initial_reading: m.initialReading.toString() },
        after: { initial_reading: input.initial_reading },
      });
    });
    return this.roomMeters(user, meter.roomId);
  }

  // ------------------------------------------------------------------ Bảng nhập chỉ số theo đợt

  /**
   * Bảng nhập chỉ số của một tòa cho một kỳ: mỗi phòng đang có người thuê, chỉ số trước tự lấy,
   * tiêu thụ, đơn giá của tòa và tiền tạm tính (cùng hàm meterCharge với billing — T61).
   */
  async sheet(user: AuthUser, q: z.output<typeof readingSheetQuerySchema>): Promise<ReadingSheet> {
    const building = await this.access.getBuildingInScope(this.prisma, user, q.building_id);
    const monthStart = `${q.period}-01`;
    const today = this.clock.today();
    const period = await this.prisma.statementPeriod.findUnique({ where: { workspaceId_monthStart: { workspaceId: user.workspaceId, monthStart: toDbDate(monthStart) } } });
    const tenancies = await this.prisma.tenancy.findMany({
      where: { workspaceId: user.workspaceId, status: { in: [...OPEN_TENANCY_STATUSES] }, room: { buildingId: building.id } },
      include: {
        room: true,
        members: { include: { tenant: { select: { fullName: true } } } },
        services: { where: { status: 'ACTIVE' }, include: { service: true } },
      },
    });
    const meters = await this.prisma.meter.findMany({ where: { roomId: { in: tenancies.map((t) => t.roomId) } } });
    const readings = await this.prisma.meterReading.findMany({ where: { meterId: { in: meters.map((m) => m.id) } } });
    const policy = await this.settings.billingPolicy(this.prisma, user.workspaceId, monthStart);
    const unitPrices = await this.prices.meterUnitPrices(this.prisma, user.workspaceId, building.id, monthStart);

    let total = 0n;
    let entered = 0;
    let expected = 0;
    const rows = tenancies
      .sort((a, b) => naturalCompare(a.room.code, b.room.code))
      .map((t) => {
        const occupants = t.members.filter((m) => day(m.joinedOn) <= today && (!m.leftOnExclusive || day(m.leftOnExclusive) > today)).length;
        const primary = t.members.find((m) => m.role === 'PRIMARY' && !m.leftOnExclusive) ?? t.members.find((m) => m.role === 'PRIMARY');
        const sheetMeters: SheetMeter[] = METER_TYPES.map((type) => {
          const substitute = t.services.find(
            (s) => s.service.substitutesMeter === type && day(s.effectiveFrom) <= monthStart && (!s.endExclusive || day(s.endExclusive) > monthStart),
          );
          const ofType = meters.filter((m) => m.roomId === t.roomId && m.type === type);
          // Kỳ đã nhập: chỉ số nằm trên đồng hồ lúc đó (có thể đã thay); kỳ chưa nhập: đồng hồ đang dùng.
          const current = readings.find((r) => ofType.some((m) => m.id === r.meterId) && r.kind === 'PERIODIC' && period && r.statementPeriodId === period.id);
          const active = current ? ofType.find((m) => m.id === current.meterId) : ofType.find((m) => !m.retiredOn);
          const base = { type, substituted_by: substitute?.service.name ?? null, unit_price: unitPrices[type] };
          if (!active) return { ...base, meter_id: null, previous: null, carried_usage: '0', current: null, usage: null, provisional_vnd: null, warning: null };
          expected++;
          const points = tenancyPoints(ofType, readings, t);
          const before = current ? day(current.readOn) : undefined;
          const interval = pendingInterval(points, active.id, before);
          let usage: bigint | null = null;
          let provisional: bigint | null = null;
          let warning: SheetMeter['warning'] = null;
          if (current) {
            entered++;
            const u = usageFor(interval, parseFixed2(current.value.toString()));
            if (u.ok) {
              usage = u.usage;
              warning = usageWarning(u.usage, closedIntervalUsages(points.filter((p) => !before || p.readOn < before)), occupants > 0);
              if (unitPrices[type] !== null) {
                provisional = meterCharge(u.usage, parseFixed2(unitPrices[type]), policy.rounding_unit);
                total += provisional;
              }
            }
          }
          return {
            ...base,
            meter_id: active.id,
            previous: interval.previous
              ? {
                  value: formatFixed2(interval.previous.value),
                  read_on: interval.previous.readOn,
                  kind: interval.previous.kind,
                  reading_id: interval.previous.readingId ?? null,
                  version: readings.find((r) => r.id === interval.previous!.readingId)?.version ?? null,
                }
              : null,
            carried_usage: formatFixed2(interval.carried),
            current: current ? { id: current.id, value: current.value.toString(), read_on: day(current.readOn), version: current.version } : null,
            usage: usage === null ? null : formatFixed2(usage),
            provisional_vnd: provisional?.toString() ?? null,
            warning,
          };
        });
        return {
          room_id: t.roomId,
          room_code: t.room.code,
          floor: t.room.floor,
          tenancy_id: t.id,
          tenancy_code: t.code,
          primary_tenant_name: primary?.tenant.fullName ?? null,
          occupants,
          meters: sheetMeters,
        };
      });

    return {
      building_id: building.id,
      building_code: building.code,
      period: q.period,
      month_start: monthStart,
      rounding_unit: policy.rounding_unit,
      unit_prices: unitPrices,
      rows,
      totals: { provisional_vnd: total.toString(), entered, expected },
    };
  }

  /**
   * Lưu chỉ số chốt của kỳ (một hoặc nhiều đồng hồ, atomic). Chỉ số đã nhập trong kỳ được nhập lại khi có expected_version.
   * Chỉ số trước luôn lấy từ dữ liệu; nhỏ hơn lần đọc trước bị từ chối, bằng thì hợp lệ (T13).
   */
  async saveBatch(user: AuthUser, input: z.output<typeof readingBatchSchema>): Promise<{ saved: ReadingDto[] }> {
    const monthStart = `${input.period}-01`;
    if (input.read_on > this.clock.today()) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày đọc không được ở tương lai.', { read_on: ['Ngày ở tương lai.'] });
    const ids = await this.mapErrors(() =>
      runInTransaction(this.prisma, async (tx) => {
        const meters = await tx.meter.findMany({ where: { id: { in: input.items.map((i) => i.meter_id) }, workspaceId: user.workspaceId, room: this.rooms.roomWhere(user) } });
        if (meters.length !== input.items.length) throw new AppError('NOT_FOUND', 'Có đồng hồ không tồn tại hoặc ngoài phạm vi.');
        await lockRows(tx, 'rooms', meters.map((m) => m.roomId));
        const period = await tx.statementPeriod.upsert({
          where: { workspaceId_monthStart: { workspaceId: user.workspaceId, monthStart: toDbDate(monthStart) } },
          update: {},
          create: { workspaceId: user.workspaceId, monthStart: toDbDate(monthStart) },
        });
        if (period.status === 'CLOSED') throw new AppError('BUSINESS_RULE_VIOLATION', `Kỳ ${input.period} đã đóng.`);

        const saved: string[] = [];
        for (const [i, item] of input.items.entries()) {
          const field = `items.${i}.value`;
          const meter = meters.find((m) => m.id === item.meter_id)!;
          if (meter.retiredOn) throw new AppError('BUSINESS_RULE_VIOLATION', 'Đồng hồ đã ngưng; hãy nhập cho đồng hồ mới.', { [field]: ['Đồng hồ đã ngưng.'] });
          const tenancy = await this.openTenancy(tx, meter.roomId);
          if (!tenancy) throw new AppError('BUSINESS_RULE_VIOLATION', 'Phòng không có người đang thuê.', { [field]: ['Phòng trống.'] });
          if (input.read_on < day(tenancy.startDate)) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày đọc trước ngày nhận phòng.', { read_on: ['Trước ngày nhận phòng.'] });
          const existing = await tx.meterReading.findFirst({ where: { meterId: meter.id, statementPeriodId: period.id, kind: 'PERIODIC' } });
          if (existing && item.expected_version === undefined) {
            throw new AppError('CONFLICT', `Đồng hồ đã có chỉ số kỳ ${input.period}. Tải lại để sửa.`, { [field]: ['Đã có chỉ số kỳ này.'] });
          }
          await this.assertOrder(tx, meter, input.read_on, parseFixed2(item.value), existing?.id ?? null, field);
          let id: string;
          if (existing) {
            await updateVersioned(tx.meterReading, { id: existing.id }, item.expected_version!, { value: item.value, readOn: toDbDate(input.read_on), tenancyId: tenancy.id });
            id = existing.id;
          } else {
            id = (
              await tx.meterReading.create({
                data: { meterId: meter.id, tenancyId: tenancy.id, readOn: toDbDate(input.read_on), value: item.value, kind: 'PERIODIC', statementPeriodId: period.id, createdBy: user.id },
              })
            ).id;
          }
          await this.audit.record(tx, {
            workspaceId: user.workspaceId,
            actorId: user.id,
            action: existing ? 'meter_reading.update' : 'meter_reading.record',
            entityType: 'meter_reading',
            entityId: id,
            before: existing ? { value: existing.value.toString(), read_on: day(existing.readOn) } : null,
            after: { meter_id: meter.id, period: input.period, read_on: input.read_on, value: item.value },
          });
          saved.push(id);
        }
        return saved;
      }),
    );
    return { saved: await this.readingDtos(ids) };
  }

  /**
   * “Sửa chỉ số” (chỉ số trước/chỉ số đầu…): bắt buộc lý do, có audit và meter_event CORRECTION.
   * Chưa có thông báo phát hành nên sửa trực tiếp; Phase 5 chuyển sang đối soát khi chỉ số đã dùng (D-025).
   */
  async correct(user: AuthUser, readingId: string, input: z.output<typeof readingCorrectSchema>): Promise<ReadingDto> {
    const found = await this.prisma.meterReading.findFirst({ where: { id: readingId, meter: { workspaceId: user.workspaceId, room: this.rooms.roomWhere(user) } }, include: { meter: true } });
    if (!found) throw new AppError('NOT_FOUND');
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'rooms', [found.meter.roomId]);
      const r = await tx.meterReading.findUniqueOrThrow({ where: { id: readingId } });
      await this.assertOrder(tx, found.meter, day(r.readOn), parseFixed2(input.value), r.id, 'value');
      await updateVersioned(tx.meterReading, { id: readingId }, input.expected_version, { value: input.value });
      // Chỉ số đọc đúng ngày lắp (VD chỉ số nhận phòng khi đồng hồ tạo lúc nhận phòng) chính là chỉ số ban đầu của đồng hồ.
      if (day(r.readOn) === day(found.meter.installedOn)) await tx.meter.update({ where: { id: r.meterId }, data: { initialReading: input.value } });
      await tx.meterEvent.create({
        data: { meterId: r.meterId, readingId, kind: 'CORRECTION', reason: input.reason, oldValue: r.value, newValue: input.value, createdBy: user.id },
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'meter_reading.correct',
        entityType: 'meter_reading',
        entityId: readingId,
        reason: input.reason,
        before: { value: r.value.toString() },
        after: { value: input.value },
      });
    });
    return (await this.readingDtos([readingId]))[0]!;
  }

  /**
   * Ghi chỉ số FINAL (cuối kỳ khi trả phòng) cho đồng hồ của lần thuê; thay chỉ số FINAL cũ của cùng quyết toán.
   * Chỉ số FINAL chưa bao giờ nằm trên chứng từ đã phát hành trước khi quyết toán hoàn tất nên thay được.
   */
  async setFinalReadingsInTx(tx: Prisma.TransactionClient, user: AuthUser, tenancyId: string, roomId: string, readOn: DateOnly, items: { meter_id: string; value: string }[]) {
    const old = await tx.meterReading.findMany({ where: { tenancyId, kind: 'FINAL' } });
    if (old.length) {
      const used = await tx.invoiceItem.count({ where: { OR: [{ readingEndId: { in: old.map((o) => o.id) } }, { readingStartId: { in: old.map((o) => o.id) } }], invoice: { lifecycle: 'PUBLISHED' } } });
      if (used) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ số cuối kỳ đã dùng trên chứng từ đã phát hành.');
      await tx.meterReading.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
    for (const [i, item] of items.entries()) {
      const meter = await tx.meter.findFirst({ where: { id: item.meter_id, roomId, retiredOn: null } });
      if (!meter) throw new AppError('BUSINESS_RULE_VIOLATION', 'Đồng hồ không thuộc phòng hoặc đã ngưng.', { [`final_readings.${i}.meter_id`]: ['Đồng hồ không hợp lệ.'] });
      await this.assertOrder(tx, meter, readOn, parseFixed2(item.value), null, `final_readings.${i}.value`);
      await tx.meterReading.create({ data: { meterId: meter.id, tenancyId, readOn: toDbDate(readOn), value: item.value, kind: 'FINAL', note: 'Chỉ số trả phòng', createdBy: user.id } });
    }
  }

  // ------------------------------------------------------------------ Hỗ trợ

  /** Chỉ số tại ngày phải nằm giữa lần đọc trước và lần đọc sau của cùng đồng hồ (không tạo tiêu thụ âm). */
  async assertOrder(tx: Prisma.TransactionClient, meter: Meter, readOn: DateOnly, value: bigint, selfId: string | null, field: string) {
    const others = (await tx.meterReading.findMany({ where: { meterId: meter.id } })).filter((r) => r.id !== selfId);
    if (readOn < day(meter.installedOn)) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày đọc trước ngày lắp đồng hồ.', { read_on: ['Trước ngày lắp.'] });
    if (others.some((r) => day(r.readOn) === readOn)) throw new AppError('CONFLICT', 'Đồng hồ đã có chỉ số trong ngày này.', { read_on: ['Trùng ngày đọc.'] });
    const prev = others.filter((r) => day(r.readOn) < readOn).sort((a, b) => (a.readOn < b.readOn ? 1 : -1))[0];
    const next = others.filter((r) => day(r.readOn) > readOn).sort((a, b) => (a.readOn < b.readOn ? -1 : 1))[0];
    // Chỉ số đọc đúng ngày lắp là chỉ số đầu tiên của đồng hồ: không có mốc thấp hơn.
    const prevValue = prev ? parseFixed2(prev.value.toString()) : readOn > day(meter.installedOn) ? parseFixed2(meter.initialReading.toString()) : 0n;
    if (value < prevValue) {
      throw new AppError('BUSINESS_RULE_VIOLATION', `Chỉ số ${formatFixed2(value)} nhỏ hơn lần đọc trước (${formatFixed2(prevValue)}) — tiêu thụ âm. Thay đồng hồ thì dùng “Thay đồng hồ”.`, {
        [field]: [`Nhỏ hơn chỉ số trước ${formatFixed2(prevValue)}.`],
      });
    }
    if (next && value > parseFixed2(next.value.toString())) {
      throw new AppError('BUSINESS_RULE_VIOLATION', `Chỉ số lớn hơn lần đọc sau (${next.value.toString()} ngày ${day(next.readOn)}).`, { [field]: ['Lớn hơn chỉ số sau.'] });
    }
  }

  private openTenancy(db: Db, roomId: string) {
    return db.tenancy.findFirst({ where: { roomId, status: { in: [...OPEN_TENANCY_STATUSES] } } });
  }

  /** Tên dịch vụ thay đồng hồ đang bật cho lần thuê tại ngày (nếu có). */
  async substituteService(db: Db, tenancyId: string, type: MeterType, onDate: DateOnly): Promise<string | null> {
    const s = await db.tenancyService.findFirst({
      where: {
        tenancyId,
        status: 'ACTIVE',
        service: { substitutesMeter: type },
        effectiveFrom: { lte: toDbDate(onDate) },
        OR: [{ endExclusive: null }, { endExclusive: { gt: toDbDate(onDate) } }],
      },
      include: { service: true },
    });
    return s?.service.name ?? null;
  }

  private async meterInScope(db: Db, user: AuthUser, meterId: string): Promise<Meter> {
    const m = await db.meter.findFirst({ where: { id: meterId, workspaceId: user.workspaceId, room: this.rooms.roomWhere(user) } });
    if (!m) throw new AppError('NOT_FOUND');
    return m;
  }

  private async readingDtos(ids: string[]): Promise<ReadingDto[]> {
    const rows = await this.prisma.meterReading.findMany({ where: { id: { in: ids } }, include: { meter: true, statementPeriod: { select: { monthStart: true } } } });
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    return ids.map((id) => {
      const r = rows.find((x) => x.id === id)!;
      return this.readingDto(r, r.meter.type, names);
    });
  }

  private readingDto(r: ReadingWithPeriod, type: MeterType, names: Map<string, string>): ReadingDto {
    return {
      id: r.id,
      meter_id: r.meterId,
      meter_type: type,
      tenancy_id: r.tenancyId,
      read_on: day(r.readOn),
      value: r.value.toString(),
      kind: r.kind,
      period: periodOf(r),
      note: r.note,
      version: r.version,
      created_by_name: names.get(r.createdBy) ?? null,
    };
  }

  private async mapErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const code = pgErrorCode(error);
      const constraint = violatedConstraint(error);
      if (code === PG.UNIQUE_VIOLATION && constraint === 'one_active_meter_per_type') {
        throw new AppError('CONFLICT', 'Phòng đã có đồng hồ loại này đang dùng. Muốn đổi thì dùng “Thay đồng hồ”.', { type: ['Đã có đồng hồ đang dùng.'] });
      }
      if (code === PG.UNIQUE_VIOLATION && (constraint === 'one_periodic_reading_per_period' || constraint?.startsWith('meter_readings_meter_id_read_on'))) {
        throw new AppError('CONFLICT', 'Đồng hồ đã có chỉ số trong kỳ/ngày này.', { read_on: ['Trùng chỉ số.'] });
      }
      throw error;
    }
  }
}

