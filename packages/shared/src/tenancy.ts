import { z } from 'zod';
import { expectedVersionSchema, optionalPhone, optionalText, pageQuerySchema, reasonSchema } from './common.js';
import { businessDateSchema, moneyVndSchema, uuidSchema } from './primitives.js';

// ---------- Nhãn ----------

export const GENDER_LABELS = { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' } as const;
export const RESIDENCE_LABELS = { NOT_REGISTERED: 'Chưa đăng ký', REGISTERED: 'Đã đăng ký', NOT_APPLICABLE: 'Không áp dụng' } as const;
export const TENANCY_STATUS_LABELS = {
  ACTIVE: 'Đang thuê',
  NOTICE_GIVEN: 'Đã báo trả',
  MOVE_OUT_PROCESSING: 'Đang trả phòng',
  ENDED: 'Đã kết thúc',
} as const;
export const PAYMENT_METHOD_LABELS = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', QR: 'Quét QR', OTHER: 'Khác' } as const;
export const DEPOSIT_TX_LABELS = {
  RECEIVED: 'Nhận cọc',
  TOP_UP: 'Nhận thêm cọc',
  CONVERTED_FROM_HOLDING: 'Chuyển từ tiền giữ chỗ',
  APPLIED_TO_INVOICE: 'Trừ vào thông báo',
  DEDUCTION: 'Khấu trừ',
  REFUND: 'Hoàn cọc',
  REVERSAL: 'Đảo giao dịch',
  TRANSFER_OUT: 'Chuyển cọc sang phòng mới',
  TRANSFER_IN: 'Nhận cọc từ phòng cũ',
} as const;
export const HOLDING_TX_LABELS = {
  RECEIVED: 'Nhận tiền giữ chỗ',
  CONVERTED_TO_DEPOSIT: 'Chuyển thành cọc',
  REFUND: 'Hoàn tiền giữ chỗ',
  FORFEIT: 'Giữ lại theo thỏa thuận',
  REVERSAL: 'Đảo giao dịch',
} as const;
export const METER_TYPE_LABELS = { ELECTRICITY: 'Điện', WATER: 'Nước' } as const;

export const paymentMethodSchema = z.enum(['CASH', 'BANK_TRANSFER', 'QR', 'OTHER']);
export const meterTypeSchema = z.enum(['ELECTRICITY', 'WATER']);

/** Chỉ số đồng hồ: số không âm, tối đa 2 chữ số thập phân, dạng chuỗi (không dùng số thực). */
export const readingValueSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Chỉ số không hợp lệ (số không âm, tối đa 2 chữ số thập phân).');

// ---------- Người thuê ----------

export const identityNumberSchema = z
  .string()
  .trim()
  .regex(/^(\d{9}|\d{12})$/, 'Số CCCD/CMND phải gồm 9 hoặc 12 chữ số.');

export const tenantInputSchema = z.strictObject({
  full_name: z.string().trim().min(1, 'Vui lòng nhập họ tên.').max(120),
  birth_date: businessDateSchema.nullish().transform((v) => v ?? null),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullish().transform((v) => v ?? null),
  phone: optionalPhone,
  email: z
    .union([z.literal(''), z.email('Email không hợp lệ.')])
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null)),
  identity_number: z
    .union([z.literal(''), identityNumberSchema])
    .nullish()
    .transform((v) => (v ? v : null)),
  issue_date: businessDateSchema.nullish().transform((v) => v ?? null),
  issue_place: optionalText(200),
  permanent_address: optionalText(300),
  hometown: optionalText(200),
  note: optionalText(1000),
});
export type TenantInput = z.input<typeof tenantInputSchema>;

export const tenantUpdateSchema = tenantInputSchema.partial().extend({ expected_version: expectedVersionSchema });

export const tenantListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  include_archived: z.enum(['true', 'false']).default('false'),
});

export const tenantSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  birth_date: z.string().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** Đầy đủ chỉ khi có quyền sensitive_data.view; ngược lại dạng ********1234. */
  identity_number: z.string().nullable(),
  identity_masked: z.boolean(),
  issue_date: z.string().nullable(),
  issue_place: z.string().nullable(),
  permanent_address: z.string().nullable(),
  hometown: z.string().nullable(),
  note: z.string().nullable(),
  reminder_opt_in: z.boolean(),
  reminder_consent_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  version: z.number(),
  current_room: z.string().nullable(),
  /** Người khác có cùng số CCCD (cảnh báo để xác minh, không chặn). */
  duplicate_identity: z.array(z.object({ id: z.string(), full_name: z.string() })),
});
export type TenantDto = z.infer<typeof tenantSchema>;

// ---------- Nhận phòng ----------

export const personRefSchema = z.union([
  z.strictObject({ tenant_id: uuidSchema }),
  z.strictObject({ new_tenant: tenantInputSchema }),
]);

