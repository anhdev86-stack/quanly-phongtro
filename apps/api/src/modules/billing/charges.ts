import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { BILLING_SETTINGS_DEFAULTS, type BlockingError } from '@ql-tro/shared';
import { addDays, addMonths, type DateOnly, firstDayOfMonth, fromDbDate } from '../../domain/dates/date-only.js';
import { type BillingPolicy, prorateMonth, SCALE } from '../../domain/billing/proration.js';
import { type Outcome, type PublishedLine, reconcile, type UnitExpectation } from '../../domain/billing/reconcile.js';
import { monthsBetween, overlap, slice, versionAt } from '../../domain/billing/segments.js';
import { formatFixed2, parseFixed2 } from '../../domain/utilities/fixed2.js';
import { meterCharge } from '../../domain/utilities/meter-charge.js';
import { chainUsage, type MeterPoint, sortPoints } from '../../domain/utilities/meter-usage.js';
import type {
  Building,
  ChargeTiming,
  InvoiceItem,
  Meter,
  MeterReading,
  MeterType,
  Prisma,
  RentPriceHistory,
  Room,
  Service,
  ServicePriceHistory,
  SettingsVersion,
  Tenancy,
  TenancyService,
  TenancyTenant,
} from '../../generated/prisma/client.js';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import { tenancyPoints } from '../utilities/meters.service.js';

// ------------------------------------------------------------------ Kiểu

export type LineGroup = 'ADVANCE' | 'ARREARS' | 'ADJUSTMENT';

export interface ComputedLine {
  group: LineGroup;
  chargeKind: 'RENT' | 'SERVICE' | 'METER' | 'DAMAGE' | 'OTHER';
  chargeTiming: ChargeTiming;
  direction: 'DEBIT' | 'CREDIT';
  label: string;
  quantity: string;
  unitPrice: string;
  amount: bigint;
  chargeStart: DateOnly | null;
  chargeEnd: DateOnly | null;
  sourceType: string;
  sourceId: string | null;
  sourceKey: string;
  unitKey: string;
  correctsItemId: string | null;
  readingStartId: string | null;
  readingEndId: string | null;
  policy: BillingPolicy;
  calc: Record<string, unknown>;
}

/**
 * Mốc tính của chứng từ (MASTER_PLAN 8.6). Thông báo tháng M: tiền phòng/dịch vụ thu trước hết tháng M,
 * dịch vụ thu sau hết tháng M−1, điện nước đến chỉ số chốt kỳ M. Thông báo trả phòng (Phase 7) dùng mốc riêng.
 */
export interface Cutoff {
  /** Tháng phát hành (để ghi nhãn “phí kỳ trước chưa lập”). */
  period: DateOnly;
  advanceThrough: DateOnly | null;
  arrearsThrough: DateOnly | null;
  meterPeriodThrough: DateOnly | null;
  includeFinalReadings: boolean;
  /** Chỉ đối soát các u đã phát hành (điều chỉnh ngay): không tạo phí mới. */
  onlyPublished?: boolean;
  /** Bắt buộc có chỉ số chốt kỳ này cho đồng hồ đang dùng (không phát hành bằng usage 0 giả). */
  requireReadingsFor: DateOnly | null;
  /** Khoản phí trả phòng (hư hỏng, phạt, khác) — mỗi khoản một u riêng (MASTER_PLAN 7.6 bước 3). */
  extraCharges?: ExtraCharge[];
}

export interface ExtraCharge {
  id: string;
  kind: 'DAMAGE' | 'OTHER';
  label: string;
  amount: bigint;
}

/**
 * Mốc FINAL (trả phòng, MASTER_PLAN 8.6/9.4): mọi nguồn phí tính đến charge_end_exclusive — tiền phòng, dịch vụ thu trước
 * và thu sau đến tháng của ngày cuối, mọi khoảng điện nước đến chỉ số FINAL. Phần đã thu vượt sau ngày cuối thành credit.
 */
