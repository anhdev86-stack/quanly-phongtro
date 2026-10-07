import { Inject, Injectable } from '@nestjs/common';
import {
  type CashFlowReport,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  type financeRangeQuerySchema,
  type OccupancyReport,
  type OperatingReport,
  type RevenueBreakdown,
  type revenueBreakdownQuerySchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { day, naturalCompare } from '../../common/dto/mappers.js';
import { toBusinessDate } from '../../domain/dates/business-date.js';
import { addDays, addMonths, diffDays, firstDayOfMonth, fromDbDate, maxDate, minDate, toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { RoomsService } from '../rooms/rooms.service.js';

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const month = (d: string) => d.slice(0, 7);
const METER_LABELS: Record<string, string> = { ELECTRICITY: 'Tiền điện', WATER: 'Tiền nước' };

/**
 * Báo cáo tài chính mở rộng (V1.1, MASTER_PLAN 13). Tách bạch ba cơ sở số liệu:
 * - Doanh thu (dồn tích theo tháng của thông báo) — không gồm cọc, tiền giữ chỗ, hoàn cọc.
 * - Dòng tiền (theo ngày thực nhận/thực chi) — cọc, tiền giữ chỗ, hoàn tiền là dòng riêng; không phải lợi nhuận.
 * - Thu nhập vận hành = doanh thu thuần + thu nhập khác (tiền giữ chỗ bị giữ lại) − chi phí.
 */
@Injectable()
export class ReportsFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly expenses: ExpensesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private months(q: { from?: string; to?: string }): string[] {
    const to = q.to ?? month(this.clock.today());
    const from = q.from ?? month(addMonths(`${to}-01`, -11));
    const out: string[] = [];
    for (let m = `${from}-01`; m <= `${to}-01` && out.length < 36; m = addMonths(m, 1)) out.push(month(m));
    return out;
  }

  private roomScope(user: AuthUser, buildingId?: string): Prisma.RoomWhereInput {
    return { AND: [this.rooms.roomWhere(user), ...(buildingId ? [{ buildingId }] : [])] };
  }

  /** Doanh thu thuần theo nhóm = Σ dòng DEBIT − Σ dòng CREDIT của chứng từ PUBLISHED, theo tháng của chứng từ (D-033). */
  async revenueBreakdown(user: AuthUser, q: z.output<typeof revenueBreakdownQuerySchema>): Promise<RevenueBreakdown> {
    const months = this.months(q);
    const items = await this.prisma.invoiceItem.findMany({
      where: { invoice: { workspaceId: user.workspaceId, lifecycle: 'PUBLISHED', tenancy: { room: this.roomScope(user, q.building_id) } } },
      select: {
        chargeKind: true,
        direction: true,
        amountVnd: true,
        sourceKey: true,
        unitKey: true,
        invoice: { select: { issueDate: true, statementPeriod: { select: { monthStart: true } }, tenancy: { select: { room: { select: { id: true, code: true, building: { select: { id: true, code: true, name: true } } } } } } } },
      },
    });
    const services = await this.prisma.service.findMany({ where: { workspaceId: user.workspaceId }, select: { id: true, name: true } });
    const serviceName = new Map(services.map((s) => [s.id, s.name]));
    const groups = new Map<string, { label: string; byMonth: bigint[] }>();
    for (const it of items) {
      const inv = it.invoice;
      const m = month(inv.statementPeriod ? fromDbDate(inv.statementPeriod.monthStart) : firstDayOfMonth(day(inv.issueDate)));
      const idx = months.indexOf(m);
      if (idx < 0) continue;
      let key: string;
      let label: string;
      if (q.group_by === 'building') {
        key = inv.tenancy.room.building.id;
        label = `${inv.tenancy.room.building.code} — ${inv.tenancy.room.building.name}`;
      } else if (q.group_by === 'room') {
        key = inv.tenancy.room.id;
        label = `${inv.tenancy.room.building.code} · ${inv.tenancy.room.code}`;
      } else if (it.chargeKind === 'METER') {
        const type = it.unitKey.split(':')[2] ?? 'METER';
        key = `METER:${type}`;
        label = METER_LABELS[type] ?? 'Điện nước';
      } else if (it.chargeKind === 'SERVICE') {
        const sid = it.sourceKey.split(':')[2] ?? '';
        key = `SERVICE:${sid}`;
        label = serviceName.get(sid) ?? 'Dịch vụ';
      } else {
        key = it.chargeKind;
        label = { RENT: 'Tiền phòng', DAMAGE: 'Bồi thường hư hỏng', OTHER: 'Khoản khác' }[it.chargeKind] ?? it.chargeKind;
      }
      const g = groups.get(key) ?? { label, byMonth: months.map(() => 0n) };
      g.byMonth[idx]! += it.direction === 'DEBIT' ? it.amountVnd : -it.amountVnd;
      groups.set(key, g);
    }
    const order = (k: string) => (k === 'RENT' ? 0 : k.startsWith('METER:') ? 1 : k.startsWith('SERVICE:') ? 2 : 3);
    const rows = [...groups.entries()]
      .sort(([ka, a], [kb, b]) => (q.group_by === 'charge' ? order(ka) - order(kb) || naturalCompare(a.label, b.label) : naturalCompare(a.label, b.label)))
      .map(([key, g]) => ({ key, label: g.label, by_month: g.byMonth.map(String), total_vnd: sum(g.byMonth).toString() }));
    const byMonth = months.map((_, i) => sum([...groups.values()].map((g) => g.byMonth[i]!)));
    return { group_by: q.group_by, months, rows, totals: { by_month: byMonth.map(String), total_vnd: sum(byMonth).toString() } };
  }

  /** Dòng tiền theo tháng của ngày nhận/chi thực tế. Giao dịch bị đảo (và giao dịch đảo) không tính. */
  async cashFlow(user: AuthUser, q: z.output<typeof financeRangeQuerySchema>): Promise<CashFlowReport> {
    const months = this.months(q);
    const range = { gte: toDbDate(`${months[0]}-01`), lt: toDbDate(addMonths(`${months.at(-1)}-01`, 1)) };
    const scope = this.roomScope(user, q.building_id);
    const payments = await this.prisma.payment.findMany({ where: { workspaceId: user.workspaceId, status: 'POSTED', paidAt: range, tenancy: { room: scope } }, select: { paidAt: true, amountVnd: true } });
    const deposits = await this.prisma.depositTransaction.findMany({
      where: { workspaceId: user.workspaceId, type: { in: ['RECEIVED', 'TOP_UP', 'REFUND'] }, paidAt: range, tenancy: { room: scope } },
      select: { id: true, type: true, paidAt: true, amountVnd: true },
    });
    const depositReversed = new Set(
      (await this.prisma.depositTransaction.findMany({ where: { reversesTransactionId: { in: deposits.map((d) => d.id) } }, select: { reversesTransactionId: true } })).map((r) => r.reversesTransactionId),
    );
    const holdings = await this.prisma.holdingTransaction.findMany({
      where: { workspaceId: user.workspaceId, type: { in: ['RECEIVED', 'REFUND'] }, paidAt: range, reservation: { room: scope } },
      select: { id: true, type: true, paidAt: true, amountVnd: true },
    });
    const holdingReversed = new Set(
      (await this.prisma.holdingTransaction.findMany({ where: { reversesTransactionId: { in: holdings.map((h) => h.id) } }, select: { reversesTransactionId: true } })).map((r) => r.reversesTransactionId),
    );
    const creditRefunds = await this.prisma.creditRefund.findMany({ where: { workspaceId: user.workspaceId, status: 'POSTED', paidAt: range, tenancy: { room: scope } }, select: { paidAt: true, amountVnd: true } });
    const expenses = await this.prisma.expense.findMany({ where: { AND: [this.expenses.scopeWhere(user, q.building_id), { status: 'POSTED', spentOn: range }] }, select: { spentOn: true, amountVnd: true } });

    const at = (d: Date | null, m: string) => !!d && month(day(d)) === m;
    const rows = months.map((m) => {
      const rent = sum(payments.filter((p) => at(p.paidAt, m)).map((p) => p.amountVnd));
      const depIn = sum(deposits.filter((d) => d.type !== 'REFUND' && !depositReversed.has(d.id) && at(d.paidAt, m)).map((d) => d.amountVnd));
      const depOut = sum(deposits.filter((d) => d.type === 'REFUND' && !depositReversed.has(d.id) && at(d.paidAt, m)).map((d) => d.amountVnd));
      const holdIn = sum(holdings.filter((h) => h.type === 'RECEIVED' && !holdingReversed.has(h.id) && at(h.paidAt, m)).map((h) => h.amountVnd));
      const holdOut = sum(holdings.filter((h) => h.type === 'REFUND' && !holdingReversed.has(h.id) && at(h.paidAt, m)).map((h) => h.amountVnd));
      const credOut = sum(creditRefunds.filter((c) => at(c.paidAt, m)).map((c) => c.amountVnd));
      const exp = sum(expenses.filter((e) => at(e.spentOn, m)).map((e) => e.amountVnd));
      const cashIn = rent + depIn + holdIn;
      const cashOut = depOut + credOut + holdOut + exp;
      return {
        period: m,
        rent_collections_vnd: rent.toString(),
        deposits_in_vnd: depIn.toString(),
        holding_in_vnd: holdIn.toString(),
        cash_in_vnd: cashIn.toString(),
        deposit_refunds_vnd: depOut.toString(),
        credit_refunds_vnd: credOut.toString(),
        holding_refunds_vnd: holdOut.toString(),
        expenses_vnd: exp.toString(),
        cash_out_vnd: cashOut.toString(),
        net_cash_vnd: (cashIn - cashOut).toString(),
      };
    });
    const keys = Object.keys(rows[0] ?? {}).filter((k) => k !== 'period') as (keyof Omit<(typeof rows)[number], 'period'>)[];
    const totals = Object.fromEntries(keys.map((k) => [k, sum(rows.map((r) => BigInt(r[k]))).toString()])) as CashFlowReport['totals'];
    return { rows, totals };
  }

  /** Lấp đầy theo ngày-phòng: mỗi phòng chưa lưu trữ đóng góp số ngày của tháng (tháng hiện tại tính tới hôm nay). */
  async occupancy(user: AuthUser, q: z.output<typeof financeRangeQuerySchema>): Promise<OccupancyReport> {
    const months = this.months(q);
    const today = this.clock.today();
    const rooms = await this.prisma.room.findMany({ where: this.roomScope(user, q.building_id), select: { id: true, archivedAt: true } });
    const tenancies = await this.prisma.tenancy.findMany({
      where: { room: this.roomScope(user, q.building_id) },
      select: { roomId: true, startDate: true, chargeEndExclusive: true },
    });
    const rows = months.map((m) => {
      const start = `${m}-01`;
      const endEx = minDate(addMonths(start, 1), addDays(today, 1));
      let roomDays = 0;
      let occupied = 0;
      if (endEx > start) {
        for (const r of rooms) {
          const archived = r.archivedAt ? toBusinessDate(r.archivedAt, 'Asia/Ho_Chi_Minh') : null;
          const rEnd = archived ? minDate(endEx, archived) : endEx;
          if (rEnd <= start) continue;
          roomDays += diffDays(start, rEnd);
          for (const t of tenancies.filter((x) => x.roomId === r.id)) {
            const a = maxDate(start, day(t.startDate));
            const b = t.chargeEndExclusive ? minDate(rEnd, day(t.chargeEndExclusive)) : rEnd;
            if (b > a) occupied += diffDays(a, b);
          }
        }
      }
      return { period: m, room_days: roomDays, occupied_days: occupied, rate_pct: roomDays ? ((occupied * 100) / roomDays).toFixed(1) : '0.0' };
    });
    return {
      rows,
      note: 'Tỷ lệ = số ngày-phòng có lần thuê / số ngày-phòng của phòng chưa lưu trữ trong tháng (tháng hiện tại tính tới hôm nay). Phòng bảo trì vẫn nằm trong mẫu số.',
    };
  }

  /** Thu nhập vận hành theo tháng (dồn tích): doanh thu thuần + tiền giữ chỗ bị giữ lại − chi phí. */
  async operating(user: AuthUser, q: z.output<typeof financeRangeQuerySchema>): Promise<OperatingReport> {
    const revenue = await this.revenueBreakdown(user, { ...q, group_by: 'charge' });
    const months = revenue.months;
    const range = { gte: toDbDate(`${months[0]}-01`), lt: toDbDate(addMonths(`${months.at(-1)}-01`, 1)) };
    const forfeits = await this.prisma.holdingTransaction.findMany({
      where: { workspaceId: user.workspaceId, type: 'FORFEIT', reservation: { room: this.roomScope(user, q.building_id) } },
      select: { id: true, paidAt: true, createdAt: true, amountVnd: true },
    });
    const reversedForfeits = new Set(
      (await this.prisma.holdingTransaction.findMany({ where: { reversesTransactionId: { in: forfeits.map((f) => f.id) } }, select: { reversesTransactionId: true } })).map((r) => r.reversesTransactionId),
    );
    const expenses = await this.prisma.expense.findMany({
      where: { AND: [this.expenses.scopeWhere(user, q.building_id), { status: 'POSTED', spentOn: range }] },
      select: { spentOn: true, amountVnd: true, category: true },
    });
    const rows = months.map((m, i) => {
      const net = BigInt(revenue.totals.by_month[i]!);
      const other = sum(forfeits.filter((f) => !reversedForfeits.has(f.id) && month(f.paidAt ? day(f.paidAt) : toBusinessDate(f.createdAt, 'Asia/Ho_Chi_Minh')) === m).map((f) => f.amountVnd));
      const exp = sum(expenses.filter((e) => month(day(e.spentOn)) === m).map((e) => e.amountVnd));
      return { period: m, net_revenue_vnd: net.toString(), other_income_vnd: other.toString(), expenses_vnd: exp.toString(), operating_income_vnd: (net + other - exp).toString() };
    });
    const t = (k: 'net_revenue_vnd' | 'other_income_vnd' | 'expenses_vnd' | 'operating_income_vnd') => sum(rows.map((r) => BigInt(r[k]))).toString();
    const byCat = new Map<string, bigint>();
    for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0n) + e.amountVnd);
    return {
      rows,
      totals: { net_revenue_vnd: t('net_revenue_vnd'), other_income_vnd: t('other_income_vnd'), expenses_vnd: t('expenses_vnd'), operating_income_vnd: t('operating_income_vnd') },
      expenses_by_category: [...byCat.entries()]
        .sort((a, b) => (b[1] > a[1] ? 1 : -1))
        .map(([category, amount]) => ({ category, label: EXPENSE_CATEGORY_LABELS[category as ExpenseCategory] ?? category, amount_vnd: amount.toString() })),
      note:
        'Doanh thu thuần theo tháng của thông báo (dồn tích); thu nhập khác = tiền giữ chỗ bị giữ lại; chi phí theo ngày chi. Cọc, tiền giữ chỗ nhận vào và hoàn cọc không phải doanh thu hay chi phí. Đây không phải dòng tiền.',
    };
  }
}
