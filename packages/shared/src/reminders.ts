import { z } from 'zod';
import { expectedVersionSchema, optionalText, pageQuerySchema } from './common.js';
import { uuidSchema } from './primitives.js';

// Phase 8B: nhắc đóng tiền qua Zalo/SMS (MASTER_PLAN 9.7).

export const REMINDER_CHANNELS = ['ZALO_ZNS', 'SMS'] as const;
export const REMINDER_CHANNEL_LABELS = { ZALO_ZNS: 'Zalo ZNS', SMS: 'SMS brandname', LOG_ONLY: 'Chỉ ghi log (không gửi thật)' } as const;
export const REMINDER_STATUS_LABELS = { PENDING: 'Chờ gửi', SENDING: 'Đang gửi', SENT: 'Đã gửi', FAILED: 'Gửi lỗi', SKIPPED: 'Bỏ qua', CANCELLED: 'Đã hủy' } as const;
export const REMINDER_MILESTONE_LABELS = { BEFORE_DUE: 'Trước hạn', DUE: 'Đúng hạn', OVERDUE: 'Quá hạn' } as const;
export const SKIP_REASON_LABELS: Record<string, string> = {
  PAID: 'Đã trả đủ',
  CANCELLED: 'Thông báo đã hủy',
  NOT_PUBLISHED: 'Thông báo chưa phát hành',
  TENANCY_ENDED: 'Lần thuê đã kết thúc (cấu hình không nhắc)',
  OPTED_OUT: 'Người thuê đã tắt nhận tin',
  NO_PHONE: 'Không có số điện thoại hợp lệ',
  DISABLED: 'Đã tắt nhắc đóng tiền',
};

export const reminderSettingsInputSchema = z.strictObject({
  enabled: z.boolean(),
  channel_order: z.array(z.enum(REMINDER_CHANNELS)).min(1).max(2),
  offsets_days: z.array(z.number().int().min(-15).max(30)).min(1).max(3),
  send_hour: z.number().int().min(0).max(23),
  quiet_start: z.number().int().min(0).max(23),
  quiet_end: z.number().int().min(0).max(23),
  send_to_ended: z.boolean(),
  expected_version: expectedVersionSchema.optional(),
});

export const reminderSettingsSchema = z.object({
  enabled: z.boolean(),
  channel_order: z.array(z.enum(REMINDER_CHANNELS)),
  offsets_days: z.array(z.number()),
  send_hour: z.number(),
  quiet_start: z.number(),
  quiet_end: z.number(),
  send_to_ended: z.boolean(),
  version: z.number(),
  channels: z.array(z.object({ code: z.string(), label: z.string(), configured: z.boolean() })),
  /** Đủ ba điều kiện để gửi tin thật (production + đã bật + có adapter thật đã cấu hình). */
  real_sending: z.boolean(),
  note: z.string(),
});
export type ReminderSettingsDto = z.infer<typeof reminderSettingsSchema>;

export const reminderListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED']).optional(),
  building_id: uuidSchema.optional(),
  invoice_id: uuidSchema.optional(),
});

export const reminderSchema = z.object({
  id: z.string(),
  invoice_id: z.string(),
  invoice_number: z.string().nullable(),
  room_code: z.string(),
  building_code: z.string(),
  tenant_name: z.string().nullable(),
  milestone: z.enum(['BEFORE_DUE', 'DUE', 'OVERDUE']),
  scheduled_for: z.string(),
  status: z.enum(['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED']),
  skip_reason: z.string().nullable(),
  channel_used: z.string().nullable(),
  recipient_masked: z.string(),
  remaining_vnd: z.string(),
  attempt_count: z.number(),
  sent_at: z.string().nullable(),
  due_date: z.string(),
  attempts: z.array(z.object({ channel: z.string(), attempted_at: z.string(), result: z.enum(['SUCCESS', 'FAILED']), error_code: z.string().nullable(), error_message: z.string().nullable(), manual: z.boolean() })),
});
export type ReminderDto = z.infer<typeof reminderSchema>;

export const reminderRunResultSchema = z.object({ created: z.number(), sent: z.number(), failed: z.number(), skipped: z.number(), retried: z.number() });

export const reminderConsentSchema = z
  .strictObject({
    opt_in: z.boolean(),
    /** Cách người thuê đồng ý (bắt buộc khi bật), VD “Ký vào phụ lục hợp đồng ngày 06/10”. */
    note: optionalText(300),
    expected_version: expectedVersionSchema,
  })
  .superRefine((v, ctx) => {
    if (v.opt_in && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Ghi lại cách người thuê đồng ý nhận tin.' });
  });
