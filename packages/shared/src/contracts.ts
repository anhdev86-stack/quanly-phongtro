import { z } from 'zod';
import { expectedVersionSchema, optionalText, pageQuerySchema, reasonSchema } from './common.js';
import { businessDateSchema, moneyVndSchema, uuidSchema } from './primitives.js';

export const CONTRACT_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'TERMINATED_EARLY', 'CANCELLED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Nháp',
  SCHEDULED: 'Chưa bắt đầu',
  ACTIVE: 'Đang hiệu lực',
  EXPIRED: 'Đã hết thời hạn',
  TERMINATED_EARLY: 'Kết thúc trước hạn',
  CANCELLED: 'Đã hủy',
};

const termsFields = {
  term_start: businessDateSchema,
  term_end: businessDateSchema,
  notice_days: z.number().int().min(0).max(365).default(30),
  /** Mức cọc yêu cầu theo kỳ này; bỏ trống thì giữ mức hiện hành. */
  deposit_required_vnd: moneyVndSchema.nullish().transform((v) => v ?? null),
  /** Giá thuê theo kỳ này; khác giá hiện hành thì khi ký tạo phiên bản giá mới (source_contract_id). */
  monthly_rent_vnd: moneyVndSchema.nullish().transform((v) => v ?? null),
  terms_note: optionalText(4000),
};

function checkTerm(v: { term_start: string; term_end: string }, ctx: z.RefinementCtx) {
  if (v.term_end < v.term_start) ctx.addIssue({ code: 'custom', path: ['term_end'], message: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
}

export const contractCreateSchema = z
  .strictObject({
    ...termsFields,
    signed: z.boolean().default(false),
    signed_at: businessDateSchema.nullish().transform((v) => v ?? null),
    /** Bắt buộc true nếu giá mới có hiệu lực giữa tháng (MASTER_PLAN 4.4). */
    confirm_mid_month_price: z.boolean().default(false),
  })
  .superRefine(checkTerm);

/** Gia hạn = tạo kỳ hợp đồng mới cùng tenancy (không sửa kỳ cũ). */
export const contractRenewSchema = contractCreateSchema;

export const contractSignSchema = z.strictObject({
  signed_at: businessDateSchema,
  confirm_mid_month_price: z.boolean().default(false),
  expected_version: expectedVersionSchema,
});

export const contractCancelSchema = z.strictObject({ reason: reasonSchema, expected_version: expectedVersionSchema });

export const contractListQuerySchema = pageQuerySchema.extend({
  tenancy_id: uuidSchema.optional(),
  building_id: uuidSchema.optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  /** Hợp đồng đang hiệu lực sẽ hết hạn trong N ngày tới. */
  expiring_within_days: z.coerce.number().int().min(0).max(365).optional(),
});

export const contractTermsSchema = z.object({
  notice_days: z.number(),
  deposit_required_vnd: z.string().nullable(),
  monthly_rent_vnd: z.string().nullable(),
  terms_note: z.string().nullable(),
});

export const contractSchema = z.object({
  id: z.string(),
  code: z.string(),
  tenancy_id: z.string(),
  tenancy_code: z.string(),
  tenancy_status: z.string(),
  room_id: z.string(),
  room_code: z.string(),
  building_code: z.string(),
  primary_tenant_name: z.string().nullable(),
  term_start: z.string(),
  term_end: z.string(),
  lifecycle: z.enum(['DRAFT', 'SIGNED', 'CANCELLED']),
  status: z.enum(CONTRACT_STATUSES),
  signed_at: z.string().nullable(),
  terminated_on: z.string().nullable(),
  previous_contract_id: z.string().nullable(),
  terms: contractTermsSchema,
  /** Số ngày tới khi hết hạn (âm nếu đã hết hạn); null nếu chưa ký hoặc đã hủy. */
  days_to_expiry: z.number().nullable(),
  cancellation_reason: z.string().nullable(),
  version: z.number(),
});
export type ContractDto = z.infer<typeof contractSchema>;

export const contractCancelResultSchema = contractSchema.extend({
  voided_rent_price_ids: z.array(z.string()),
  voided_service_ids: z.array(z.string()),
});
export type ContractCancelResult = z.infer<typeof contractCancelResultSchema>;

// ---------- Giá thuê ----------

export const rentPriceCreateSchema = z
  .strictObject({
    effective_from: businessDateSchema,
    monthly_rent_vnd: moneyVndSchema,
    reason: reasonSchema,
    /**
     * Giảm/đổi giá chỉ cho đúng một tháng (D-022): giá áp dụng từ effective_from (phải là ngày 1)
     * và tự quay về giá cũ từ ngày 1 tháng sau.
     */
    only_month: z.boolean().default(false),
    confirm_mid_month: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.only_month && !v.effective_from.endsWith('-01')) {
      ctx.addIssue({ code: 'custom', path: ['effective_from'], message: 'Giá cho một tháng phải bắt đầu từ ngày 1.' });
    }
  });

// ------------------------------------------------------------------ V1.1 Phase 11: phụ lục hợp đồng

/** POST /contracts/:id/revisions — phụ lục đổi điều khoản của hợp đồng đã ký (ít nhất một điều khoản). */
export const contractRevisionCreateSchema = z
  .strictObject({
    effective_from: businessDateSchema,
    monthly_rent_vnd: moneyVndSchema.nullish().transform((v) => v ?? null),
    term_end: businessDateSchema.nullish().transform((v) => v ?? null),
    deposit_required_vnd: moneyVndSchema.nullish().transform((v) => v ?? null),
    notice_days: z.number().int().min(0).max(365).nullish().transform((v) => v ?? null),
    terms_note: optionalText(4000),
    reason: reasonSchema,
    /** Bắt buộc true nếu giá mới có hiệu lực giữa tháng (MASTER_PLAN 4.4). */
    confirm_mid_month_price: z.boolean().default(false),
    expected_version: expectedVersionSchema,
  })
  .superRefine((v, ctx) => {
    if (v.monthly_rent_vnd === null && v.term_end === null && v.deposit_required_vnd === null && v.notice_days === null && !v.terms_note) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Phụ lục phải đổi ít nhất một điều khoản.' });
    }
  });

