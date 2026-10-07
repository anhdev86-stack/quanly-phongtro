import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  cashFlowSchema,
  financeRangeQuerySchema,
  occupancySchema,
  operatingSchema,
  revenueBreakdownQuerySchema,
  revenueBreakdownSchema,
  collectionsQuerySchema,
  collectionsReportSchema,
  dashboardQuerySchema,
  dashboardSchema,
  debtListSchema,
  debtQuerySchema,
  depositsReportQuerySchema,
  depositsReportSchema,
  PAYMENT_METHOD_LABELS,
  PERMISSIONS,
  REPORT_TYPES,
  revenueQuerySchema,
  revenueReportSchema,
} from '@ql-tro/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { DebtsService } from '../payments/debts.service.js';
import { toCsv } from './csv.js';
import { ReportsFinanceService } from './reports-finance.service.js';
import { ReportsService } from './reports.service.js';

const exportQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  building_id: z.string().optional(),
  include_ended: z.enum(['true', 'false']).optional(),
  overdue_only: z.enum(['true', 'false']).optional(),
  group_by: z.enum(['building', 'room', 'charge']).optional(),
});

@ApiTags('reports')
@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly debts: DebtsService,
    private readonly finance: ReportsFinanceService,
  ) {}

  @Get('reports/revenue-breakdown')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Doanh thu thuần theo tòa / phòng / khoản thu (tiền phòng, điện, nước, từng dịch vụ) — V1.1' })
  @ApiZodResponse(200, revenueBreakdownSchema, 'Báo cáo')
  @ApiErrorResponses(400, 401, 403)
  revenueBreakdown(@CurrentUser() user: AuthUser, @Query(new ZodPipe(revenueBreakdownQuerySchema)) q: z.output<typeof revenueBreakdownQuerySchema>) {
    return this.finance.revenueBreakdown(user, q);
  }

  @Get('reports/cash-flow')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Dòng tiền theo ngày nhận/chi thực tế: thu tiền phòng, cọc, giữ chỗ; hoàn cọc, hoàn tiền dư, chi phí (không phải lợi nhuận) — V1.1' })
  @ApiZodResponse(200, cashFlowSchema, 'Báo cáo')
  @ApiErrorResponses(400, 401, 403)
  cashFlow(@CurrentUser() user: AuthUser, @Query(new ZodPipe(financeRangeQuerySchema)) q: z.output<typeof financeRangeQuerySchema>) {
    return this.finance.cashFlow(user, q);
  }

  @Get('reports/occupancy')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Lấp đầy theo ngày-phòng từng tháng — V1.1' })
  @ApiZodResponse(200, occupancySchema, 'Báo cáo')
  @ApiErrorResponses(400, 401, 403)
  occupancy(@CurrentUser() user: AuthUser, @Query(new ZodPipe(financeRangeQuerySchema)) q: z.output<typeof financeRangeQuerySchema>) {
    return this.finance.occupancy(user, q);
  }

  @Get('reports/operating')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Chi phí và thu nhập vận hành = doanh thu thuần + tiền giữ chỗ bị giữ lại − chi phí — V1.1' })
  @ApiZodResponse(200, operatingSchema, 'Báo cáo')
  @ApiErrorResponses(400, 401, 403)
  operating(@CurrentUser() user: AuthUser, @Query(new ZodPipe(financeRangeQuerySchema)) q: z.output<typeof financeRangeQuerySchema>) {
    return this.finance.operating(user, q);
  }

  @Get('dashboard')
  @RequirePermissions()
  @ApiOperation({ summary: 'Tổng quan: phòng theo trạng thái, chỉ số phụ, tiền (nếu có quyền), việc cần xử lý — trong phạm vi tòa' })
  @ApiZodResponse(200, dashboardSchema, 'Tổng quan')
  @ApiErrorResponses(400, 401)
  dashboard(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dashboardQuerySchema)) q: z.output<typeof dashboardQuerySchema>) {
    return this.reports.dashboard(user, q);
  }

  @Get('reports/revenue-monthly')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Doanh thu theo tháng: phát sinh, giảm trừ, đã thu (tiền/cọc/credit), còn nợ, thực thu trong tháng' })
  @ApiZodResponse(200, revenueReportSchema, 'Báo cáo')
  @ApiErrorResponses(400, 401, 403)
  revenue(@CurrentUser() user: AuthUser, @Query(new ZodPipe(revenueQuerySchema)) q: z.output<typeof revenueQuerySchema>) {
    return this.reports.revenue(user, q);
  }

  @Get('reports/debts')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Báo cáo công nợ theo lần thuê (gồm lần thuê đã kết thúc)' })
  @ApiZodResponse(200, debtListSchema, 'Báo cáo')
  @ApiErrorResponses(400, 401, 403)
  debtReport(@CurrentUser() user: AuthUser, @Query(new ZodPipe(debtQuerySchema)) q: z.output<typeof debtQuerySchema>) {
    return this.debts.list(user, q);
  }

  @Get('reports/deposits')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Báo cáo cọc: đang giữ (nghĩa vụ phải trả), còn thiếu, phải hoàn của lần thuê đã kết thúc' })
  @ApiZodResponse(200, depositsReportSchema, 'Báo cáo')
  @ApiErrorResponses(400, 401, 403)
  depositReport(@CurrentUser() user: AuthUser, @Query(new ZodPipe(depositsReportQuerySchema)) q: z.output<typeof depositsReportQuerySchema>) {
    return this.reports.deposits(user, q);
  }

  @Get('reports/collections')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiOperation({ summary: 'Thu tiền theo ngày: phiếu thu còn hiệu lực; trừ cọc và cấn trừ credit trình bày riêng' })
  @ApiZodResponse(200, collectionsReportSchema, 'Báo cáo')
  @ApiErrorResponses(400, 401, 403)
  collections(@CurrentUser() user: AuthUser, @Query(new ZodPipe(collectionsQuerySchema)) q: z.output<typeof collectionsQuerySchema>) {
    return this.reports.collections(user, q);
  }

  @Get('reports/:type/export')
  @RequirePermissions(PERMISSIONS.REPORTS_VIEW)
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Xuất CSV (UTF-8) cùng bộ lọc và phạm vi tòa với màn hình: revenue-monthly | debts | deposits | collections | revenue-breakdown | cash-flow | occupancy | operating' })
  @ApiZodResponse(200, z.string(), 'CSV')
  @ApiErrorResponses(400, 401, 403)
  async export(@CurrentUser() user: AuthUser, @Param('type') type: string, @Query(new ZodPipe(exportQuerySchema)) q: z.output<typeof exportQuerySchema>, @Res({ passthrough: true }) res: Response) {
    if (!(REPORT_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Loại báo cáo không hợp lệ.');
    const csv = await this.csvFor(user, type as (typeof REPORT_TYPES)[number], q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-${type}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }

  private async csvFor(user: AuthUser, type: (typeof REPORT_TYPES)[number], q: z.output<typeof exportQuerySchema>): Promise<string> {
    if (type === 'revenue-monthly') {
      const r = await this.reports.revenue(user, revenueQuerySchema.parse(q));
      const head = ['Tháng', 'Phát sinh', 'Giảm trừ', 'Doanh thu thuần', 'Đã thu - tiền', 'Đã thu - trừ cọc', 'Đã thu - cấn trừ credit', 'Đã thu', 'Còn nợ', 'Thực thu trong tháng'];
      const line = (p: string, x: (typeof r.rows)[number] | typeof r.totals) => [
        p,
        x.invoiced_vnd,
        x.reductions_vnd,
        x.net_vnd,
        x.paid_cash_vnd,
        x.paid_deposit_vnd,
        x.paid_credit_vnd,
        x.paid_total_vnd,
        x.outstanding_vnd,
        x.cash_in_period_vnd,
      ];
      return toCsv(head, [...r.rows.map((x) => line(`${x.period.slice(5)}/${x.period.slice(0, 4)}`, x)), line('Tổng', r.totals)]);
    }
    const mm = (p: string) => `${p.slice(5)}/${p.slice(0, 4)}`;
    if (type === 'revenue-breakdown') {
      const r = await this.finance.revenueBreakdown(user, revenueBreakdownQuerySchema.parse(q));
      return toCsv(['Nhóm', ...r.months.map(mm), 'Tổng'], [...r.rows.map((x) => [x.label, ...x.by_month, x.total_vnd]), ['Tổng', ...r.totals.by_month, r.totals.total_vnd]]);
    }
    if (type === 'cash-flow') {
      const r = await this.finance.cashFlow(user, financeRangeQuerySchema.parse(q));
      const cols = ['rent_collections_vnd', 'deposits_in_vnd', 'holding_in_vnd', 'cash_in_vnd', 'deposit_refunds_vnd', 'credit_refunds_vnd', 'holding_refunds_vnd', 'expenses_vnd', 'cash_out_vnd', 'net_cash_vnd'] as const;
      return toCsv(
        ['Tháng', 'Thu tiền phòng/dịch vụ', 'Nhận cọc', 'Nhận giữ chỗ', 'Tổng tiền vào', 'Hoàn cọc', 'Hoàn tiền dư', 'Hoàn giữ chỗ', 'Chi phí', 'Tổng tiền ra', 'Chênh lệch tiền'],
        [...r.rows.map((x) => [mm(x.period), ...cols.map((c) => x[c])]), ['Tổng', ...cols.map((c) => r.totals[c])]],
      );
    }
    if (type === 'occupancy') {
      const r = await this.finance.occupancy(user, financeRangeQuerySchema.parse(q));
      return toCsv(['Tháng', 'Ngày-phòng', 'Ngày-phòng có thuê', 'Tỷ lệ lấp đầy (%)'], r.rows.map((x) => [mm(x.period), x.room_days, x.occupied_days, x.rate_pct]));
    }
    if (type === 'operating') {
      const r = await this.finance.operating(user, financeRangeQuerySchema.parse(q));
      return toCsv(
        ['Tháng', 'Doanh thu thuần', 'Thu nhập khác (giữ chỗ bị giữ lại)', 'Chi phí', 'Thu nhập vận hành'],
        [...r.rows.map((x) => [mm(x.period), x.net_revenue_vnd, x.other_income_vnd, x.expenses_vnd, x.operating_income_vnd]), ['Tổng', r.totals.net_revenue_vnd, r.totals.other_income_vnd, r.totals.expenses_vnd, r.totals.operating_income_vnd]],
      );
    }
    if (type === 'debts') {
      const r = await this.debts.list(user, debtQuerySchema.parse({ ...q, page: 1, page_size: 100 }));
      const all = r.total > r.items.length ? (await this.debts.list(user, { ...debtQuerySchema.parse(q), page: 1, page_size: r.total })).items : r.items;
      return toCsv(
        ['Tòa', 'Phòng', 'Lần thuê', 'Trạng thái', 'Người đại diện', 'Số thông báo còn nợ', 'Còn nợ', 'Quá hạn', 'Hạn sớm nhất', 'Credit còn lại'],
        all.map((d) => [d.building_code, d.room_code, d.tenancy_code, d.tenancy_status, d.primary_tenant_name, d.open_invoices, d.debt_vnd, d.overdue_vnd, d.oldest_due_date, d.credit_available_vnd]),
      );
    }
    if (type === 'deposits') {
      const r = await this.reports.deposits(user, depositsReportQuerySchema.parse(q));
      return toCsv(
        ['Tòa', 'Phòng', 'Lần thuê', 'Trạng thái', 'Người đại diện', 'Mức yêu cầu', 'Đã nhận', 'Đã áp vào nợ', 'Đã hoàn', 'Đang giữ', 'Còn thiếu', 'Phải hoàn'],
        r.rows.map((d) => [d.building_code, d.room_code, d.tenancy_code, d.tenancy_status, d.primary_tenant_name, d.required_vnd, d.received_vnd, d.applied_vnd, d.refunded_vnd, d.held_vnd, d.shortfall_vnd, d.refund_payable_vnd]),
      );
    }
    const r = await this.reports.collections(user, collectionsQuerySchema.parse(q));
    return toCsv(['Loại', 'Ngày', 'Số', 'Tòa', 'Phòng', 'Phương thức', 'Tham chiếu', 'Số tiền'], [
      ...r.payments.map((p) => ['Phiếu thu', p.paid_at, p.number, p.building_code, p.room_code, PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method, p.reference, p.amount_vnd]),
      ...r.deposit_applied.map((d) => ['Trừ vào cọc (không phải tiền mới)', d.date, '', '', d.room_code, '', '', d.amount_vnd]),
      ...r.credit_applied.map((c) => ['Cấn trừ credit (không phải tiền mới)', c.date, '', '', c.room_code, '', '', c.amount_vnd]),
    ]);
  }
}
