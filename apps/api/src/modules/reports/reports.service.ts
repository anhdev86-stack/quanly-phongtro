import { Inject, Injectable } from '@nestjs/common';
import {
  type CollectionsReport,
  type collectionsQuerySchema,
  type Dashboard,
  type dashboardQuerySchema,
  type depositReportRowSchema,
  type depositsReportQuerySchema,
  PERMISSIONS,
  type revenueQuerySchema,
  type RevenueReport,
  type RevenueRow,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { day, naturalCompare } from '../../common/dto/mappers.js';
import { addDays, addMonths, firstDayOfMonth, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { LedgersService } from '../ledgers/ledgers.service.js';
import { InvoiceBalances } from '../payments/balances.js';
import { DebtsService } from '../payments/debts.service.js';
import { OPEN_TENANCY_STATUSES, RoomsService } from '../rooms/rooms.service.js';
import { RENTAL_MODE, type RentalModeProvider } from '../tenancies/tenancies.service.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { userNames } from '../utilities/user-names.js';

/** Hook cho Phase 8B: số tin nhắc đóng tiền lỗi cần xử lý. */
export interface DashboardTodoExtension {
  failedReminders(user: AuthUser, buildingId?: string): Promise<number>;
}
export const DASHBOARD_TODO = Symbol('DASHBOARD_TODO');

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const periodOf = (monthStart: string) => monthStart.slice(0, 7);

/**
 * Dashboard và báo cáo MVP (MASTER_PLAN 12, 13). Mọi số tiền đi qua InvoiceBalances/DebtsService/LedgersService —
 * cùng một cách tính với chi tiết thông báo, công nợ và sổ cọc. Phạm vi theo tòa áp cho cả dashboard và CSV (T34).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly contracts: ContractsService,
    private readonly ledgers: LedgersService,
    private readonly balances: InvoiceBalances,
    private readonly debts: DebtsService,
    private readonly maintenance: MaintenanceService,
    @Inject(RENTAL_MODE) private readonly rentalMode: RentalModeProvider,
    @Inject(DASHBOARD_TODO) private readonly todoExt: DashboardTodoExtension,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private roomScope(user: AuthUser, buildingId?: string): Prisma.RoomWhereInput {
    return { ...this.rooms.roomWhere(user), ...(buildingId ? { buildingId } : {}) };
  }

  // ------------------------------------------------------------------ Dashboard

  async dashboard(user: AuthUser, q: z.output<typeof dashboardQuerySchema>): Promise<Dashboard> {
    const today = this.clock.today();
    const period = q.period ?? today.slice(0, 7);
    const monthStart = `${period}-01`;
    const scope = this.roomScope(user, q.building_id);

    // Phòng theo trạng thái hiển thị (loại trừ lẫn nhau), trên tổng phòng chưa lưu trữ.
    // Giữ điều kiện tòa trong phạm vi khi thêm điều kiện tòa chưa lưu trữ (không ghi đè `building`).
    const roomRows = await this.prisma.room.findMany({
      where: { AND: [scope, { archivedAt: null, building: { archivedAt: null } }] },
      include: { building: true },
    });
    const roomDtos = await this.rooms.toDtos(this.prisma, roomRows);
    const count = (s: string) => roomDtos.filter((r) => r.display_status === s).length;
    const total = roomDtos.length;

    const open = await this.prisma.tenancy.findMany({ where: { status: { in: [...OPEN_TENANCY_STATUSES] }, room: scope } });
    const modes = await this.rentalMode.rentalModes(this.prisma, open.map((t) => t.id), today);
    const expiring = await this.contracts.list(user, { expiring_within_days: 30, building_id: q.building_id, page: 1, page_size: 100 });

    const todo: Dashboard['todo'] = [];
    const push = (kind: Dashboard['todo'][number]['kind'], n: number, label: string, href: string, amount: bigint | null = null) => {
      if (n > 0) todo.push({ kind, count: n, amount_vnd: amount === null ? null : amount.toString(), label, href });
    };

    // Thiếu chỉ số chốt kỳ: đồng hồ đang dùng của phòng có khách từ trước kỳ mà chưa có chỉ số kỳ này.
    const periodRow = await this.prisma.statementPeriod.findUnique({ where: { workspaceId_monthStart: { workspaceId: user.workspaceId, monthStart: toDbDate(monthStart) } } });
    const needing = open.filter((t) => fromDbDate(t.startDate) < monthStart);
    const meters = await this.prisma.meter.findMany({ where: { roomId: { in: needing.map((t) => t.roomId) }, retiredOn: null } });
    const readings = periodRow ? await this.prisma.meterReading.findMany({ where: { meterId: { in: meters.map((m) => m.id) }, statementPeriodId: periodRow.id, kind: 'PERIODIC' } }) : [];
    // Đếm theo phòng: phòng chưa có đồng hồ (cần thiết lập chỉ số nền) hoặc còn đồng hồ chưa chốt. Kỳ M = điện nước tháng tiêu thụ M−1.
    const read = new Set(readings.map((r) => r.meterId));
    const roomsPending = needing.filter((t) => {
      const own = meters.filter((m) => m.roomId === t.roomId);
      return own.length === 0 || own.some((m) => !read.has(m.id));
    }).length;
    const consumption = addMonths(monthStart, -1).slice(0, 7);
    push(
      'MISSING_READINGS',
      roomsPending,
      `Phòng chưa chốt chỉ số điện nước tháng ${consumption.slice(5)}/${consumption.slice(0, 4)}`,
      `/readings?month=${consumption}${q.building_id ? `&building_id=${q.building_id}` : ''}`,
    );

    const tenancyScope = { workspaceId: user.workspaceId, tenancy: { room: scope } };
    const drafts = await this.prisma.invoice.count({ where: { ...tenancyScope, lifecycle: 'DRAFT' } });
    push('DRAFT_INVOICES', drafts, 'Thông báo nháp chưa phát hành', '/invoices?lifecycle=DRAFT');

    let money: Dashboard['money'] = null;
    if (user.permissions.has(PERMISSIONS.INVOICES_VIEW)) {
      const tenancies = await this.prisma.tenancy.findMany({ where: { room: scope, invoices: { some: { lifecycle: 'PUBLISHED' } } }, select: { id: true, status: true } });
      const pos = await this.debts.positions(this.prisma, tenancies.map((t) => t.id));
      const debt = sum([...pos.values()].map((p) => p.debt));
      const overdue = sum([...pos.values()].map((p) => p.overdue));
      const credit = sum([...pos.values()].map((p) => p.credit));
      const overdueInvoices = await this.overdueCount(user, scope);
      push('OVERDUE_INVOICES', overdueInvoices, 'Thông báo quá hạn còn nợ', '/invoices?payment_status=OVERDUE', overdue);

      const allTenancies = await this.prisma.tenancy.findMany({ where: { room: scope }, select: { id: true, status: true } });
      const held = await this.ledgers.depositHeldMany(this.prisma, allTenancies.map((t) => t.id));
      const heldOpen = sum(allTenancies.filter((t) => t.status !== 'ENDED').map((t) => held.get(t.id) ?? 0n));
      const heldEnded = sum(allTenancies.filter((t) => t.status === 'ENDED').map((t) => held.get(t.id) ?? 0n));
      const holding = await this.holdingUnresolved(user, scope);
      push('HOLDING_UNRESOLVED', holding.count, 'Tiền giữ chỗ của lượt giữ đã hủy/hết hạn chưa xử lý', '/reservations', holding.amount);

      const ended = tenancies.filter((t) => t.status === 'ENDED');
      const endedPos = ended.map((t) => pos.get(t.id)!);
      const refundCount = allTenancies.filter((t) => t.status === 'ENDED' && (held.get(t.id) ?? 0n) > 0n).length + endedPos.filter((p) => p.credit > 0n).length;
      push('REFUNDS_PAYABLE', refundCount, 'Khoản phải hoàn cho khách đã trả phòng (cọc, tiền dư)', '/move-outs?financial_status=REFUND_PAYABLE', heldEnded + sum(endedPos.map((p) => p.credit)));
      const receivableEnded = endedPos.filter((p) => p.debt > 0n);
      push('RECEIVABLE_AFTER_MOVE_OUT', receivableEnded.length, 'Khách đã trả phòng còn nợ', '/move-outs?financial_status=RECEIVABLE', sum(receivableEnded.map((p) => p.debt)));

      const collected = await this.prisma.payment.aggregate({
        where: { ...tenancyScope, status: 'POSTED', paidAt: { gte: toDbDate(monthStart), lt: toDbDate(addMonths(monthStart, 1)) } },
        _sum: { amountVnd: true },
      });
      const rev = await this.revenue(user, { from: period, to: period, building_id: q.building_id });
      money = {
        debt_vnd: debt.toString(),
        overdue_vnd: overdue.toString(),
        deposit_held_vnd: heldOpen.toString(),
        deposit_refund_payable_vnd: heldEnded.toString(),
        credit_refund_payable_vnd: credit.toString(),
        holding_unresolved_vnd: holding.amount.toString(),
        collected_in_period_vnd: (collected._sum.amountVnd ?? 0n).toString(),
        invoiced_in_period_vnd: rev.totals.invoiced_vnd,
      };
    }

    push('CONTRACTS_EXPIRING', expiring.total, 'Hợp đồng hết hạn trong 30 ngày tới', '/contracts?expiring_within_days=30');
    const unregistered = await this.prisma.tenancyTenant.count({
      where: { tenancy: { status: { in: [...OPEN_TENANCY_STATUSES] }, room: scope }, leftOnExclusive: null, residenceStatus: 'NOT_REGISTERED' },
    });
    push('RESIDENCE_UNREGISTERED', unregistered, 'Người ở chưa đăng ký tạm trú', '/tenancies');
    push('REMINDERS_FAILED', await this.todoExt.failedReminders(user, q.building_id), 'Tin nhắc đóng tiền gửi lỗi', '/reminders?status=FAILED');
    if (user.permissions.has(PERMISSIONS.MAINTENANCE_VIEW)) {
      push('MAINTENANCE_OPEN', await this.maintenance.openCount(user, q.building_id), 'Yêu cầu bảo trì đang mở', '/maintenance');
    }

    return {
      period,
      rooms: {
        total,
        AVAILABLE: count('AVAILABLE'),
        OCCUPIED: count('OCCUPIED'),
        RESERVED: count('RESERVED'),
        MAINTENANCE: count('MAINTENANCE'),
        occupancy_rate: total ? Math.round((count('OCCUPIED') / total) * 1000) / 10 : 0,
      },
      secondary: {
        notice_given: open.filter((t) => t.status === 'NOTICE_GIVEN').length,
        month_to_month: [...modes.values()].filter((m) => m === 'MONTH_TO_MONTH').length,
        contracts_expiring_30: expiring.total,
      },
      money,
      todo,
    };
  }

  private async overdueCount(user: AuthUser, scope: Prisma.RoomWhereInput) {
    const today = this.clock.today();
    const invs = await this.prisma.invoice.findMany({
      where: { workspaceId: user.workspaceId, tenancy: { room: scope }, lifecycle: 'PUBLISHED', type: { not: 'CREDIT_ADJUSTMENT' }, dueDate: { lt: toDbDate(today) } },
    });
    const rem = await this.balances.remaining(this.prisma, invs);
    return invs.filter((i) => (rem.get(i.id) ?? 0n) > 0n).length;
  }

  /** Lượt giữ đã hủy hoặc đã hết hạn mà vẫn còn tiền giữ chỗ (không tự mất — phải hoàn hoặc giữ lại có lý do). */
  private async holdingUnresolved(user: AuthUser, scope: Prisma.RoomWhereInput) {
    const today = this.clock.today();
    const rs = await this.prisma.reservation.findMany({
      where: { workspaceId: user.workspaceId, room: scope, OR: [{ status: 'CANCELLED' }, { status: 'ACTIVE', holdUntil: { lt: toDbDate(today) } }] },
      select: { id: true },
    });
    const bal = await this.ledgers.holdingBalances(this.prisma, rs.map((r) => r.id));
    const positive = [...bal.values()].filter((v) => v > 0n);
    return { count: positive.length, amount: sum(positive) };
  }

  // ------------------------------------------------------------------ Doanh thu theo tháng (13)

  async revenue(user: AuthUser, q: z.output<typeof revenueQuerySchema>): Promise<RevenueReport> {
    const today = this.clock.today();
    const to = q.to ?? today.slice(0, 7);
    const from = q.from ?? addMonths(`${to}-01`, -11).slice(0, 7);
    const months: string[] = [];
    for (let m = `${from}-01`; m <= `${to}-01`; m = addMonths(m, 1)) months.push(periodOf(m));
    const scope = this.roomScope(user, q.building_id);
    const invs = await this.prisma.invoice.findMany({
      where: { workspaceId: user.workspaceId, lifecycle: 'PUBLISHED', tenancy: { room: scope } },
      include: { statementPeriod: { select: { monthStart: true } } },
    });
    // Tháng của thông báo = tháng phát hành; FINAL/ADJUSTMENT (không có kỳ) theo tháng của ngày lập.
    const monthOf = (i: (typeof invs)[number]) => periodOf(i.statementPeriod ? fromDbDate(i.statementPeriod.monthStart) : firstDayOfMonth(day(i.issueDate)));
    const inRange = invs.filter((i) => months.includes(monthOf(i)));
    const parts = await this.balances.breakdown(this.prisma, inRange.map((i) => i.id));
    const payments = await this.prisma.payment.findMany({
      where: { workspaceId: user.workspaceId, status: 'POSTED', tenancy: { room: scope }, paidAt: { gte: toDbDate(`${from}-01`), lt: toDbDate(addMonths(`${to}-01`, 1)) } },
      select: { paidAt: true, amountVnd: true },
    });
    const rows: RevenueRow[] = months.map((m) => {
      const list = inRange.filter((i) => monthOf(i) === m);
      const debts = list.filter((i) => i.type !== 'CREDIT_ADJUSTMENT');
      const credits = list.filter((i) => i.type === 'CREDIT_ADJUSTMENT');
      const invoiced = sum(debts.map((i) => i.totalVnd));
      const reductions = sum(credits.map((i) => i.totalVnd));
      const cash = sum(debts.map((i) => parts.get(i.id)?.cash ?? 0n));
      const deposit = sum(debts.map((i) => parts.get(i.id)?.deposit ?? 0n));
      const credit = sum(debts.map((i) => parts.get(i.id)?.credit ?? 0n));
      const paid = cash + deposit + credit;
      const cashIn = sum(payments.filter((p) => day(p.paidAt).slice(0, 7) === m).map((p) => p.amountVnd));
      return {
        period: m,
        invoiced_vnd: invoiced.toString(),
        reductions_vnd: reductions.toString(),
        net_vnd: (invoiced - reductions).toString(),
        paid_cash_vnd: cash.toString(),
        paid_deposit_vnd: deposit.toString(),
        paid_credit_vnd: credit.toString(),
        paid_total_vnd: paid.toString(),
        // Phát sinh = Đã thu + Còn nợ (đối chiếu bắt buộc — T65).
        outstanding_vnd: (invoiced - paid).toString(),
        cash_in_period_vnd: cashIn.toString(),
      };
    });
    const total = (k: keyof Omit<RevenueRow, 'period'>) => sum(rows.map((r) => BigInt(r[k]))).toString();
    return {
      rows,
      totals: {
        invoiced_vnd: total('invoiced_vnd'),
        reductions_vnd: total('reductions_vnd'),
        net_vnd: total('net_vnd'),
        paid_cash_vnd: total('paid_cash_vnd'),
        paid_deposit_vnd: total('paid_deposit_vnd'),
        paid_credit_vnd: total('paid_credit_vnd'),
        paid_total_vnd: total('paid_total_vnd'),
        outstanding_vnd: total('outstanding_vnd'),
        cash_in_period_vnd: total('cash_in_period_vnd'),
      },
    };
  }

  // ------------------------------------------------------------------ Cọc

  async deposits(user: AuthUser, q: z.output<typeof depositsReportQuerySchema>) {
    const tenancies = await this.prisma.tenancy.findMany({
      where: { room: this.roomScope(user, q.building_id), ...(q.include_ended === 'false' ? { status: { not: 'ENDED' } } : {}) },
      include: { room: { include: { building: true } }, members: { where: { role: 'PRIMARY' }, include: { tenant: { select: { fullName: true } } }, orderBy: { joinedOn: 'desc' } } },
    });
    const rows: z.infer<typeof depositReportRowSchema>[] = [];
    for (const t of tenancies) {
      const { summary } = await this.ledgers.depositSummary(this.prisma, t.id);
      const ended = t.status === 'ENDED';
      if (ended && summary.held_vnd === '0') continue;
      rows.push({
        tenancy_id: t.id,
        tenancy_code: t.code,
        tenancy_status: t.status,
        room_code: t.room.code,
        building_code: t.room.building.code,
        primary_tenant_name: t.members[0]?.tenant.fullName ?? null,
        required_vnd: ended ? '0' : summary.required_vnd,
        received_vnd: summary.received_vnd,
        applied_vnd: summary.applied_vnd,
        refunded_vnd: summary.refunded_vnd,
        held_vnd: summary.held_vnd,
        shortfall_vnd: ended ? '0' : summary.shortfall_vnd,
        refund_payable_vnd: ended ? summary.held_vnd : '0',
      });
    }
    rows.sort((a, b) => naturalCompare(a.building_code, b.building_code) || naturalCompare(a.room_code, b.room_code));
    const total = (k: 'held_vnd' | 'refund_payable_vnd' | 'shortfall_vnd') => sum(rows.map((r) => BigInt(r[k]))).toString();
    return { rows, totals: { held_vnd: total('held_vnd'), refund_payable_vnd: total('refund_payable_vnd'), shortfall_vnd: total('shortfall_vnd') } };
  }

  // ------------------------------------------------------------------ Thu tiền

  async collections(user: AuthUser, q: z.output<typeof collectionsQuerySchema>): Promise<CollectionsReport> {
    const today = this.clock.today();
    const from = q.from ?? `${today.slice(0, 7)}-01`;
    const to = q.to ?? today;
    const scope = this.roomScope(user, q.building_id);
    const range = { gte: toDbDate(from), lte: toDbDate(to) };
    const payments = await this.prisma.payment.findMany({
      where: { workspaceId: user.workspaceId, status: 'POSTED', paidAt: range, tenancy: { room: scope } },
      include: { tenancy: { include: { room: { include: { building: true } } } } },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
    });
    const depositTxs = await this.prisma.depositTransaction.findMany({
      where: { workspaceId: user.workspaceId, type: 'APPLIED_TO_INVOICE', paidAt: range, tenancy: { room: scope } },
      include: { tenancy: { include: { room: true } } },
    });
    const reversed = new Set(
      (await this.prisma.depositTransaction.findMany({ where: { type: 'REVERSAL', reversesTransactionId: { in: depositTxs.map((d) => d.id) } }, select: { reversesTransactionId: true } })).map(
        (r) => r.reversesTransactionId,
      ),
    );
    const credits = await this.prisma.creditApplication.findMany({
      where: { workspaceId: user.workspaceId, status: 'ACTIVE', createdAt: { gte: toDbDate(from), lt: toDbDate(addDays(to, 1)) }, tenancy: { room: scope } },
      include: { tenancy: { include: { room: true } } },
    });
    const receivers = await userNames(this.prisma, payments.map((p) => p.receivedBy));
    const byMethod: Record<string, string> = {};
    for (const p of payments) byMethod[p.method] = (BigInt(byMethod[p.method] ?? '0') + p.amountVnd).toString();
    const liveDeposits = depositTxs.filter((d) => !reversed.has(d.id));
    return {
      from,
      to,
      payments: payments.map((p) => ({
        id: p.id,
        number: p.number,
        paid_at: day(p.paidAt),
        room_code: p.tenancy.room.code,
        building_code: p.tenancy.room.building.code,
        method: p.method,
        reference: p.reference,
        amount_vnd: p.amountVnd.toString(),
        received_by_name: receivers.get(p.receivedBy) ?? null,
      })),
      deposit_applied: liveDeposits.map((d) => ({ id: d.id, date: d.paidAt ? day(d.paidAt) : d.createdAt.toISOString().slice(0, 10), room_code: d.tenancy.room.code, amount_vnd: d.amountVnd.toString() })),
      credit_applied: credits.map((c) => ({ id: c.id, date: c.createdAt.toISOString().slice(0, 10), room_code: c.tenancy.room.code, amount_vnd: c.amountVnd.toString() })),
      totals: {
        cash_vnd: sum(payments.map((p) => p.amountVnd)).toString(),
        by_method: byMethod,
        deposit_applied_vnd: sum(liveDeposits.map((d) => d.amountVnd)).toString(),
        credit_applied_vnd: sum(credits.map((c) => c.amountVnd)).toString(),
      },
    };
  }
}