export const moveInSchema = z
  .strictObject({
    room_id: uuidSchema,
    start_date: businessDateSchema,
    reservation_id: uuidSchema.nullish().transform((v) => v ?? null),
    primary: personRefSchema,
    members: z.array(personRefSchema).max(20).default([]),
    monthly_rent_vnd: moneyVndSchema,
    billing_due_day: z.number().int().min(1).max(31).default(5),
    deposit_required_vnd: moneyVndSchema.default('0'),
    deposit_received: z
      .strictObject({
        amount_vnd: moneyVndSchema.refine((v) => v !== '0', 'Số tiền phải lớn hơn 0.'),
        method: paymentMethodSchema,
        paid_at: businessDateSchema,
        reference: optionalText(100),
      })
      .nullish()
      .transform((v) => v ?? null),
    services: z
      .array(z.strictObject({ service_id: uuidSchema, quantity: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, 'Số lượng không hợp lệ.') }))
      .max(30)
      .default([]),
    meter_readings: z.array(z.strictObject({ type: meterTypeSchema, value: readingValueSchema })).max(2).default([]),
    /** Hợp đồng kèm khi nhận phòng (Phase 3). */
    contract: z
      .strictObject({
        term_start: businessDateSchema,
        term_end: businessDateSchema,
        signed: z.boolean(),
        signed_at: businessDateSchema.nullish().transform((v) => v ?? null),
        notice_days: z.number().int().min(0).max(365).default(30),
        terms_note: optionalText(4000),
      })
      .nullish()
      .transform((v) => v ?? null),
    note: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    const ids = [v.primary, ...v.members].filter((p) => 'tenant_id' in p).map((p) => (p as { tenant_id: string }).tenant_id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['members'], message: 'Một người bị nhập trùng.' });
    if (new Set(v.services.map((s) => s.service_id)).size !== v.services.length) {
      ctx.addIssue({ code: 'custom', path: ['services'], message: 'Dịch vụ bị trùng.' });
    }
    if (new Set(v.meter_readings.map((m) => m.type)).size !== v.meter_readings.length) {
      ctx.addIssue({ code: 'custom', path: ['meter_readings'], message: 'Loại đồng hồ bị trùng.' });
    }
    if (v.contract && v.contract.term_end < v.contract.term_start) {
      ctx.addIssue({ code: 'custom', path: ['contract', 'term_end'], message: 'Ngày kết thúc phải sau ngày bắt đầu.' });
    }
  });
export type MoveInInput = z.input<typeof moveInSchema>;

// ---------- Lần thuê ----------

export const tenancyListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['ACTIVE', 'NOTICE_GIVEN', 'MOVE_OUT_PROCESSING', 'ENDED', 'OPEN']).optional(),
  building_id: uuidSchema.optional(),
  room_id: uuidSchema.optional(),
  tenant_id: uuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

export const memberSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  full_name: z.string(),
  phone: z.string().nullable(),
  role: z.enum(['PRIMARY', 'MEMBER']),
  joined_on: z.string(),
  /** Ngày cuối cùng ở (bao gồm), null nếu đang ở. */
  left_on: z.string().nullable(),
  residence_status: z.enum(['NOT_REGISTERED', 'REGISTERED', 'NOT_APPLICABLE']),
  residence_registered_on: z.string().nullable(),
  residence_note: z.string().nullable(),
  version: z.number(),
});

export const tenancySummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  room_id: z.string(),
  room_code: z.string(),
  building_code: z.string(),
  status: z.enum(['ACTIVE', 'NOTICE_GIVEN', 'MOVE_OUT_PROCESSING', 'ENDED']),
  start_date: z.string(),
  /** Ngày cuối tính tiền (bao gồm), null khi chưa trả phòng. */
  last_charge_date: z.string().nullable(),
  primary_tenant_name: z.string().nullable(),
  member_count: z.number(),
  current_rent_vnd: z.string().nullable(),
  deposit_held_vnd: z.string(),
  rental_mode: z.enum(['FIXED_TERM', 'MONTH_TO_MONTH']),
  version: z.number(),
});
export type TenancySummary = z.infer<typeof tenancySummarySchema>;

export const rentPriceSchema = z.object({
  id: z.string(),
  effective_from: z.string(),
  monthly_rent_vnd: z.string(),
  source_contract_id: z.string().nullable(),
  reason: z.string().nullable(),
  status: z.enum(['ACTIVE', 'VOIDED']),
  void_reason: z.string().nullable(),
});

export const tenancyServiceSchema = z.object({
  id: z.string(),
  service_id: z.string(),
  service_name: z.string(),
  service_type: z.string(),
  unit: z.string(),
  effective_from: z.string(),
  end_exclusive: z.string().nullable(),
  quantity: z.string(),
  status: z.enum(['ACTIVE', 'VOIDED']),
});

export const depositSummarySchema = z.object({
  required_vnd: z.string(),
  held_vnd: z.string(),
  received_vnd: z.string(),
  applied_vnd: z.string(),
  deducted_vnd: z.string(),
  refunded_vnd: z.string(),
  /** Còn thiếu so với mức yêu cầu (≥ 0). */
  shortfall_vnd: z.string(),
  /** Đang giữ vượt mức yêu cầu (≥ 0). */
  excess_vnd: z.string(),
});

