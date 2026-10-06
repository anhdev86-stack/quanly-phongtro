import { Inject, Injectable } from '@nestjs/common';
import type { moveInSchema, Paged, TenancyDetail, tenancyListQuerySchema, TenancySummary } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode, violatedConstraint } from '../../common/db/pg-errors.js';
import { nextSequence, yymm } from '../../common/db/sequences.js';
import { day, dayOrNull, decimal } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { addDays, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma, Tenancy } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { LedgersService } from '../ledgers/ledgers.service.js';
import { OPEN_TENANCY_STATUSES, RoomsService } from '../rooms/rooms.service.js';
import { TenantsService } from '../tenants/tenants.service.js';

type MoveInInput = z.output<typeof moveInSchema>;
type PersonRef = MoveInInput['primary'];

/** Hook cho Phase 3 (hợp đồng) và Phase 5 (thông báo đầu tiên) gắn vào luồng nhận phòng. */
export interface MoveInExtension {
  afterMoveIn(tx: Prisma.TransactionClient, user: AuthUser, tenancy: Tenancy, input: MoveInInput): Promise<void>;
}
export const MOVE_IN_EXTENSIONS = Symbol('MOVE_IN_EXTENSIONS');

/** Thông tin hợp đồng cho danh sách/chi tiết (Phase 3 cung cấp). */
export interface RentalModeProvider {
  rentalModes(db: Db, tenancyIds: string[], onDate: string): Promise<Map<string, 'FIXED_TERM' | 'MONTH_TO_MONTH'>>;
}
export const RENTAL_MODE = Symbol('RENTAL_MODE');

const detailInclude = {
  room: { include: { building: true } },
  members: { include: { tenant: true }, orderBy: [{ role: 'asc' }, { joinedOn: 'asc' }] },
  rentPrices: { orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }] },
  services: { include: { service: true }, orderBy: [{ effectiveFrom: 'asc' }] },
  readings: { where: { kind: 'INITIAL' }, include: { meter: true } },
} satisfies Prisma.TenancyInclude;

