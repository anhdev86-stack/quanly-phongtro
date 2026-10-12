import { z } from 'zod';
import { optionalText, pageQuerySchema } from './common.js';
import { businessDateSchema, moneyVndSchema, uuidSchema } from './primitives.js';
import { paymentMethodSchema } from './tenancy.js';

// Phase 6: phiếu thu, credit, công nợ, VietQR, link xem thông báo (MASTER_PLAN 8.8, 9.1, 9.6).

/** Ngân hàng nhận chuyển khoản NAPAS 247 (mã BIN 6 số dùng trong VietQR). */
export const VN_BANKS = [
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970422', name: 'MB Bank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970443', name: 'SHB' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970448', name: 'OCB' },
  { bin: '970426', name: 'MSB' },
  { bin: '970431', name: 'Eximbank' },
  { bin: '970440', name: 'SeABank' },
  { bin: '970449', name: 'LPBank' },
  { bin: '970428', name: 'Nam A Bank' },
  { bin: '970427', name: 'VietABank' },
  { bin: '970409', name: 'Bac A Bank' },
  { bin: '970425', name: 'ABBANK' },
  { bin: '970412', name: 'PVcomBank' },
  { bin: '970452', name: 'KienlongBank' },
  { bin: '970454', name: 'Viet Capital Bank' },
  { bin: '970406', name: 'Vikki Bank (DongA)' },
] as const;

export const PAYMENT_METHOD_HINT = 'Phương thức chỉ là nhãn; QR = khách quét VietQR, nhập mã giao dịch ngân hàng vào ô tham chiếu.';

// ---------- Phiếu thu ----------
// Lý do đảo dùng `reverseSchema` của tenancy.ts.

export const paymentCreateSchema = z
  .strictObject({
    tenancy_id: uuidSchema,
    amount_vnd: moneyVndSchema,
    method: paymentMethodSchema,
    /** Ngày thực nhận. */
    paid_at: businessDateSchema,
    reference: optionalText(100),
    note: optionalText(500),
    /** Người nhận tiền (D-045): chủ trọ hoặc quản lý có quyền thu tiền ở tòa này. Bỏ trống = người đang ghi phiếu. */
    received_by: uuidSchema.nullish().transform((v) => v ?? null),
    /** Phân bổ vào thông báo đã phát hành của cùng lần thuê; tổng phải bằng số tiền (không có ví trả trước). */
    allocations: z.array(z.strictObject({ invoice_id: uuidSchema, amount_vnd: moneyVndSchema })).min(1).max(24),
  })
  .superRefine((v, ctx) => {
    const sum = v.allocations.reduce((s, a) => s + BigInt(a.amount_vnd), 0n);
    if (sum !== BigInt(v.amount_vnd)) ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Tổng phân bổ phải bằng số tiền thu.' });
    if (new Set(v.allocations.map((a) => a.invoice_id)).size !== v.allocations.length) ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Thông báo bị trùng.' });
  });

export const POSTING_STATUS_LABELS = { POSTED: 'Đã ghi', REVERSED: 'Đã đảo' } as const;

export const paymentSchema = z.object({
  id: z.string(),
  number: z.string(),
  tenancy_id: z.string(),
  tenancy_code: z.string(),
  room_code: z.string(),
  building_code: z.string(),
  building_name: z.string(),
  primary_tenant_name: z.string().nullable(),
  amount_vnd: z.string(),
  method: paymentMethodSchema,
  paid_at: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(['POSTED', 'REVERSED']),
  reversed_at: z.string().nullable(),
  reversal_reason: z.string().nullable(),
  /** Người nhận tiền (D-045). */
  received_by_name: z.string().nullable(),
  created_by_name: z.string().nullable(),
  /** MANUAL: người dùng ghi; BANK_AUTO: tự động từ giao dịch ngân hàng; BANK_RECONCILE: đối chiếu tay một giao dịch ngân hàng (D-047). */
  source: z.enum(['MANUAL', 'BANK_AUTO', 'BANK_RECONCILE']),
  created_at: z.string(),
  allocations: z.array(z.object({ invoice_id: z.string(), invoice_number: z.string().nullable(), period: z.string().nullable(), amount_vnd: z.string() })),
});
export type PaymentDto = z.infer<typeof paymentSchema>;

