import { z } from 'zod';
import { expectedVersionSchema, pageQuerySchema, reasonSchema } from './common.js';
import { uuidSchema } from './primitives.js';
import { periodSchema } from './utilities.js';

// Phase 5: thông báo tiền phòng (MASTER_PLAN 5.4, 8, D-022…D-025).

export const INVOICE_TYPES = ['MONTHLY', 'FINAL', 'DEBIT_ADJUSTMENT', 'CREDIT_ADJUSTMENT'] as const;
export const INVOICE_TYPE_LABELS = {
  MONTHLY: 'Thông báo tháng',
  FINAL: 'Thông báo trả phòng',
  DEBIT_ADJUSTMENT: 'Điều chỉnh tăng',
  CREDIT_ADJUSTMENT: 'Điều chỉnh giảm (credit)',
} as const;

export const INVOICE_LIFECYCLES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;
export const INVOICE_LIFECYCLE_LABELS = { DRAFT: 'Nháp', PUBLISHED: 'Đã phát hành', CANCELLED: 'Đã hủy' } as const;

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export const PAYMENT_STATUS_LABELS = { UNPAID: 'Chưa thu', PARTIAL: 'Thu một phần', PAID: 'Đã thu đủ' } as const;

export const LINE_GROUPS = ['ADVANCE', 'ARREARS', 'ADJUSTMENT'] as const;
export const LINE_GROUP_LABELS = { ADVANCE: 'Thu trước', ARREARS: 'Thu sau', ADJUSTMENT: 'Điều chỉnh' } as const;

export const invoiceLineSchema = z.object({
  id: z.string().nullable(),
  group: z.enum(LINE_GROUPS),
  charge_kind: z.enum(['RENT', 'SERVICE', 'METER', 'DAMAGE', 'OTHER']),
  charge_timing: z.enum(['ADVANCE', 'ARREARS']),
  direction: z.enum(['DEBIT', 'CREDIT']),
  label: z.string(),
  quantity: z.string(),
  unit_price: z.string(),
  amount_vnd: z.string(),
  charge_start: z.string().nullable(),
  charge_end_exclusive: z.string().nullable(),
  source_key: z.string(),
  unit_key: z.string(),
  corrects_item_id: z.string().nullable(),
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export const blockingErrorSchema = z.object({ code: z.string(), message: z.string() });
export type BlockingError = z.infer<typeof blockingErrorSchema>;

export const invoiceSummarySchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  type: z.enum(INVOICE_TYPES),
  lifecycle: z.enum(INVOICE_LIFECYCLES),
  tenancy_id: z.string(),
  tenancy_code: z.string(),
  tenancy_status: z.string(),
  room_id: z.string(),
  room_code: z.string(),
  building_id: z.string(),
  building_code: z.string(),
  primary_tenant_name: z.string().nullable(),
  /** Tháng phát hành YYYY-MM (thông báo tháng). */
  period: z.string().nullable(),
  issue_date: z.string(),
  due_date: z.string(),
  subtotal_vnd: z.string(),
  discount_vnd: z.string(),
  total_vnd: z.string(),
  /** Đã thanh toán/cấn trừ (Phase 6); chứng từ credit: đã dùng. */
  settled_vnd: z.string(),
  remaining_vnd: z.string(),
  payment_status: z.enum(PAYMENT_STATUSES).nullable(),
  overdue: z.boolean(),
  blocking_errors: z.array(blockingErrorSchema),
  source_invoice_id: z.string().nullable(),
  published_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  version: z.number(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const invoiceDetailSchema = invoiceSummarySchema.extend({
  source_hash: z.string().nullable(),
  source_invoice_number: z.string().nullable(),
  adjustments: z.array(z.object({ id: z.string(), number: z.string().nullable(), type: z.enum(INVOICE_TYPES), total_vnd: z.string(), lifecycle: z.enum(INVOICE_LIFECYCLES) })),
  items: z.array(invoiceLineSchema),
  room_address: z.string().nullable(),
  building_name: z.string(),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const invoiceListQuerySchema = pageQuerySchema.extend({
  period: periodSchema.optional(),
  building_id: uuidSchema.optional(),
  tenancy_id: uuidSchema.optional(),
  lifecycle: z.enum(INVOICE_LIFECYCLES).optional(),
  type: z.enum(INVOICE_TYPES).optional(),
  payment_status: z.enum([...PAYMENT_STATUSES, 'OVERDUE']).optional(),
  q: z.string().trim().max(100).optional(),
});

// ---------- Tính phí ----------

export const billingRunSchema = z.strictObject({
  period: periodSchema,
  building_id: uuidSchema.optional(),
  tenancy_ids: z.array(uuidSchema).max(300).optional(),
});

export const BILLING_RESULT_STATUSES = ['READY', 'BLOCKED', 'CREATED', 'EXISTS', 'DRAFT_PENDING', 'ERROR'] as const;
export const BILLING_RESULT_LABELS = {
  READY: 'Sẵn sàng',
  BLOCKED: 'Có lỗi chặn phát hành',
  CREATED: 'Đã tạo nháp',
  EXISTS: 'Đã có thông báo kỳ này',
  DRAFT_PENDING: 'Còn nháp chưa phát hành',
  ERROR: 'Lỗi',
} as const;

export const billingResultSchema = z.object({
  period: z.string(),
  items: z.array(
    z.object({
      tenancy_id: z.string(),
      tenancy_code: z.string(),
      room_code: z.string(),
      building_code: z.string(),
      primary_tenant_name: z.string().nullable(),
      status: z.enum(BILLING_RESULT_STATUSES),
      invoice_id: z.string().nullable(),
      subtotal_vnd: z.string().nullable(),
      errors: z.array(blockingErrorSchema),
      lines: z.array(invoiceLineSchema),
    }),
  ),
});
export type BillingResult = z.infer<typeof billingResultSchema>;

export const invoiceRecalculateSchema = z.strictObject({ expected_version: expectedVersionSchema });
export const invoiceRecalculateResultSchema = z.object({
  invoice: invoiceDetailSchema,
  changed: z.boolean(),
  before_total_vnd: z.string(),
  after_total_vnd: z.string(),
});

export const invoicePublishSchema = z.strictObject({
  expected_version: expectedVersionSchema,
  /** Băm dữ liệu nguồn của nháp người dùng đang xem; dữ liệu đổi sau đó thì bị từ chối. */
  source_hash: z.string().min(8).max(128),
});
export const invoicePublishResultSchema = z.object({ invoice: invoiceDetailSchema, credit_invoice: invoiceSummarySchema.nullable() });

export const invoiceCancelSchema = z.strictObject({ reason: reasonSchema, expected_version: expectedVersionSchema });

/** “Điều chỉnh ngay”: confirm=false chỉ xem trước, không ghi gì (D-023). */
export const invoiceAdjustSchema = z.strictObject({ confirm: z.boolean().default(false), reason: reasonSchema });
export const invoiceAdjustResultSchema = z.object({
  confirmed: z.boolean(),
  lines: z.array(invoiceLineSchema),
  debit_total_vnd: z.string(),
  credit_total_vnd: z.string(),
  /** Nháp đang mở sẽ được hủy rồi tạo lại sau khi phát hành điều chỉnh. */
  open_draft_id: z.string().nullable(),
  debit_invoice: invoiceSummarySchema.nullable(),
  credit_invoice: invoiceSummarySchema.nullable(),
});

export const statementPeriodSchema = z.object({
  id: z.string(),
  period: z.string(),
  month_start: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  draft_count: z.number(),
  published_count: z.number(),
});
