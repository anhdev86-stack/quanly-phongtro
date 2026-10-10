import { z } from 'zod';
import { expectedVersionSchema, optionalText, pageQuerySchema, reasonSchema } from './common.js';
import { blockingErrorSchema, invoiceLineSchema } from './billing.js';
import { businessDateSchema, moneyVndSchema, uuidSchema } from './primitives.js';
import { paymentMethodSchema, readingValueSchema } from './tenancy.js';

// Phase 7: báo trả, trả phòng, quyết toán (MASTER_PLAN 5.5, 7.5, 7.6, 9.4).

export const NOTICE_STATUS_LABELS = { ACTIVE: 'Đang báo trả', CANCELLED: 'Đã hủy', FULFILLED: 'Đã trả phòng' } as const;

export const noticeCreateSchema = z
  .strictObject({
    notice_date: businessDateSchema,
    planned_last_charge_date: businessDateSchema,
    reason: optionalText(500),
    expected_version: expectedVersionSchema,
  })
  .superRefine((v, ctx) => {
    if (v.planned_last_charge_date < v.notice_date) ctx.addIssue({ code: 'custom', path: ['planned_last_charge_date'], message: 'Ngày dự kiến trả phải từ ngày báo trở đi.' });
  });

export const noticeSchema = z.object({
  id: z.string(),
  tenancy_id: z.string(),
  notice_date: z.string(),
  planned_last_charge_date: z.string(),
  status: z.enum(['ACTIVE', 'CANCELLED', 'FULFILLED']),
  reason: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string(),
  /** Số ngày báo trước so với số ngày yêu cầu theo hợp đồng (cảnh báo, không chặn). */
  short_notice_days: z.number(),
});
export type NoticeDto = z.infer<typeof noticeSchema>;

export const SETTLEMENT_STATUS_LABELS = { DRAFT: 'Nháp', APPROVED: 'Đã duyệt', COMPLETED: 'Đã hoàn tất', CANCELLED: 'Đã hủy' } as const;
export const FINANCIAL_STATUS_LABELS = { BALANCED: 'Đã cân bằng', RECEIVABLE: 'Khách còn nợ', REFUND_PAYABLE: 'Chủ còn phải hoàn' } as const;
export const SETTLEMENT_CHARGE_KINDS = { DAMAGE: 'Hư hỏng', PENALTY: 'Phạt', OTHER: 'Khoản khác' } as const;

const chargeSchema = z.strictObject({
  kind: z.enum(['DAMAGE', 'PENALTY', 'OTHER']),
  amount_vnd: moneyVndSchema,
  reason: z.string().trim().min(3, 'Ghi rõ khoản phí (ít nhất 3 ký tự).').max(300),
});

export const settlementInputSchema = z.strictObject({
  /**
   * Ngày cuối tính tiền phòng (khách ở hết ngày). D-046: mặc định ở giao diện = ngày cuối tháng khách dọn đi — tiền phòng tháng đó đã thu
   * đủ đầu tháng, không tính/hoàn theo ngày; tháng cuối chỉ còn điện nước. Chuyển phòng giữa tháng thì đặt bằng ngày chuyển.
   */
  last_charge_date: businessDateSchema,
  /** Ngày bàn giao thực tế (khách dọn đi): ghi chỉ số cuối ngày này, hoàn tất được từ ngày này. Bỏ trống = ngày cuối tính tiền. */
  handover_date: businessDateSchema.nullish().transform((v) => v ?? null),
  destination_room_status: z.enum(['READY', 'MAINTENANCE']),
  handover_by: optionalText(100),
  inventory_note: optionalText(2000),
  /** Chỉ số cuối kỳ của đồng hồ đang dùng. */
  final_readings: z.array(z.strictObject({ meter_id: uuidSchema, value: readingValueSchema })).max(4).default([]),
  final_reading_waiver: optionalText(500),
  charges: z.array(chargeSchema).max(30).default([]),
  /** Cọc áp vào nợ; bỏ trống = tối đa theo công thức (min(cọc đang giữ, nợ sau credit)). */
  deposit_to_apply_vnd: moneyVndSchema.nullish().transform((v) => v ?? null),
  note: optionalText(1000),
});
export const settlementUpdateSchema = settlementInputSchema.extend({ expected_version: expectedVersionSchema });

