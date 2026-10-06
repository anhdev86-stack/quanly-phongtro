import { Inject, Injectable } from '@nestjs/common';
import type { DebtRow, debtQuerySchema, Statement } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { day, naturalCompare, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { InvoiceBalances } from './balances.js';

type StatementEntry = Statement['entries'][number];

/**
 * Công nợ theo lần thuê (MASTER_PLAN 12): tenancy ENDED còn nợ vẫn hiện. Sao kê theo thời gian: thông báo, phiếu thu,
 * đảo, trừ cọc, hoàn credit; số dư cuối = Σ còn nợ − Σ credit còn lại (cùng hàm InvoiceBalances).
 */
@Injectable()
export class DebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly balances: InvoiceBalances,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Số còn nợ / quá hạn / credit còn lại của từng lần thuê (dùng chung cho công nợ, dashboard, báo cáo). */
  async positions(db: Db, tenancyIds: string[]) {
    const invoices = await db.invoice.findMany({ where: { tenancyId: { in: tenancyIds }, lifecycle: 'PUBLISHED' } });
    const remaining = await this.balances.remaining(db, invoices);
    const today = this.clock.today();
    const out = new Map<string, { debt: bigint; overdue: bigint; credit: bigint; open: number; oldestDue: string | null }>();
    for (const id of tenancyIds) out.set(id, { debt: 0n, overdue: 0n, credit: 0n, open: 0, oldestDue: null });
    for (const inv of invoices) {
      const pos = out.get(inv.tenancyId)!;
      const r = remaining.get(inv.id) ?? 0n;
      if (r === 0n) continue;
      if (inv.type === 'CREDIT_ADJUSTMENT') {
        pos.credit += r;
        continue;
      }
      pos.debt += r;
      pos.open++;
      const due = day(inv.dueDate);
      if (due < today) pos.overdue += r;
      if (!pos.oldestDue || due < pos.oldestDue) pos.oldestDue = due;
    }
    return out;
  }

  async list(user: AuthUser, q: z.output<typeof debtQuerySchema>) {
    const tenancies = await this.prisma.tenancy.findMany({
      where: { workspaceId: user.workspaceId, room: { ...this.rooms.roomWhere(user), ...(q.building_id ? { buildingId: q.building_id } : {}) }, invoices: { some: { lifecycle: 'PUBLISHED' } } },
      include: { room: { include: { building: true } }, members: { where: { role: 'PRIMARY' }, include: { tenant: { select: { fullName: true } } }, orderBy: { joinedOn: 'desc' } } },
    });
    const pos = await this.positions(this.prisma, tenancies.map((t) => t.id));
    let rows: DebtRow[] = tenancies
      .map((t) => {
        const p = pos.get(t.id)!;
        return {
          tenancy_id: t.id,
          tenancy_code: t.code,
          tenancy_status: t.status,
          room_id: t.roomId,
          room_code: t.room.code,
          building_code: t.room.building.code,
          primary_tenant_name: t.members[0]?.tenant.fullName ?? null,
          open_invoices: p.open,
          debt_vnd: p.debt.toString(),
          overdue_vnd: p.overdue.toString(),
          oldest_due_date: p.oldestDue,
          credit_available_vnd: p.credit.toString(),
        };
      })
      .filter((r) => r.debt_vnd !== '0' || r.credit_available_vnd !== '0');
    if (q.overdue_only === 'true') rows = rows.filter((r) => r.overdue_vnd !== '0');
    if (q.q) {
      const needle = q.q.toLowerCase();
      rows = rows.filter((r) => [r.room_code, r.tenancy_code, r.primary_tenant_name].some((v) => v?.toLowerCase().includes(needle)));
    }
    rows.sort((a, b) => (a.oldest_due_date ?? '9') < (b.oldest_due_date ?? '9') ? -1 : (a.oldest_due_date ?? '9') > (b.oldest_due_date ?? '9') ? 1 : naturalCompare(a.room_code, b.room_code));
    const sum = (k: 'debt_vnd' | 'overdue_vnd' | 'credit_available_vnd') => rows.reduce((s, r) => s + BigInt(r[k]), 0n).toString();
    return { ...paged(rows, q.page, q.page_size), totals: { debt_vnd: sum('debt_vnd'), overdue_vnd: sum('overdue_vnd'), credit_available_vnd: sum('credit_available_vnd') } };
  }

  async statement(user: AuthUser, tenancyId: string): Promise<Statement> {
    const t = await this.prisma.tenancy.findFirst({ where: { id: tenancyId, room: this.rooms.roomWhere(user) }, include: { room: true } });
    if (!t) throw new AppError('NOT_FOUND');
    const invoices = await this.prisma.invoice.findMany({ where: { tenancyId, lifecycle: 'PUBLISHED' }, include: { statementPeriod: true } });
    const payments = await this.prisma.payment.findMany({ where: { tenancyId } });
    const refunds = await this.prisma.creditRefund.findMany({ where: { tenancyId } });
    const deposits = await this.prisma.depositTransaction.findMany({ where: { tenancyId, type: { in: ['APPLIED_TO_INVOICE', 'REVERSAL'] } } });
    const applied = deposits.filter((d) => d.type === 'APPLIED_TO_INVOICE');
    const raw: Omit<StatementEntry, 'balance_vnd'>[] = [];
    const e = (date: string, kind: StatementEntry['kind'], ref: string, num: string | null, desc: string, debit: bigint, credit: bigint) =>
      raw.push({ date, kind, ref_id: ref, ref_number: num, description: desc, debit_vnd: debit.toString(), credit_vnd: credit.toString() });
    for (const i of invoices) {
      const period = i.statementPeriod ? ` tháng ${day(i.statementPeriod.monthStart).slice(5, 7)}/${day(i.statementPeriod.monthStart).slice(0, 4)}` : '';
      if (i.type === 'CREDIT_ADJUSTMENT') e(day(i.issueDate), 'CREDIT_NOTE', i.id, i.number, 'Chứng từ điều chỉnh giảm (credit)', 0n, i.totalVnd);
      else e(day(i.issueDate), 'INVOICE', i.id, i.number, `Thông báo${period}`, i.totalVnd, 0n);
    }
    for (const p of payments) {
      e(day(p.paidAt), 'PAYMENT', p.id, p.number, `Thu tiền (${p.method})${p.reference ? ` · ${p.reference}` : ''}`, 0n, p.amountVnd);
      if (p.status === 'REVERSED') e(p.reversedAt!.toISOString().slice(0, 10), 'PAYMENT_REVERSED', p.id, p.number, `Đảo phiếu thu: ${p.reversalReason}`, p.amountVnd, 0n);
    }
    for (const d of applied) {
      e(d.paidAt ? day(d.paidAt) : d.createdAt.toISOString().slice(0, 10), 'DEPOSIT_APPLIED', d.id, null, 'Trừ vào tiền cọc', 0n, d.amountVnd);
      const rev = deposits.find((x) => x.type === 'REVERSAL' && x.reversesTransactionId === d.id);
      if (rev) e(rev.createdAt.toISOString().slice(0, 10), 'DEPOSIT_APPLIED_REVERSED', rev.id, null, 'Đảo trừ cọc', d.amountVnd, 0n);
    }
    for (const r of refunds) {
      e(day(r.paidAt), 'CREDIT_REFUND', r.id, null, 'Hoàn tiền credit cho khách', r.amountVnd, 0n);
      if (r.status === 'REVERSED') e(r.reversedAt!.toISOString().slice(0, 10), 'CREDIT_REFUND_REVERSED', r.id, null, `Đảo hoàn credit: ${r.reversalReason}`, 0n, r.amountVnd);
    }
    raw.sort((a, b) => (a.date === b.date ? (BigInt(b.debit_vnd) > 0n ? 1 : -1) : a.date < b.date ? -1 : 1));
    let balance = 0n;
    const entries = raw.map((r) => {
      balance += BigInt(r.debit_vnd) - BigInt(r.credit_vnd);
      return { ...r, balance_vnd: balance.toString() };
    });
    const pos = (await this.positions(this.prisma, [tenancyId])).get(tenancyId)!;
    return {
      tenancy_id: t.id,
      tenancy_code: t.code,
      room_code: t.room.code,
      entries,
      balance_vnd: (pos.debt - pos.credit).toString(),
      debt_vnd: pos.debt.toString(),
      credit_available_vnd: pos.credit.toString(),
    };
  }
}