type TenancyFull = Prisma.TenancyGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class TenanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly tenants: TenantsService,
    private readonly ledgers: LedgersService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MOVE_IN_EXTENSIONS) private readonly extensions: MoveInExtension[],
    @Inject(RENTAL_MODE) private readonly rentalMode: RentalModeProvider,
  ) {}

  tenancyWhere(user: AuthUser): Prisma.TenancyWhereInput {
    return { workspaceId: user.workspaceId, room: this.rooms.roomWhere(user) };
  }

  async getRow(db: Db, user: AuthUser, id: string): Promise<TenancyFull> {
    const row = await db.tenancy.findFirst({ where: { id, ...this.tenancyWhere(user) }, include: detailInclude });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  async list(user: AuthUser, q: z.output<typeof tenancyListQuerySchema>): Promise<Paged<TenancySummary>> {
    const needle = q.q?.trim();
    const where: Prisma.TenancyWhereInput = {
      AND: [
        this.tenancyWhere(user),
        q.status === 'OPEN' ? { status: { in: [...OPEN_TENANCY_STATUSES] } } : q.status ? { status: q.status } : {},
        q.building_id ? { room: { buildingId: q.building_id } } : {},
        q.room_id ? { roomId: q.room_id } : {},
        q.tenant_id ? { members: { some: { tenantId: q.tenant_id } } } : {},
        needle
          ? {
              OR: [
                { code: { contains: needle, mode: 'insensitive' } },
                { room: { code: { contains: needle, mode: 'insensitive' } } },
                { members: { some: { tenant: { fullName: { contains: needle, mode: 'insensitive' } } } } },
              ],
            }
          : {},
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.tenancy.count({ where }),
      this.prisma.tenancy.findMany({
        where,
        include: detailInclude,
        orderBy: [{ startDate: 'desc' }],
        skip: (q.page - 1) * q.page_size,
        take: q.page_size,
      }),
    ]);
    return { items: await this.toSummaries(this.prisma, rows), total, page: q.page, page_size: q.page_size };
  }

  async get(user: AuthUser, id: string): Promise<TenancyDetail> {
    const row = await this.getRow(this.prisma, user, id);
    const [summary] = await this.toSummaries(this.prisma, [row]);
    const { summary: deposit } = await this.ledgers.depositSummary(this.prisma, id);
    return {
      ...summary!,
      billing_due_day: row.billingDueDay,
      notice_days: row.noticeDaysSnapshot,
      note: row.note,
      actual_move_out_date: dayOrNull(row.actualMoveOutDate),
      reservation_id: row.reservationId,
      members: row.members.map((m) => ({
        id: m.id,
        tenant_id: m.tenantId,
        full_name: m.tenant.fullName,
        phone: m.tenant.phone,
        role: m.role,
        joined_on: day(m.joinedOn),
        left_on: m.leftOnExclusive ? addDays(fromDbDate(m.leftOnExclusive), -1) : null,
        residence_status: m.residenceStatus,
        residence_registered_on: dayOrNull(m.residenceRegisteredOn),
        residence_note: m.residenceNote,
        version: m.version,
      })),
      rent_prices: row.rentPrices.map((p) => ({
        id: p.id,
        effective_from: day(p.effectiveFrom),
        monthly_rent_vnd: p.monthlyRentVnd.toString(),
        source_contract_id: p.sourceContractId,
        reason: p.reason,
        status: p.status,
        void_reason: p.voidReason,
      })),
      services: row.services.map((s) => ({
        id: s.id,
        service_id: s.serviceId,
        service_name: s.service.name,
        service_type: s.service.type,
        unit: s.service.unit,
        effective_from: day(s.effectiveFrom),
        end_exclusive: dayOrNull(s.endExclusive),
        quantity: decimal(s.quantity) ?? '0',
        status: s.status,
      })),
      deposit,
      initial_readings: row.readings.map((r) => ({ type: r.meter.type, value: decimal(r.value) ?? '0', read_on: day(r.readOn) })),
    };
  }

  // ------------------------------------------------------------------ Nhận phòng (MASTER_PLAN 7.2)

  async moveIn(user: AuthUser, input: MoveInInput, key: string | undefined) {
    try {
      return await this.idempotency.execute(
      { user, route: 'POST /tenancies/move-in', key, payload: input, successStatus: 201 },
      async (tx) => {
        const tenancy = await this.moveInTx(tx, user, input);
          return { body: { id: tenancy.id, code: tenancy.code }, resultReference: tenancy.id };
        },
      );
    } catch (error) {
      throw TenanciesService.mapMoveInError(error);
    }
  }

  private async moveInTx(tx: Prisma.TransactionClient, user: AuthUser, input: MoveInInput): Promise<Tenancy> {
    // 1. Khóa phòng, kiểm tra điều kiện nhận phòng.
    await lockRows(tx, 'rooms', [input.room_id]);
    const room = await this.rooms.getRow(tx, user, input.room_id);
    if (room.archivedAt || room.building.archivedAt) throw new AppError('BUSINESS_RULE_VIOLATION', 'Phòng hoặc tòa đã lưu trữ.');
    if (room.operationalStatus === 'MAINTENANCE') {
      throw new AppError('BUSINESS_RULE_VIOLATION', 'Phòng đang bảo trì, chưa nhận khách được. Hãy chuyển phòng sang “Sẵn sàng cho thuê” trước.');
    }
    const open = await tx.tenancy.findFirst({ where: { roomId: room.id, status: { in: [...OPEN_TENANCY_STATUSES] } } });
    if (open) throw new AppError('CONFLICT', 'Phòng đang có khách thuê (kể cả đang báo trả hoặc đang trả phòng).');
    const previous = await tx.tenancy.findFirst({ where: { roomId: room.id, status: 'ENDED' }, orderBy: { chargeEndExclusive: 'desc' } });
    if (previous?.chargeEndExclusive && fromDbDate(previous.chargeEndExclusive) > input.start_date) {
      const earliest = fromDbDate(previous.chargeEndExclusive);
      throw new AppError(
        'BUSINESS_RULE_VIOLATION',
        `Phòng còn tính tiền cho khách trước đến hết ngày ${addDays(earliest, -1)}. Khách mới nhận sớm nhất ngày ${earliest}.`,
        { start_date: ['Ngày nhận trùng thời gian tính tiền của khách trước.'] },
      );
    }

    // 2. Sức chứa.
    const headcount = 1 + input.members.length;
    if (headcount > room.maxOccupants) {
      throw new AppError('BUSINESS_RULE_VIOLATION', `Phòng tối đa ${room.maxOccupants} người, đang nhập ${headcount} người.`, {
        members: ['Vượt sức chứa của phòng.'],
      });
    }

    // 3. Giữ phòng: ngày nhận không được nằm trong lịch giữ của khách khác.
    const startDb = toDbDate(input.start_date);
    const blocking = await tx.reservation.findFirst({
      where: {
        roomId: room.id,
        status: 'ACTIVE',
        holdFrom: { lte: startDb },
        holdUntil: { gte: startDb },
        ...(input.reservation_id ? { id: { not: input.reservation_id } } : {}),
      },
    });
    if (blocking) {
      throw new AppError('BUSINESS_RULE_VIOLATION', `Ngày nhận nằm trong lịch giữ phòng của ${blocking.contactName}. Hãy nhận phòng từ lượt giữ đó hoặc hủy nó trước.`);
    }
    let reservationId: string | null = null;
    if (input.reservation_id) {
      const r = await tx.reservation.findFirst({ where: { id: input.reservation_id, roomId: room.id } });
      if (!r || r.status !== 'ACTIVE') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lượt giữ phòng không còn hiệu lực hoặc không thuộc phòng này.');
      reservationId = r.id;
    }

    // 4. Tạo lần thuê.
    const seq = await nextSequence(tx, user.workspaceId, 'TENANCY', yymm(this.clock.today()));
    const tenancy = await tx.tenancy.create({
      data: {
        workspaceId: user.workspaceId,
        roomId: room.id,
        code: `LT${yymm(this.clock.today())}-${String(seq).padStart(4, '0')}`,
        startDate: startDb,
        billingDueDay: input.billing_due_day,
        initialDepositRequiredVnd: BigInt(input.deposit_required_vnd),
        noticeDaysSnapshot: input.contract?.notice_days ?? 30,
        reservationId,
        note: input.note,
        createdBy: user.id,
      },
    });

    // 5. Thành viên: đúng một PRIMARY.
    const people: { ref: PersonRef; role: 'PRIMARY' | 'MEMBER' }[] = [
      { ref: input.primary, role: 'PRIMARY' },
      ...input.members.map((ref) => ({ ref, role: 'MEMBER' as const })),
    ];
    for (const p of people) {
      const tenantId = await this.resolvePerson(tx, user, p.ref);
      await tx.tenancyTenant.create({
        data: { workspaceId: user.workspaceId, tenancyId: tenancy.id, tenantId, role: p.role, joinedOn: startDb },
      });
    }

    // 6. Giá thuê và dịch vụ, hiệu lực từ ngày nhận.
    await tx.rentPriceHistory.create({
      data: { tenancyId: tenancy.id, effectiveFrom: startDb, monthlyRentVnd: BigInt(input.monthly_rent_vnd), reason: 'Giá khi nhận phòng', createdBy: user.id },
    });
    if (input.services.length) {
      const services = await tx.service.findMany({ where: { id: { in: input.services.map((s) => s.service_id) }, workspaceId: user.workspaceId, archivedAt: null } });
      if (services.length !== input.services.length) throw new AppError('BUSINESS_RULE_VIOLATION', 'Có dịch vụ không tồn tại hoặc đã ngừng.', { services: ['Dịch vụ không hợp lệ.'] });
      if (services.some((s) => s.type === 'METER')) {
        throw new AppError('BUSINESS_RULE_VIOLATION', 'Điện/nước theo đồng hồ được tính từ chỉ số, không thêm như dịch vụ.', { services: ['Dịch vụ không hợp lệ.'] });
      }
      for (const s of input.services) {
        await tx.tenancyService.create({
          data: { tenancyId: tenancy.id, serviceId: s.service_id, effectiveFrom: startDb, quantity: s.quantity, createdBy: user.id },
        });
      }
    }

    // 7. Chỉ số ban đầu: đồng hồ chưa có thì tạo mới với chỉ số này (nhập một lần, v2.4).
    for (const m of input.meter_readings) {
      let meter = await tx.meter.findFirst({ where: { roomId: room.id, type: m.type, retiredOn: null } });
      if (!meter) {
        meter = await tx.meter.create({
          data: { workspaceId: user.workspaceId, roomId: room.id, type: m.type, installedOn: startDb, initialReading: m.value, createdBy: user.id },
        });
      } else {
        const last = await tx.meterReading.findFirst({ where: { meterId: meter.id, readOn: { lte: startDb } }, orderBy: { readOn: 'desc' } });
        const lastValue = last ? Number(last.value) : Number(meter.initialReading);
        if (Number(m.value) < lastValue) {
          throw new AppError('BUSINESS_RULE_VIOLATION', `Chỉ số ${m.type === 'ELECTRICITY' ? 'điện' : 'nước'} ban đầu nhỏ hơn chỉ số gần nhất (${lastValue}).`, {
            meter_readings: ['Chỉ số không được nhỏ hơn lần đọc trước.'],
          });
        }
        if (last && fromDbDate(last.readOn) === input.start_date) {
          throw new AppError('CONFLICT', 'Đồng hồ đã có chỉ số trong ngày nhận phòng.', { meter_readings: ['Trùng ngày đọc.'] });
        }
      }
      await tx.meterReading.create({
        data: { meterId: meter.id, tenancyId: tenancy.id, readOn: startDb, value: m.value, kind: 'INITIAL', createdBy: user.id },
      });
    }

    // 8. Giữ chỗ → cọc (cặp liên kết), rồi cọc thực nhận.
    if (reservationId) {
      await tx.reservation.update({ where: { id: reservationId }, data: { status: 'CONVERTED', convertedTenancyId: tenancy.id, version: { increment: 1 } } });
      await this.ledgers.convertHoldingToDeposit(tx, user, reservationId, tenancy.id, input.start_date);
    }
    if (input.deposit_received) {
      await tx.depositTransaction.create({
        data: {
          workspaceId: user.workspaceId,
          tenancyId: tenancy.id,
          type: 'RECEIVED',
          amountVnd: BigInt(input.deposit_received.amount_vnd),
          paidAt: toDbDate(input.deposit_received.paid_at),
          method: input.deposit_received.method,
          reference: input.deposit_received.reference,
          reason: 'Nhận cọc khi nhận phòng',
          createdBy: user.id,
        },
      });
    }

    // 9. Hợp đồng (Phase 3), thông báo đầu tiên (Phase 5).
    for (const ext of this.extensions) await ext.afterMoveIn(tx, user, tenancy, input);

    await this.audit.record(tx, {
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: 'tenancy.move_in',
      entityType: 'tenancy',
      entityId: tenancy.id,
      after: { ...input, code: tenancy.code },
    });
    return tenancy;
  }

  private async resolvePerson(tx: Prisma.TransactionClient, user: AuthUser, ref: PersonRef): Promise<string> {
    if ('tenant_id' in ref) {
      const t = await tx.tenant.findFirst({ where: { id: ref.tenant_id, workspaceId: user.workspaceId, archivedAt: null } });
      if (!t) throw new AppError('BUSINESS_RULE_VIOLATION', 'Người thuê không tồn tại.', { primary: ['Người thuê không hợp lệ.'] });
      return t.id;
    }
    return (await this.tenants.createInTx(tx, user, ref.new_tenant)).id;
  }

  /** Lỗi ràng buộc database trong luồng nhận phòng → thông báo rõ ràng. */
  static mapMoveInError(error: unknown): unknown {
    const code = pgErrorCode(error);
    if (code === PG.UNIQUE_VIOLATION && violatedConstraint(error) === 'one_open_tenancy_per_room') {
      return new AppError('CONFLICT', 'Phòng vừa được nhận bởi một thao tác khác.');
    }
    if (code === PG.EXCLUSION_VIOLATION && violatedConstraint(error) === 'no_overlapping_membership') {
      return new AppError('BUSINESS_RULE_VIOLATION', 'Một người bị thêm hai lần vào cùng lần thuê.');
    }
    return error;
  }

  // ------------------------------------------------------------------ DTO

  async toSummaries(db: Db, rows: TenancyFull[]): Promise<TenancySummary[]> {
    if (rows.length === 0) return [];
    const today = this.clock.today();
    const ids = rows.map((r) => r.id);
    // Tuần tự: db có thể là transaction client (một connection, không chạy song song).
    const held = await this.ledgers.depositHeldMany(db, ids);
    const modes = await this.rentalMode.rentalModes(db, ids, today);
    return rows.map((t) => {
      const current = t.members.filter((m) => !m.leftOnExclusive || fromDbDate(m.leftOnExclusive) > today);
      const primary = current.find((m) => m.role === 'PRIMARY') ?? t.members.find((m) => m.role === 'PRIMARY');
      return {
        id: t.id,
        code: t.code,
        room_id: t.roomId,
        room_code: t.room.code,
        building_code: t.room.building.code,
        status: t.status,
        start_date: day(t.startDate),
        last_charge_date: t.chargeEndExclusive ? addDays(fromDbDate(t.chargeEndExclusive), -1) : null,
        primary_tenant_name: primary?.tenant.fullName ?? null,
        member_count: t.status === 'ENDED' ? 0 : current.length,
        current_rent_vnd: currentRent(t.rentPrices, today)?.toString() ?? null,
        deposit_held_vnd: (held.get(t.id) ?? 0n).toString(),
        rental_mode: modes.get(t.id) ?? 'MONTH_TO_MONTH',
        version: t.version,
      };
    });
  }
}

/** Giá thuê ACTIVE có hiệu lực tại ngày (nếu chưa tới ngày bắt đầu thì lấy giá đầu tiên). */
export function currentRent(prices: { effectiveFrom: Date; monthlyRentVnd: bigint; status: string }[], onDate: string): bigint | null {
  const active = prices.filter((p) => p.status === 'ACTIVE').sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  if (active.length === 0) return null;
  const applicable = active.filter((p) => fromDbDate(p.effectiveFrom) <= onDate);
  return (applicable.at(-1) ?? active[0]!).monthlyRentVnd;
}