export const contractRevisionSchema = z.object({
  id: z.string(),
  revision_no: z.number(),
  effective_from: z.string(),
  changes: z.object({
    monthly_rent_vnd: z.string().nullable(),
    term_end: z.string().nullable(),
    deposit_required_vnd: z.string().nullable(),
    notice_days: z.number().nullable(),
    terms_note: z.string().nullable(),
  }),
  term_end_before: z.string(),
  term_end_after: z.string(),
  reason: z.string(),
  created_by_name: z.string().nullable(),
  created_at: z.string(),
});
export type ContractRevisionDto = z.infer<typeof contractRevisionSchema>;

// ------------------------------------------------------------------ V1.1 Phase 11: cảnh báo hết hạn

/** Mốc cảnh báo hợp đồng sắp hết hạn (ngày trước term_end). */
export const CONTRACT_ALERT_MILESTONES = [30, 15, 7] as const;

export const contractAlertQuerySchema = pageQuerySchema.extend({
  include_acknowledged: z.enum(['true', 'false']).optional(),
  building_id: uuidSchema.optional(),
});

export const contractAlertSchema = z.object({
  id: z.string(),
  contract_id: z.string(),
  contract_code: z.string(),
  tenancy_id: z.string(),
  room_code: z.string(),
  building_code: z.string(),
  primary_tenant_name: z.string().nullable(),
  term_end: z.string(),
  milestone_days: z.number(),
  days_to_expiry: z.number(),
  /** Đã có kỳ hợp đồng ký tiếp (gia hạn) → cảnh báo không còn cần xử lý. */
  renewed: z.boolean(),
  created_at: z.string(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
});
export type ContractAlertDto = z.infer<typeof contractAlertSchema>;