export const finalCutoff = (lastChargeDate: DateOnly, extraCharges: ExtraCharge[] = []): Cutoff => {
  const lastMonth = firstDayOfMonth(lastChargeDate);
  return {
    period: lastMonth,
    advanceThrough: lastMonth,
    arrearsThrough: lastMonth,
    meterPeriodThrough: '9999-12-01',
    includeFinalReadings: true,
    requireReadingsFor: null,
    extraCharges,
  };
};

export const monthlyCutoff = (monthStart: DateOnly): Cutoff => ({
  period: monthStart,
  advanceThrough: monthStart,
  arrearsThrough: addMonths(monthStart, -1),
  meterPeriodThrough: monthStart,
  includeFinalReadings: false,
  requireReadingsFor: monthStart,
});

type TenancyFull = Tenancy & { room: Room & { building: Building } };
type ReadingFull = MeterReading & { statementPeriod: { monthStart: Date } | null };
type PublishedItem = InvoiceItem & { invoice: { publishedAt: Date | null; number: string | null } };

export interface BillingData {
  tenancy: TenancyFull;
  rents: RentPriceHistory[];
  subs: (TenancyService & { service: Service })[];
  prices: ServicePriceHistory[];
  members: TenancyTenant[];
  meters: Meter[];
  readings: ReadingFull[];
  meterServices: Service[];
  settings: SettingsVersion[];
  published: PublishedItem[];
}

export interface ComputeResult {
  lines: ComputedLine[];
  errors: BlockingError[];
}

// ------------------------------------------------------------------ Định dạng nhãn

const dm = (d: DateOnly) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dmy = (d: DateOnly) => `${dm(d)}/${d.slice(0, 4)}`;
const my = (d: DateOnly) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
const range = (s: DateOnly, e: DateOnly) => `${dm(s)}–${dmy(addDays(e, -1))}`;
const money = (v: bigint) => v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const TYPE_LABEL: Record<MeterType, string> = { ELECTRICITY: 'Điện', WATER: 'Nước' };
const METER_UNIT: Record<MeterType, string> = { ELECTRICITY: 'kWh', WATER: 'm³' };

const unitMonth = (unitKey: string) => unitKey.slice(-7);

// ------------------------------------------------------------------ Bộ tính

/**
 * Tính dòng phí của một lần thuê tại một mốc: dựng mọi đơn vị u, tính phí đúng E(u) từ dữ liệu nguồn ACTIVE,
 * đối soát với P(u) của chứng từ PUBLISHED (MASTER_PLAN 8.3–8.6, D-024, D-025). Hàm không ghi gì.
 */