/** Người có thể nhận tiền của một lần thuê: tài khoản đang hoạt động có quyền thu tiền ở tòa của phòng (D-045). */
export const paymentReceiversSchema = z.array(z.object({ id: z.string(), display_name: z.string() }));

export const paymentListQuerySchema = pageQuerySchema.extend({
  tenancy_id: uuidSchema.optional(),
  invoice_id: uuidSchema.optional(),
  building_id: uuidSchema.optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  status: z.enum(['POSTED', 'REVERSED']).optional(),
});

// ---------- Credit ----------

export const creditApplySchema = z.strictObject({
  credit_invoice_id: uuidSchema,
  /** Bỏ trống: cấn trừ lần lượt vào các thông báo còn nợ, đến hạn sớm nhất trước (MASTER_PLAN 8.8). */
  target_invoice_id: uuidSchema.optional(),
  /** Bỏ trống: dùng tối đa phần credit còn lại. */
  amount_vnd: moneyVndSchema.optional(),
});

export const creditRefundCreateSchema = z.strictObject({
  credit_invoice_id: uuidSchema,
  amount_vnd: moneyVndSchema,
  paid_at: businessDateSchema,
  method: paymentMethodSchema,
  reference: optionalText(100),
});

/** Các khoản đã thu/cấn trừ của một thông báo (hoặc đã dùng, với chứng từ credit). */
export const invoiceSettlementsSchema = z.object({
  payments: z.array(
    z.object({
      payment_id: z.string(),
      number: z.string(),
      amount_vnd: z.string(),
      method: paymentMethodSchema,
      paid_at: z.string(),
      reference: z.string().nullable(),
      status: z.enum(['POSTED', 'REVERSED']),
      /** Người nhận tiền (D-045). */
      received_by_name: z.string().nullable(),
    }),
  ),
  deposits: z.array(z.object({ deposit_transaction_id: z.string(), amount_vnd: z.string(), paid_at: z.string().nullable(), active: z.boolean() })),
  credits_received: z.array(z.object({ id: z.string(), credit_invoice_id: z.string(), credit_invoice_number: z.string().nullable(), amount_vnd: z.string(), status: z.enum(['ACTIVE', 'REVERSED']) })),
  credits_given: z.array(z.object({ id: z.string(), target_invoice_id: z.string(), target_invoice_number: z.string().nullable(), amount_vnd: z.string(), status: z.enum(['ACTIVE', 'REVERSED']) })),
  refunds: z.array(z.object({ id: z.string(), amount_vnd: z.string(), paid_at: z.string(), method: paymentMethodSchema, reference: z.string().nullable(), status: z.enum(['POSTED', 'REVERSED']) })),
});
export type InvoiceSettlements = z.infer<typeof invoiceSettlementsSchema>;

// ---------- Công nợ và sao kê ----------