export const settlementPreviewSchema = z.object({
  final_lines: z.array(invoiceLineSchema),
  final_debit_vnd: z.string(),
  final_credit_vnd: z.string(),
  drafts_to_cancel: z.array(z.object({ id: z.string(), period: z.string().nullable(), total_vnd: z.string() })),
  old_debts: z.array(z.object({ invoice_id: z.string(), number: z.string().nullable(), due_date: z.string(), remaining_vnd: z.string() })),
  credits: z.array(z.object({ invoice_id: z.string(), number: z.string().nullable(), available_vnd: z.string() })),
  debt_vnd: z.string(),
  credit_vnd: z.string(),
  credit_applied_vnd: z.string(),
  debt_after_credit_vnd: z.string(),
  deposit_available_vnd: z.string(),
  deposit_max_vnd: z.string(),
  deposit_applied_vnd: z.string(),
  customer_receivable_vnd: z.string(),
  credit_refund_payable_vnd: z.string(),
  deposit_refund_payable_vnd: z.string(),
  unstarted_contracts: z.array(z.object({ id: z.string(), code: z.string(), term_start: z.string() })),
  blocking: z.array(blockingErrorSchema),
  warnings: z.array(z.string()),
  input_hash: z.string(),
});
export type SettlementPreview = z.infer<typeof settlementPreviewSchema>;

export const settlementSchema = z.object({
  id: z.string(),
  code: z.string(),
  tenancy_id: z.string(),
  tenancy_code: z.string(),
  room_id: z.string(),
  room_code: z.string(),
  building_code: z.string(),
  building_name: z.string(),
  primary_tenant_name: z.string().nullable(),
  status: z.enum(['DRAFT', 'APPROVED', 'COMPLETED', 'CANCELLED']),
  last_charge_date: z.string(),
  /** Ngày bàn giao thực tế (dữ liệu cũ: = ngày cuối tính tiền). */
  handover_date: z.string(),
  destination_room_status: z.enum(['READY', 'MAINTENANCE']),
  handover_by: z.string().nullable(),
  inventory_note: z.string().nullable(),
  final_reading_waiver: z.string().nullable(),
  final_readings: z.array(z.object({ meter_id: z.string(), meter_type: z.enum(['ELECTRICITY', 'WATER']), value: z.string(), previous_value: z.string().nullable() })),
  charges: z.array(z.object({ id: z.string(), kind: z.enum(['DAMAGE', 'PENALTY', 'OTHER']), amount_vnd: z.string(), reason: z.string() })),
  deposit_to_apply_vnd: z.string().nullable(),
  note: z.string().nullable(),
  approved_by_name: z.string().nullable(),
  approved_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  input_hash: z.string().nullable(),
  /** Số liệu lúc duyệt/chốt (không đổi sau khi hoàn tất). */
  approved_snapshot: settlementPreviewSchema.nullable(),
  /** Tình trạng tài chính hiện tại tính lại từ sổ (MASTER_PLAN 9.1). */
  current: z.object({
    financial_status: z.enum(['BALANCED', 'RECEIVABLE', 'REFUND_PAYABLE']),
    receivable_vnd: z.string(),
    credit_refund_payable_vnd: z.string(),
    deposit_refund_payable_vnd: z.string(),
  }),
  final_invoice_id: z.string().nullable(),
  credit_invoice_id: z.string().nullable(),
  transactions: z.array(z.object({ kind: z.string(), linked_id: z.string(), created_at: z.string() })),
  events: z.array(z.object({ kind: z.string(), linked_entity_type: z.string().nullable(), linked_entity_id: z.string().nullable(), note: z.string().nullable(), created_by_name: z.string().nullable(), created_at: z.string() })),
  version: z.number(),
});
export type SettlementDto = z.infer<typeof settlementSchema>;

export const settlementListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['DRAFT', 'APPROVED', 'COMPLETED', 'CANCELLED']).optional(),
  financial_status: z.enum(['BALANCED', 'RECEIVABLE', 'REFUND_PAYABLE']).optional(),
  building_id: uuidSchema.optional(),
});

export const settlementApproveSchema = z.strictObject({ expected_version: expectedVersionSchema, input_hash: z.string().min(8).max(128) });
export const settlementCompleteSchema = z.strictObject({ expected_version: expectedVersionSchema });
export const settlementCancelSchema = z.strictObject({ reason: reasonSchema, expected_version: expectedVersionSchema });

/** Thu nợ còn lại sau quyết toán / hoàn cọc / hoàn tiền dư khi thực nhận, thực chi. */
export const settlementCashSchema = z.strictObject({
  amount_vnd: moneyVndSchema,
  paid_at: businessDateSchema,
  method: paymentMethodSchema,
  reference: optionalText(100),
  /** Chỉ dùng khi thu nợ: người nhận tiền (D-045). Bỏ trống = người đang ghi. */
  received_by: uuidSchema.nullish().transform((v) => v ?? null),
});