@Injectable()
export class ChargeCalculator {
  async load(db: Db, tenancyId: string): Promise<BillingData> {
    // Chạy tuần tự: db có thể là transaction client (D-026).
    const tenancy = await db.tenancy.findUniqueOrThrow({ where: { id: tenancyId }, include: { room: { include: { building: true } } } });
    const rents = await db.rentPriceHistory.findMany({ where: { tenancyId, status: 'ACTIVE' }, orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }] });
    const subs = await db.tenancyService.findMany({ where: { tenancyId, status: 'ACTIVE' }, include: { service: true }, orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }] });
    const meterServices = await db.service.findMany({ where: { workspaceId: tenancy.workspaceId, type: 'METER' } });
    const serviceIds = [...new Set([...subs.map((s) => s.serviceId), ...meterServices.map((s) => s.id)])];
    const prices = await db.servicePriceHistory.findMany({
      where: { serviceId: { in: serviceIds }, OR: [{ buildingId: null }, { buildingId: tenancy.room.buildingId }] },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    });
    const members = await db.tenancyTenant.findMany({ where: { tenancyId } });
    const meters = await db.meter.findMany({ where: { roomId: tenancy.roomId } });
    const readings = await db.meterReading.findMany({ where: { meterId: { in: meters.map((m) => m.id) } }, include: { statementPeriod: { select: { monthStart: true } } } });
    const settings = await db.settingsVersion.findMany({ where: { workspaceId: tenancy.workspaceId, kind: 'BILLING' }, orderBy: { effectiveFrom: 'asc' } });
    const published = await db.invoiceItem.findMany({
      where: { invoice: { tenancyId, lifecycle: 'PUBLISHED' } },
      include: { invoice: { select: { publishedAt: true, number: true } } },
    });
    return { tenancy, rents, subs, prices, members, meters, readings, meterServices, settings, published };
  }

  compute(data: BillingData, cutoff: Cutoff): ComputeResult {
    const errors: BlockingError[] = [];
    const units: UnitExpectation<ComputedLine>[] = [];
    const skipped = new Set<string>();
    const t = data.tenancy;
    const start = fromDbDate(t.startDate);
    const endEx = t.chargeEndExclusive ? fromDbDate(t.chargeEndExclusive) : null;

    // Chính sách chốt theo u ở lần phát hành đầu (4.3); u mới dùng chính sách có hiệu lực tại đầu tháng của u.
    const frozen = new Map<string, BillingPolicy>();
    for (const p of [...data.published].sort((a, b) => order(a) - order(b))) {
      if (!frozen.has(p.unitKey)) frozen.set(p.unitKey, p.policySnapshot as unknown as BillingPolicy);
    }
    const policyFor = (unitKey: string, monthStart: DateOnly): BillingPolicy => {
      const f = frozen.get(unitKey);
      if (f) return f;
      const v = versionAt(
        data.settings.map((s) => ({ effectiveFrom: fromDbDate(s.effectiveFrom), payload: s.payload as unknown as BillingPolicy })),
        monthStart,
      );
      return { proration: (v?.payload ?? BILLING_SETTINGS_DEFAULTS).proration, rounding_unit: (v?.payload ?? BILLING_SETTINGS_DEFAULTS).rounding_unit };
    };
    const publishedKeys = new Set(data.published.map((p) => p.unitKey));
    const monthsFor = (through: DateOnly | null, prefix: string) => {
      const months = through && !cutoff.onlyPublished ? monthsBetween(start, through) : [];
      for (const key of publishedKeys) if (key.startsWith(prefix)) months.push(unitMonth(key) + '-01');
      return [...new Set(months)].sort();
    };
    const pastLabel = (month: DateOnly, through: DateOnly | null) => (through && month < firstDayOfMonth(through) && month < cutoff.period ? 'Phí kỳ trước chưa lập — ' : '');

    // ---------- Tiền phòng ----------
    const rentVersions = data.rents.map((r) => ({ ...r, effectiveFrom: fromDbDate(r.effectiveFrom) }));
    const rentKey = `RENT:${t.id}`;
    for (const month of monthsFor(cutoff.advanceThrough, `${rentKey}:`)) {
      const unitKey = `${rentKey}:${month.slice(0, 7)}`;
      const ov = overlap(month, start, endEx);
      if (!ov) {
        units.push({ unitKey, expected: 0n, freshLines: [] });
        continue;
      }
      const pieces = slice(ov.start, ov.end, rentVersions.map((v) => v.effectiveFrom), (d) => versionAt(rentVersions, d), (v) => v.id);
      const coveredStart = pieces[0]?.start;
      if (!pieces.length || coveredStart !== ov.start) {
        errors.push({ code: 'NO_RENT_PRICE', message: `Chưa có giá thuê cho ${range(ov.start, ov.end)}.` });
        skipped.add(unitKey);
        continue;
      }
      const policy = policyFor(unitKey, month);
      const r = prorateMonth(month, pieces.map((p) => ({ start: p.start, endExclusive: p.endExclusive, rate: p.value.monthlyRentVnd * SCALE })), policy);
      units.push({
        unitKey,
        expected: r.amount,
        freshLines: pieces.map((p, i) => ({
          group: 'ADVANCE',
          chargeKind: 'RENT',
          chargeTiming: 'ADVANCE',
          direction: 'DEBIT',
          label: `${pastLabel(month, cutoff.advanceThrough)}Tiền phòng ${range(p.start, p.endExclusive)}`,
          quantity: String(daysOf(p.start, p.endExclusive)),
          unitPrice: p.value.monthlyRentVnd.toString(),
          amount: r.shares[i]!,
          chargeStart: p.start,
          chargeEnd: p.endExclusive,
          sourceType: 'RENT_PRICE',
          sourceId: p.value.id,
          sourceKey: rentKey,
          unitKey,
          correctsItemId: null,
          readingStartId: null,
          readingEndId: null,
          policy,
          calc: { month_days: r.monthDays, covered_days: r.coveredDays, divisor: r.divisor, weighted_x1e4: r.weighted.toString(), unit_amount: r.amount.toString() },
        })),
      });
    }

    // ---------- Dịch vụ không đồng hồ ----------
    const servicesById = new Map<string, Service>();
    for (const s of data.subs) servicesById.set(s.serviceId, s.service);
    for (const p of data.published) {
      if (p.chargeKind === 'SERVICE' && p.sourceKey.startsWith(`SVC:${t.id}:`)) {
        const sid = p.sourceKey.split(':')[2]!;
        if (!servicesById.has(sid)) servicesById.set(sid, { id: sid, name: p.labelSnapshot, type: 'FIXED_ROOM', chargeTiming: p.chargeTiming } as Service);
      }
    }
    const members = data.members.map((m) => ({ joinedOn: fromDbDate(m.joinedOn), leftOnExclusive: m.leftOnExclusive ? fromDbDate(m.leftOnExclusive) : null }));
    for (const service of servicesById.values()) {
      const timing = service.chargeTiming;
      const through = timing === 'ADVANCE' ? cutoff.advanceThrough : cutoff.arrearsThrough;
      const sourceKey = `SVC:${t.id}:${service.id}`;
      const subs = data.subs.filter((s) => s.serviceId === service.id).map((s) => ({ ...s, from: fromDbDate(s.effectiveFrom), to: s.endExclusive ? fromDbDate(s.endExclusive) : null }));
      const bPrices = data.prices.filter((p) => p.serviceId === service.id && p.buildingId).map((p) => ({ ...p, effectiveFrom: fromDbDate(p.effectiveFrom) }));
      const gPrices = data.prices.filter((p) => p.serviceId === service.id && !p.buildingId).map((p) => ({ ...p, effectiveFrom: fromDbDate(p.effectiveFrom) }));
      const cuts = [
        ...subs.flatMap((s) => [s.from, ...(s.to ? [s.to] : [])]),
        ...bPrices.map((p) => p.effectiveFrom),
        ...gPrices.map((p) => p.effectiveFrom),
        ...(service.type === 'PER_PERSON' ? members.flatMap((m) => [m.joinedOn, ...(m.leftOnExclusive ? [m.leftOnExclusive] : [])]) : []),
      ];
      for (const month of monthsFor(through, `${sourceKey}:`)) {
        const unitKey = `${sourceKey}:${month.slice(0, 7)}`;
        const ov = overlap(month, start, endEx);
        let missing: DateOnly | null = null;
        const pieces = ov
          ? slice(
              ov.start,
              ov.end,
              cuts,
              (d) => {
                const sub = subs.find((s) => s.from <= d && (!s.to || s.to > d));
                if (!sub) return null;
                const price = versionAt(bPrices, d) ?? versionAt(gPrices, d);
                if (!price) {
                  missing ??= d;
                  return null;
                }
                const persons = service.type === 'PER_PERSON' ? members.filter((m) => m.joinedOn <= d && (!m.leftOnExclusive || m.leftOnExclusive > d)).length : 0;
                if (service.type === 'PER_PERSON' && persons === 0) return null;
                const qty = service.type === 'PER_PERSON' ? BigInt(persons) * 100n : parseFixed2(sub.quantity.toString());
                return { sub, price, persons, qty, rate: parseFixed2(price.unitPrice.toString()) * qty };
              },
              (v) => `${v.sub.id}|${v.price.id}|${v.persons}`,
            )
          : [];
        if (missing) {
          errors.push({ code: 'NO_SERVICE_PRICE', message: `Chưa có giá dịch vụ “${service.name}” (tòa ${t.room.building.code}) từ ${dmy(missing)}.` });
          skipped.add(unitKey);
          continue;
        }
        if (!pieces.length) {
          units.push({ unitKey, expected: 0n, freshLines: [] });
          continue;
        }
        const policy = policyFor(unitKey, month);
        const r = prorateMonth(month, pieces.map((p) => ({ start: p.start, endExclusive: p.endExclusive, rate: p.value.rate })), policy);
        const group: LineGroup = timing === 'ADVANCE' ? 'ADVANCE' : 'ARREARS';
        units.push({
          unitKey,
          expected: r.amount,
          freshLines: pieces.map((p, i) => ({
            group,
            chargeKind: 'SERVICE',
            chargeTiming: timing,
            direction: 'DEBIT',
            label: `${pastLabel(month, through)}${service.name} ${range(p.start, p.endExclusive)} (${formatFixed2(p.value.qty)} ${service.unit})`,
            quantity: formatFixed2(p.value.qty),
            unitPrice: p.value.price.unitPrice.toString(),
            amount: r.shares[i]!,
            chargeStart: p.start,
            chargeEnd: p.endExclusive,
            sourceType: 'TENANCY_SERVICE',
            sourceId: p.value.sub.id,
            sourceKey,
            unitKey,
            correctsItemId: null,
            readingStartId: null,
            readingEndId: null,
            policy,
            calc: { month_days: r.monthDays, covered_days: r.coveredDays, divisor: r.divisor, weighted_x1e4: r.weighted.toString(), unit_amount: r.amount.toString(), service_price_id: p.value.price.id },
          })),
        });
      }
    }

    // ---------- Điện nước theo đồng hồ ----------
    for (const type of ['ELECTRICITY', 'WATER'] as MeterType[]) this.meterUnits(data, cutoff, type, units, errors, skipped, policyFor);

    // ---------- Khoản phí trả phòng ----------
    // Khoản đã phát hành giữ nguyên (không có nguồn dữ liệu nào khác để tính lại); khoản mới lấy từ quyết toán.
    for (const p of data.published) if (p.unitKey.startsWith('CHARGE:')) skipped.add(p.unitKey);
    for (const c of cutoff.extraCharges ?? []) {
      const unitKey = `CHARGE:${c.id}`;
      skipped.delete(unitKey);
      units.push({
        unitKey,
        expected: c.amount,
        freshLines: [
          {
            group: 'ARREARS',
            chargeKind: c.kind,
            chargeTiming: 'ARREARS',
            direction: 'DEBIT',
            label: c.label,
            quantity: '1',
            unitPrice: c.amount.toString(),
            amount: c.amount,
            chargeStart: null,
            chargeEnd: null,
            sourceType: 'SETTLEMENT_ITEM',
            sourceId: c.id,
            sourceKey: `CHARGE:${t.id}`,
            unitKey,
            correctsItemId: null,
            readingStartId: null,
            readingEndId: null,
            policy: policyFor(unitKey, cutoff.period),
            calc: {},
          },
        ],
      });
    }

    const outcomes = reconcile(units, data.published.map(toPublishedLine), (k) => skipped.has(k));
    return { lines: this.toLines(outcomes, data, cutoff), errors };
  }

  private meterUnits(
    data: BillingData,
    cutoff: Cutoff,
    type: MeterType,
    units: UnitExpectation<ComputedLine>[],
    errors: BlockingError[],
    skipped: Set<string>,
    policyFor: (unitKey: string, monthStart: DateOnly) => BillingPolicy,
  ) {
    const t = data.tenancy;
    const sourceKey = `METER:${t.id}:${type}`;
    const service = data.meterServices.find((s) => s.meterType === type);
    const ofType = data.meters.filter((m) => m.type === type);
    if (!ofType.length || !service) return;
    const periodOf = new Map(data.readings.map((r) => [r.id, r.statementPeriod ? fromDbDate(r.statementPeriod.monthStart) : null]));
    const points = sortPoints(tenancyPoints(ofType, data.readings, t));
    const token = (p: MeterPoint) => p.readingId ?? `install-${p.meterId}`;
    const tokenIndex = new Map(points.map((p, i) => [token(p), i]));
    const pointPeriod = (p: MeterPoint) => (p.kind === 'PERIODIC' && p.readingId ? periodOf.get(p.readingId)! : firstDayOfMonth(p.readOn));
    const inScope = (p: MeterPoint) =>
      p.kind === 'INITIAL' ||
      (p.kind === 'PERIODIC' && !!cutoff.meterPeriodThrough && pointPeriod(p) <= cutoff.meterPeriodThrough) ||
      (p.kind === 'FINAL' && cutoff.includeFinalReadings);

    // Thiếu chỉ số chốt kỳ bắt buộc: chặn phát hành, không mặc định usage = 0 (T14).
    const required = cutoff.requireReadingsFor;
    const active = ofType.find((m) => !m.retiredOn);
    if (required && active && fromDbDate(t.startDate) < required && !t.chargeEndExclusive) {
      const has = points.some((p) => p.kind === 'PERIODIC' && p.readingId && periodOf.get(p.readingId) === required);
      if (!has) errors.push({ code: 'MISSING_READING', message: `Thiếu chỉ số ${TYPE_LABEL[type].toLowerCase()} kỳ ${my(required)} của phòng ${t.room.code}.` });
    }

    // Đơn vị đã phát hành: ranh giới chốt ở lần phát hành đầu (D-025).
    const publishedRanges: { key: string; si: number; ei: number }[] = [];
    for (const key of new Set(data.published.filter((p) => p.sourceKey === sourceKey).map((p) => p.unitKey))) {
      const [, , , startTok, endTok] = key.split(':');
      const si = tokenIndex.get(startTok!);
      const ei = tokenIndex.get(endTok!);
      if (si === undefined || ei === undefined) {
        errors.push({ code: 'READING_MISSING_FOR_PUBLISHED', message: `Không tìm thấy chỉ số đã dùng trên thông báo đã phát hành (${TYPE_LABEL[type]}).` });
        skipped.add(key);
        continue;
      }
      publishedRanges.push({ key, si, ei });
    }
    const insidePublished = (i: number) => publishedRanges.some((r) => i > r.si && i < r.ei);
    // Điểm đầu chuỗi (VD điểm lắp đồng hồ gắn giữa kỳ) chỉ là mốc khi lần thuê chưa có chỉ số INITIAL nào.
    const hasInitial = points.some((p) => p.kind === 'INITIAL');
    const boundaries = points
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => (inScope(p) || (i === 0 && !hasInitial)) && !insidePublished(i))
      .map(({ i }) => i);
    const pairs: { si: number; ei: number; key: string; published: boolean }[] = publishedRanges.map((r) => ({ ...r, published: true }));
    if (!cutoff.onlyPublished) {
      for (let k = 1; k < boundaries.length; k++) {
        const si = boundaries[k - 1]!;
        const ei = boundaries[k]!;
        const key = `${sourceKey}:${token(points[si]!)}:${token(points[ei]!)}`;
        if (!pairs.some((p) => p.key === key)) pairs.push({ si, ei, key, published: false });
      }
    }

    const prices = data.prices.filter((p) => p.serviceId === service.id && p.buildingId === t.room.buildingId).map((p) => ({ ...p, effectiveFrom: fromDbDate(p.effectiveFrom) }));
    for (const pair of pairs.sort((a, b) => a.si - b.si)) {
      const a = points[pair.si]!;
      const b = points[pair.ei]!;
      const usage = chainUsage(points, pair.si, pair.ei);
      if (usage === null) {
        errors.push({ code: 'NEGATIVE_USAGE', message: `Tiêu thụ ${TYPE_LABEL[type].toLowerCase()} âm giữa ${dmy(a.readOn)} và ${dmy(b.readOn)}.` });
        skipped.add(pair.key);
        continue;
      }
      const startPeriod = pointPeriod(a);
      const endPeriod = pointPeriod(b);
      // Giá đổi giữa hai lần đọc (kỳ bị bỏ qua): cần chỉ số tại kỳ đổi giá, không chia usage theo ngày (T15).
      const between = prices.find((p) => p.effectiveFrom > startPeriod && p.effectiveFrom < endPeriod);
      if (between) {
        errors.push({
          code: 'PRICE_CHANGED_BETWEEN_READINGS',
          message: `Giá ${TYPE_LABEL[type].toLowerCase()} đổi từ kỳ ${my(between.effectiveFrom)}, nằm giữa hai lần đọc ${dmy(a.readOn)} và ${dmy(b.readOn)}: cần chỉ số chốt kỳ ${my(between.effectiveFrom)}.`,
        });
        skipped.add(pair.key);
        continue;
      }
      const price = versionAt(prices, endPeriod);
      if (!price) {
        errors.push({ code: 'NO_METER_PRICE', message: `Tòa ${t.room.building.code} chưa có giá ${TYPE_LABEL[type].toLowerCase()} cho kỳ ${my(endPeriod)}.` });
        skipped.add(pair.key);
        continue;
      }
      const policy = policyFor(pair.key, endPeriod);
      const amount = meterCharge(usage, parseFixed2(price.unitPrice.toString()), policy.rounding_unit);
      const replaced = points.slice(pair.si, pair.ei + 1).some((p) => p.kind === 'CLOSING');
      units.push({
        unitKey: pair.key,
        expected: amount,
        freshLines: [
          {
            group: 'ARREARS',
            chargeKind: 'METER',
            chargeTiming: 'ARREARS',
            direction: 'DEBIT',
            // Chỉ số chốt kỳ M+1 là điện nước tháng tiêu thụ M (MASTER_PLAN 8.5): ghi rõ tháng, kèm khoảng giữa hai lần đọc thực tế.
            label: `${TYPE_LABEL[type]} ${b.kind === 'PERIODIC' ? `tháng ${my(addMonths(endPeriod, -1))} (${dm(a.readOn)}–${dmy(b.readOn)})` : `${dm(a.readOn)}–${dmy(b.readOn)}`}: ${formatFixed2(a.value)} → ${formatFixed2(b.value)}${replaced ? ' (có thay đồng hồ)' : ''} = ${formatFixed2(usage)} ${METER_UNIT[type]}`,
            quantity: formatFixed2(usage),
            unitPrice: price.unitPrice.toString(),
            amount,
            chargeStart: a.readOn,
            chargeEnd: b.readOn > a.readOn ? b.readOn : null,
            sourceType: 'METER_INTERVAL',
            sourceId: b.readingId ?? null,
            sourceKey,
            unitKey: pair.key,
            correctsItemId: null,
            readingStartId: a.readingId ?? null,
            readingEndId: b.readingId ?? null,
            policy,
            calc: { start_value: formatFixed2(a.value), end_value: formatFixed2(b.value), usage: formatFixed2(usage), price_id: price.id, period: endPeriod },
          },
        ],
      });
    }
  }

  /** Kết quả đối soát → dòng chứng từ. Dòng điều chỉnh: một dòng mỗi u, trỏ dòng phát hành gần nhất. */
  private toLines(outcomes: Outcome<ComputedLine>[], data: BillingData, cutoff: Cutoff): ComputedLine[] {
    const byId = new Map(data.published.map((p) => [p.id, p]));
    const lines: ComputedLine[] = [];
    for (const o of outcomes) {
      if (o.kind === 'FRESH') {
        if (!cutoff.onlyPublished) lines.push(...o.lines);
        continue;
      }
      const ref = byId.get(o.correctsItemId)!;
      lines.push({
        group: 'ADJUSTMENT',
        chargeKind: ref.chargeKind as ComputedLine['chargeKind'],
        chargeTiming: ref.chargeTiming,
        direction: o.direction,
        label: `Điều chỉnh ${adjustSubject(ref)}: đã lập ${money(o.published)}đ, đúng ${money(o.expected)}đ`,
        quantity: '1',
        unitPrice: o.amount.toString(),
        amount: o.amount,
        chargeStart: ref.chargeStart ? fromDbDate(ref.chargeStart) : null,
        chargeEnd: ref.chargeEndExclusive ? fromDbDate(ref.chargeEndExclusive) : null,
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        sourceKey: ref.sourceKey,
        unitKey: o.unitKey,
        correctsItemId: ref.id,
        readingStartId: ref.readingStartId,
        readingEndId: ref.readingEndId,
        policy: ref.policySnapshot as unknown as BillingPolicy,
        calc: { expected: o.expected.toString(), published: o.published.toString(), delta: (o.direction === 'DEBIT' ? o.amount : -o.amount).toString() },
      });
    }
    const groupOrder: Record<LineGroup, number> = { ADVANCE: 0, ARREARS: 1, ADJUSTMENT: 2 };
    return lines.sort(
      (a, b) =>
        groupOrder[a.group] - groupOrder[b.group] ||
        kindOrder(a) - kindOrder(b) ||
        a.sourceKey.localeCompare(b.sourceKey) ||
        (a.chargeStart ?? '').localeCompare(b.chargeStart ?? ''),
    );
  }
}