export const tenancyDetailSchema = tenancySummarySchema.extend({
  billing_due_day: z.number(),
  notice_days: z.number(),
  note: z.string().nullable(),
  actual_move_out_date: z.string().nullable(),
  reservation_id: z.string().nullable(),
  members: z.array(memberSchema),
  rent_prices: z.array(rentPriceSchema),
  services: z.array(tenancyServiceSchema),
  deposit: depositSummarySchema,
  initial_readings: z.array(z.object({ type: z.string(), value: z.string(), read_on: z.string() })),
});
export type TenancyDetail = z.infer<typeof tenancyDetailSchema>;

// ---------- Thành viên ----------

export const memberAddSchema = z.strictObject({
  person: personRefSchema,
  joined_on: businessDateSchema,
  expected_version: expectedVersionSchema,
});

export const memberLeaveSchema = z.strictObject({
  /** Ngày cuối cùng ở (bao gồm). */
  last_day: businessDateSchema,
  /** Bắt buộc khi người rời đi là PRIMARY. */
  new_primary_member_id: uuidSchema.nullish().transform((v) => v ?? null),
  expected_version: expectedVersionSchema,
});

export const memberSetPrimarySchema = z.strictObject({ expected_version: expectedVersionSchema });

export const memberResidenceSchema = z.strictObject({
  residence_status: z.enum(['NOT_REGISTERED', 'REGISTERED', 'NOT_APPLICABLE']),
  residence_registered_on: businessDateSchema.nullish().transform((v) => v ?? null),
  residence_note: optionalText(500),
  expected_version: expectedVersionSchema,
});

// ---------- Cọc ----------

export const depositTxCreateSchema = z
  .strictObject({
    type: z.enum(['RECEIVED', 'TOP_UP', 'REFUND', 'DEDUCTION']),
    amount_vnd: moneyVndSchema.refine((v) => v !== '0', 'Số tiền phải lớn hơn 0.'),
    paid_at: businessDateSchema,
    method: paymentMethodSchema.nullish().transform((v) => v ?? null),
    reference: optionalText(100),
    reason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if ((v.type === 'REFUND' || v.type === 'DEDUCTION') && (!v.reason || v.reason.length < 3)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Vui lòng nhập lý do.' });
    }
    if (v.type !== 'DEDUCTION' && !v.method) ctx.addIssue({ code: 'custom', path: ['method'], message: 'Chọn phương thức.' });
  });

export const reverseSchema = z.strictObject({ reason: reasonSchema });

export const ledgerTxSchema = z.object({
  id: z.string(),
  type: z.string(),
  amount_vnd: z.string(),
  /** Số tiền có dấu theo ảnh hưởng tới số dư. */
  signed_amount_vnd: z.string(),
  reason: z.string().nullable(),
  paid_at: z.string().nullable(),
  method: z.string().nullable(),
  reference: z.string().nullable(),
  reverses_transaction_id: z.string().nullable(),
  reversed: z.boolean(),
  linked_transaction_id: z.string().nullable(),
  created_at: z.string(),
  created_by_name: z.string().nullable(),
});
export type LedgerTxDto = z.infer<typeof ledgerTxSchema>;

export const depositLedgerSchema = z.object({ summary: depositSummarySchema, transactions: z.array(ledgerTxSchema) });

// ---------- Tiền giữ chỗ ----------

export const holdingTxCreateSchema = z
  .strictObject({
    type: z.enum(['RECEIVED', 'REFUND', 'FORFEIT']),
    amount_vnd: moneyVndSchema.refine((v) => v !== '0', 'Số tiền phải lớn hơn 0.'),
    paid_at: businessDateSchema,
    method: paymentMethodSchema.nullish().transform((v) => v ?? null),
    reference: optionalText(100),
    reason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.type !== 'RECEIVED' && (!v.reason || v.reason.length < 3)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Vui lòng nhập lý do.' });
    }
    if (v.type !== 'FORFEIT' && !v.method) ctx.addIssue({ code: 'custom', path: ['method'], message: 'Chọn phương thức.' });
  });

export const holdingLedgerSchema = z.object({ balance_vnd: z.string(), transactions: z.array(ledgerTxSchema) });

// ---------- Dịch vụ (danh mục, Phase 4 mở rộng) ----------

export const SERVICE_TYPE_LABELS = {
  FIXED_ROOM: 'Cố định theo phòng',
  PER_PERSON: 'Theo đầu người',
  QUANTITY: 'Theo số lượng',
  METER: 'Theo đồng hồ',
} as const;

export const serviceSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.enum(['FIXED_ROOM', 'PER_PERSON', 'QUANTITY', 'METER']),
  unit: z.string(),
  charge_timing: z.enum(['ADVANCE', 'ARREARS']),
  meter_type: z.enum(['ELECTRICITY', 'WATER']).nullable(),
  archived_at: z.string().nullable(),
  version: z.number(),
});
export type ServiceDto = z.infer<typeof serviceSchema>;
