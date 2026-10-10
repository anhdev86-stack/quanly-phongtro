import { z } from 'zod';
import { businessDateSchema, uuidSchema } from './primitives.js';
import { periodSchema } from './utilities.js';

// Phase 8A: dashboard và báo cáo MVP (MASTER_PLAN 12, 13).

export const dashboardQuerySchema = z.object({ building_id: uuidSchema.optional(), period: periodSchema.optional() });

export const TODO_KINDS = [
  'MISSING_READINGS',
  'DRAFT_INVOICES',
  'OVERDUE_INVOICES',
  'CONTRACTS_EXPIRING',
  'HOLDING_UNRESOLVED',
  'REFUNDS_PAYABLE',
  'RECEIVABLE_AFTER_MOVE_OUT',
  'RESIDENCE_UNREGISTERED',
  'REMINDERS_FAILED',
  'MAINTENANCE_OPEN',
] as const;
export type TodoKind = (typeof TODO_KINDS)[number];

export const dashboardSchema = z.object({
  period: z.string(),
  rooms: z.object({
    total: z.number(),
    AVAILABLE: z.number(),
    OCCUPIED: z.number(),
    RESERVED: z.number(),
    MAINTENANCE: z.number(),
    /** OCCUPIED / tổng phòng chưa lưu trữ. */
    occupancy_rate: z.number(),
  }),
  /** Chỉ số phụ — có thể trùng với OCCUPIED, không cộng vào tổng. */
  secondary: z.object({ notice_given: z.number(), month_to_month: z.number(), contracts_expiring_30: z.number() }),
  /** Chỉ có khi người dùng xem được thông báo/công nợ. */
  money: z
    .object({
      debt_vnd: z.string(),
      overdue_vnd: z.string(),
      deposit_held_vnd: z.string(),
      deposit_refund_payable_vnd: z.string(),
      credit_refund_payable_vnd: z.string(),
      holding_unresolved_vnd: z.string(),
      collected_in_period_vnd: z.string(),
      invoiced_in_period_vnd: z.string(),
    })
    .nullable(),
  todo: z.array(z.object({ kind: z.enum(TODO_KINDS), count: z.number(), amount_vnd: z.string().nullable(), label: z.string(), href: z.string() })),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

// ---------- Doanh thu theo tháng ----------

export const revenueQuerySchema = z.object({
  from: periodSchema.optional(),
  to: periodSchema.optional(),
  building_id: uuidSchema.optional(),
});

export const revenueRowSchema = z.object({
  period: z.string(),
  /** Phát sinh: Σ total thông báo loại nợ đã phát hành của tháng. */
  invoiced_vnd: z.string(),
  /** Giảm trừ: Σ total chứng từ credit đã phát hành của tháng. */
  reductions_vnd: z.string(),
  net_vnd: z.string(),
  /** Đã thu của chính các thông báo tháng này, tách theo nguồn. */
  paid_cash_vnd: z.string(),
  paid_deposit_vnd: z.string(),
  paid_credit_vnd: z.string(),
  paid_total_vnd: z.string(),
  outstanding_vnd: z.string(),
  /** Thực thu trong tháng theo ngày nhận tiền (mọi thông báo). */
  cash_in_period_vnd: z.string(),
});
export type RevenueRow = z.infer<typeof revenueRowSchema>;

export const revenueReportSchema = z.object({ rows: z.array(revenueRowSchema), totals: revenueRowSchema.omit({ period: true }) });
export type RevenueReport = z.infer<typeof revenueReportSchema>;

// ---------- Cọc ----------

export const depositsReportQuerySchema = z.object({ building_id: uuidSchema.optional(), include_ended: z.enum(['true', 'false']).optional() });

export const depositReportRowSchema = z.object({
  tenancy_id: z.string(),
  tenancy_code: z.string(),
  tenancy_status: z.string(),
  room_code: z.string(),
  building_code: z.string(),
  primary_tenant_name: z.string().nullable(),
  required_vnd: z.string(),
  received_vnd: z.string(),
  applied_vnd: z.string(),
  refunded_vnd: z.string(),
  held_vnd: z.string(),
  shortfall_vnd: z.string(),
  /** Lần thuê đã kết thúc còn giữ cọc = phải hoàn. */
  refund_payable_vnd: z.string(),
});
export const depositsReportSchema = z.object({
  rows: z.array(depositReportRowSchema),
  totals: z.object({ held_vnd: z.string(), refund_payable_vnd: z.string(), shortfall_vnd: z.string() }),
});

// ---------- Thu tiền ----------

export const collectionsQuerySchema = z.object({ from: businessDateSchema.optional(), to: businessDateSchema.optional(), building_id: uuidSchema.optional() });

export const collectionsReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  payments: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      paid_at: z.string(),
      room_code: z.string(),
      building_code: z.string(),
      method: z.string(),
      reference: z.string().nullable(),
      amount_vnd: z.string(),
      /** Người nhận tiền (D-045). */
      received_by_name: z.string().nullable(),
    }),
  ),
  /** Không phải tiền mặt vừa nhận — trình bày riêng (MASTER_PLAN 13). */
  deposit_applied: z.array(z.object({ id: z.string(), date: z.string(), room_code: z.string(), amount_vnd: z.string() })),
  credit_applied: z.array(z.object({ id: z.string(), date: z.string(), room_code: z.string(), amount_vnd: z.string() })),
  totals: z.object({
    cash_vnd: z.string(),
    by_method: z.record(z.string(), z.string()),
    deposit_applied_vnd: z.string(),
    credit_applied_vnd: z.string(),
  }),
});
export type CollectionsReport = z.infer<typeof collectionsReportSchema>;

