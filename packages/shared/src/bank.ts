import { z } from 'zod';
import { optionalText, pageQuerySchema, reasonSchema } from './common.js';
import { moneyVndSchema, uuidSchema } from './primitives.js';

// Giao dịch ngân hàng tự động (D-047): webhook từ nhà cung cấp → lưu → đối chiếu theo mã thanh toán → phiếu thu.

export const BANK_INTEGRATION_MODES = ['off', 'mock', 'test', 'live'] as const;
export type BankIntegrationMode = (typeof BANK_INTEGRATION_MODES)[number];

export const bankTransactionStatusSchema = z.enum(['RECEIVED', 'MATCHED', 'PENDING_REVIEW', 'ERROR', 'NOT_APPLICABLE']);
export type BankTransactionStatus = z.infer<typeof bankTransactionStatusSchema>;

export const BANK_TRANSACTION_STATUS_LABELS: Record<BankTransactionStatus, string> = {
  RECEIVED: 'Đang xử lý',
  MATCHED: 'Đã đối chiếu',
  PENDING_REVIEW: 'Chờ đối chiếu',
  ERROR: 'Lỗi',
  NOT_APPLICABLE: 'Không áp dụng',
};

export const BANK_ENVIRONMENT_LABELS = { MOCK: 'Giả lập (mock)', TEST: 'Thử nghiệm', LIVE: 'Thật' } as const;

export const bankConfigSchema = z.object({
  mode: z.enum(BANK_INTEGRATION_MODES),
  provider: z.string().nullable(),
  /** Đường dẫn webhook để khai báo với nhà cung cấp (tương đối với API). */
  webhook_path: z.string().nullable(),
  /** Công cụ giả lập chỉ bật khi mode = mock (kiểm tra ở backend). */
  simulator_enabled: z.boolean(),
  sync_supported: z.boolean(),
  last_synced_at: z.string().nullable(),
  last_sync_error: z.string().nullable(),
  /** Tài khoản nhận tiền đang dùng để đối chiếu. */
  account_number: z.string().nullable(),
});
export type BankConfigDto = z.infer<typeof bankConfigSchema>;

export const bankTransactionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  environment: z.enum(['MOCK', 'TEST', 'LIVE']),
  provider_transaction_id: z.string(),
  account_number: z.string(),
  direction: z.enum(['IN', 'OUT']),
  amount_vnd: z.string(),
  currency: z.string(),
  content: z.string(),
  reference_code: z.string().nullable(),
  occurred_at: z.string(),
  received_at: z.string(),
  /** WEBHOOK: nhận qua webhook; SYNC: lấy bù qua API đối soát. */
  source: z.enum(['WEBHOOK', 'SYNC']),
  status: bankTransactionStatusSchema,
  reason: z.string().nullable(),
  payment_code: z.string().nullable(),
  invoice: z.object({ id: z.string(), number: z.string().nullable(), room_code: z.string(), building_code: z.string() }).nullable(),
  /** Đã phân bổ vào phiếu thu còn hiệu lực. */
  allocated_vnd: z.string(),
  /** Phần đánh dấu không áp dụng (đã xử lý ngoài hệ thống). */
  dismissed_vnd: z.string(),
  unallocated_vnd: z.string(),
  payments: z.array(
    z.object({ payment_id: z.string(), number: z.string(), amount_vnd: z.string(), status: z.enum(['POSTED', 'REVERSED']), link: z.enum(['CREATED', 'LINKED_EXISTING']), tenancy_id: z.string() }),
  ),
  resolved_by_name: z.string().nullable(),
  resolved_at: z.string().nullable(),
  resolution_note: z.string().nullable(),
  /** Giao dịch tạo bằng công cụ giả lập: id trong “ngân hàng giả” để gửi lại webhook. */
  mock_id: z.string().nullable(),
});
export type BankTransactionDto = z.infer<typeof bankTransactionSchema>;

export const bankTransactionListQuerySchema = pageQuerySchema.extend({
  status: bankTransactionStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

/** Gợi ý cho đối chiếu thủ công: thông báo còn nợ và phiếu thu chuyển khoản chưa liên kết (trong phạm vi tòa). */
export const bankReconcileOptionsSchema = z.object({
  open_invoices: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      tenancy_id: z.string(),
      room_code: z.string(),
      building_code: z.string(),
      primary_tenant_name: z.string().nullable(),
      remaining_vnd: z.string(),
      due_date: z.string(),
      matches_code: z.boolean(),
    }),
  ),
  unlinked_payments: z.array(
    z.object({ id: z.string(), number: z.string(), amount_vnd: z.string(), method: z.string(), paid_at: z.string(), reference: z.string().nullable(), room_code: z.string(), invoice_numbers: z.array(z.string()) }),
  ),
});
export type BankReconcileOptions = z.infer<typeof bankReconcileOptionsSchema>;

export const bankAllocateSchema = z.strictObject({
  invoice_id: uuidSchema,
  amount_vnd: moneyVndSchema,
  /** Người nhận tiền: mặc định người quản lý tài khoản nhận (người cấu hình tài khoản VietQR). */
  received_by: uuidSchema.nullish().transform((v) => v ?? null),
  note: optionalText(500),
});

export const bankLinkPaymentSchema = z.strictObject({ payment_id: uuidSchema, note: optionalText(500) });

export const bankDismissSchema = z.strictObject({ reason: reasonSchema });

export const bankSimulateSchema = z.strictObject({
  amount_vnd: moneyVndSchema,
  content: z.string().trim().min(1).max(200),
  direction: z.enum(['IN', 'OUT']).default('IN'),
  /** Bỏ trống = tài khoản nhận tiền đang dùng. */
  account_number: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{1,19}$/)
    .nullish()
    .transform((v) => v ?? null),
  /** WEBHOOK: gửi ngay; LOST: mô phỏng webhook bị mất (lấy bù bằng Đồng bộ); BAD_SIGNATURE: gửi kèm khóa sai. */
  delivery: z.enum(['WEBHOOK', 'LOST', 'BAD_SIGNATURE']).default('WEBHOOK'),
});

export const bankSimulateResultSchema = z.object({
  mock_id: z.string(),
  delivery: z.enum(['WEBHOOK', 'LOST', 'BAD_SIGNATURE']),
  webhook_status: z.number().nullable(),
  transaction: bankTransactionSchema.nullable(),
});

export const bankSyncResultSchema = z.object({ fetched: z.number(), created: z.number(), duplicates: z.number(), last_provider_id: z.string().nullable() });
export type BankSyncResult = z.infer<typeof bankSyncResultSchema>;