// ------------------------------------------------------------------ Hỗ trợ

function daysOf(start: DateOnly, endExclusive: DateOnly): number {
  return Math.round((Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

const order = (p: PublishedItem) => (p.invoice.publishedAt?.getTime() ?? 0) * 1000 + p.sortOrder;

const toPublishedLine = (p: PublishedItem): PublishedLine => ({ id: p.id, unitKey: p.unitKey, direction: p.direction, amount: p.amountVnd, order: order(p) });

const kindOrder = (l: ComputedLine) => ({ RENT: 0, SERVICE: 1, METER: 2, DAMAGE: 3, OTHER: 4 })[l.chargeKind];

function adjustSubject(ref: PublishedItem): string {
  if (ref.chargeKind === 'RENT') return `tiền phòng tháng ${my(unitMonth(ref.unitKey) + '-01')}`;
  if (ref.chargeKind === 'METER') return ref.labelSnapshot.split(':')[0]!.toLowerCase();
  return `${ref.labelSnapshot.replace(/^Phí kỳ trước chưa lập — /, '').split(' ')[0]} tháng ${my(unitMonth(ref.unitKey) + '-01')}`;
}

/** Băm dòng tính được + lỗi: dữ liệu nguồn đổi thì băm đổi (chặn phát hành nháp cũ — MASTER_PLAN 8.7). */
export function sourceHash(result: ComputeResult): string {
  const payload = result.lines.map((l) => [l.unitKey, l.direction, l.amount.toString(), l.label, l.quantity, l.unitPrice, l.chargeStart, l.chargeEnd, l.correctsItemId]);
  return createHash('sha256')
    .update(JSON.stringify([payload, result.errors.map((e) => e.code + e.message)]))
    .digest('hex')
    .slice(0, 32);
}

export function toItemData(l: ComputedLine, invoiceId: string, sortOrder: number): Prisma.InvoiceItemCreateManyInput {
  return {
    invoiceId,
    chargeKind: l.chargeKind,
    chargeTiming: l.chargeTiming,
    direction: l.direction,
    labelSnapshot: l.label,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amountVnd: l.amount,
    chargeStart: l.chargeStart ? new Date(`${l.chargeStart}T00:00:00Z`) : null,
    chargeEndExclusive: l.chargeEnd ? new Date(`${l.chargeEnd}T00:00:00Z`) : null,
    sourceType: l.sourceType,
    sourceId: l.sourceId,
    sourceKey: l.sourceKey,
    unitKey: l.unitKey,
    correctsItemId: l.correctsItemId,
    readingStartId: l.readingStartId,
    readingEndId: l.readingEndId,
    policySnapshot: l.policy as unknown as Prisma.InputJsonValue,
    calculationSnapshot: { ...l.calc, group: l.group } as Prisma.InputJsonValue,
    sortOrder,
  };
}