export const REPORT_TYPES = ['revenue-monthly', 'debts', 'deposits', 'collections', 'revenue-breakdown', 'cash-flow', 'occupancy', 'operating'] as const;

// ------------------------------------------------------------------ V1.1 Phase 12: báo cáo tài chính mở rộng

const monthRange = {
  from: periodSchema.optional(),
  to: periodSchema.optional(),
  building_id: uuidSchema.optional(),
};

/** Doanh thu thuần theo tòa / phòng / khoản thu (tiền phòng, điện, nước, từng dịch vụ…). */
export const revenueBreakdownQuerySchema = z.object({ ...monthRange, group_by: z.enum(['building', 'room', 'charge']).default('charge') });
export const revenueBreakdownSchema = z.object({
  group_by: z.enum(['building', 'room', 'charge']),
  months: z.array(z.string()),
  rows: z.array(z.object({ key: z.string(), label: z.string(), by_month: z.array(z.string()), total_vnd: z.string() })),
  totals: z.object({ by_month: z.array(z.string()), total_vnd: z.string() }),
});
export type RevenueBreakdown = z.infer<typeof revenueBreakdownSchema>;

export const financeRangeQuerySchema = z.object(monthRange);

/** Dòng tiền theo ngày nhận/chi thực tế — không phải lợi nhuận. Cọc, tiền giữ chỗ, hoàn tiền tách dòng riêng. */
export const cashFlowRowSchema = z.object({
  period: z.string(),
  rent_collections_vnd: z.string(),
  deposits_in_vnd: z.string(),
  holding_in_vnd: z.string(),
  cash_in_vnd: z.string(),
  deposit_refunds_vnd: z.string(),
  credit_refunds_vnd: z.string(),
  holding_refunds_vnd: z.string(),
  expenses_vnd: z.string(),
  cash_out_vnd: z.string(),
  net_cash_vnd: z.string(),
});
export const cashFlowSchema = z.object({ rows: z.array(cashFlowRowSchema), totals: cashFlowRowSchema.omit({ period: true }) });
export type CashFlowReport = z.infer<typeof cashFlowSchema>;

/** Lấp đầy theo ngày-phòng: số ngày có lần thuê / số ngày-phòng của phòng chưa lưu trữ. */
export const occupancyRowSchema = z.object({
  period: z.string(),
  room_days: z.number(),
  occupied_days: z.number(),
  /** % một chữ số thập phân, dạng chuỗi. */
  rate_pct: z.string(),
});
export const occupancySchema = z.object({ rows: z.array(occupancyRowSchema), note: z.string() });
export type OccupancyReport = z.infer<typeof occupancySchema>;

/** Thu nhập vận hành = doanh thu thuần + thu nhập khác (tiền giữ chỗ bị giữ lại) − chi phí. Cơ sở dồn tích, không phải dòng tiền. */
export const operatingRowSchema = z.object({
  period: z.string(),
  net_revenue_vnd: z.string(),
  other_income_vnd: z.string(),
  expenses_vnd: z.string(),
  operating_income_vnd: z.string(),
});
export const operatingSchema = z.object({
  rows: z.array(operatingRowSchema),
  totals: operatingRowSchema.omit({ period: true }),
  expenses_by_category: z.array(z.object({ category: z.string(), label: z.string(), amount_vnd: z.string() })),
  note: z.string(),
});
export type OperatingReport = z.infer<typeof operatingSchema>;