export const debtQuerySchema = pageQuerySchema.extend({
  building_id: uuidSchema.optional(),
  overdue_only: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const debtRowSchema = z.object({
  tenancy_id: z.string(),
  tenancy_code: z.string(),
  tenancy_status: z.string(),
  room_id: z.string(),
  room_code: z.string(),
  building_code: z.string(),
  primary_tenant_name: z.string().nullable(),
  open_invoices: z.number(),
  debt_vnd: z.string(),
  overdue_vnd: z.string(),
  oldest_due_date: z.string().nullable(),
  credit_available_vnd: z.string(),
});
export type DebtRow = z.infer<typeof debtRowSchema>;

export const debtListSchema = z.object({
  items: z.array(debtRowSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  totals: z.object({ debt_vnd: z.string(), overdue_vnd: z.string(), credit_available_vnd: z.string() }),
});

export const STATEMENT_ENTRY_LABELS = {
  INVOICE: 'Thông báo',
  CREDIT_NOTE: 'Chứng từ credit',
  PAYMENT: 'Phiếu thu',
  PAYMENT_REVERSED: 'Đảo phiếu thu',
  DEPOSIT_APPLIED: 'Trừ vào cọc',
  DEPOSIT_APPLIED_REVERSED: 'Đảo trừ cọc',
  CREDIT_REFUND: 'Hoàn tiền credit',
  CREDIT_REFUND_REVERSED: 'Đảo hoàn credit',
} as const;

export const statementSchema = z.object({
  tenancy_id: z.string(),
  tenancy_code: z.string(),
  room_code: z.string(),
  entries: z.array(
    z.object({
      date: z.string(),
      kind: z.enum(Object.keys(STATEMENT_ENTRY_LABELS) as [keyof typeof STATEMENT_ENTRY_LABELS, ...(keyof typeof STATEMENT_ENTRY_LABELS)[]]),
      ref_id: z.string(),
      ref_number: z.string().nullable(),
      description: z.string(),
      /** Làm tăng số phải thu. */
      debit_vnd: z.string(),
      /** Làm giảm số phải thu. */
      credit_vnd: z.string(),
      balance_vnd: z.string(),
    }),
  ),
  /** Số dư cuối = Σ còn nợ − Σ credit còn lại (âm = đang nợ khách). */
  balance_vnd: z.string(),
  debt_vnd: z.string(),
  credit_available_vnd: z.string(),
});
export type Statement = z.infer<typeof statementSchema>;

// ---------- Tài khoản nhận tiền và VietQR ----------

export const paymentAccountInputSchema = z.strictObject({
  bank_bin: z.string().regex(/^\d{6}$/, 'Chọn ngân hàng.'),
  account_number: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{4,19}$/, 'Số tài khoản 4–19 ký tự chữ/số.'),
  account_name: z
    .string()
    .trim()
    .min(2, 'Nhập tên chủ tài khoản.')
    .max(50),
  expected_version: z.number().int().min(1).optional(),
});

export const paymentAccountSchema = z.object({
  id: z.string(),
  bank_bin: z.string(),
  bank_name: z.string(),
  account_number: z.string(),
  account_name: z.string(),
  is_demo: z.boolean(),
  version: z.number(),
  updated_at: z.string(),
});
export type PaymentAccountDto = z.infer<typeof paymentAccountSchema>;

export const vietQrSchema = z.object({
  payload: z.string(),
  bank_bin: z.string(),
  bank_name: z.string(),
  account_number: z.string(),
  account_name: z.string(),
  amount_vnd: z.string(),
  content: z.string(),
  /** Đang dùng tài khoản demo — không chuyển tiền thật. */
  is_demo: z.boolean(),
  /** Tích hợp ngân hàng đang ở môi trường thử nghiệm (mock/test) — hiện “Môi trường thử nghiệm — không chuyển tiền thật” (D-047). */
  test_mode: z.boolean(),
});
export type VietQrDto = z.infer<typeof vietQrSchema>;

// ---------- Link xem thông báo ----------

export const shareLinkSchema = z.object({
  id: z.string(),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  created_by_name: z.string().nullable(),
  view_count: z.number(),
  last_viewed_at: z.string().nullable(),
  active: z.boolean(),
});
export const shareLinkCreatedSchema = shareLinkSchema.extend({
  /** Chỉ trả một lần lúc tạo; DB chỉ lưu hash. */
  token: z.string(),
  path: z.string(),
});

export const publicInvoiceSchema = z.object({
  workspace_name: z.string(),
  building_name: z.string(),
  room_code: z.string(),
  number: z.string().nullable(),
  type: z.string(),
  period: z.string().nullable(),
  issue_date: z.string(),
  due_date: z.string(),
  items: z.array(z.object({ group: z.string(), label: z.string(), direction: z.enum(['DEBIT', 'CREDIT']), amount_vnd: z.string() })),
  total_vnd: z.string(),
  settled_vnd: z.string(),
  remaining_vnd: z.string(),
  qr: vietQrSchema.nullable(),
});
export type PublicInvoice = z.infer<typeof publicInvoiceSchema>;
