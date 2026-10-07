import { z } from 'zod';
import { expectedVersionSchema, optionalText, pageQuerySchema, reasonSchema } from './common.js';
import { uuidSchema } from './primitives.js';

// V1.1 Phase 13: tệp riêng tư, yêu cầu bảo trì (MASTER_PLAN 6.7, 11.4).

export const FILE_CATEGORIES = ['IDENTITY', 'CONTRACT_SCAN', 'METER_PHOTO', 'MAINTENANCE_PHOTO', 'RECEIPT', 'OTHER'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  IDENTITY: 'Giấy tờ tùy thân (CCCD…)',
  CONTRACT_SCAN: 'Bản scan hợp đồng',
  METER_PHOTO: 'Ảnh đồng hồ',
  MAINTENANCE_PHOTO: 'Ảnh bảo trì',
  RECEIPT: 'Chứng từ, hóa đơn',
  OTHER: 'Khác',
};
export const FILE_OWNER_TYPES = ['tenant', 'tenancy', 'contract', 'meter_reading', 'maintenance_request', 'expense'] as const;
export type FileOwnerType = (typeof FILE_OWNER_TYPES)[number];
/** Định dạng nhận: ảnh và PDF, tối đa 10 MB; nội dung được kiểm tra chữ ký tệp, không tin phần mở rộng. */
export const FILE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const FILE_MAX_BYTES = 10 * 1024 * 1024;

/** Các trường form multipart kèm tệp (`file`). */
export const fileUploadFieldsSchema = z.strictObject({
  owner_type: z.enum(FILE_OWNER_TYPES),
  owner_id: uuidSchema,
  category: z.enum(FILE_CATEGORIES),
});
export const fileListQuerySchema = z.object({ owner_type: z.enum(FILE_OWNER_TYPES), owner_id: uuidSchema, include_archived: z.enum(['true', 'false']).optional() });
export const fileArchiveSchema = z.strictObject({ reason: reasonSchema });

export const fileSchema = z.object({
  id: z.string(),
  original_name: z.string(),
  mime: z.string(),
  size_bytes: z.number(),
  category: z.enum(FILE_CATEGORIES),
  owner_type: z.string(),
  owner_id: z.string(),
  uploaded_by_name: z.string().nullable(),
  created_at: z.string(),
  archived_at: z.string().nullable(),
  archive_reason: z.string().nullable(),
  /** Đường dẫn tải (cùng origin, kiểm tra quyền mỗi lần tải). */
  url: z.string(),
});
export type FileDto = z.infer<typeof fileSchema>;

// ------------------------------------------------------------------ Bảo trì

export const MAINTENANCE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const MAINTENANCE_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const MAINTENANCE_PRIORITY_LABELS = { LOW: 'Thấp', NORMAL: 'Bình thường', HIGH: 'Cao', URGENT: 'Khẩn cấp' } as const;
export const MAINTENANCE_STATUS_LABELS = { OPEN: 'Mới', IN_PROGRESS: 'Đang xử lý', DONE: 'Đã xong', CANCELLED: 'Đã hủy' } as const;

export const maintenanceCreateSchema = z.strictObject({
  room_id: uuidSchema,
  title: z.string().trim().min(3, 'Nhập nội dung ngắn gọn (tối thiểu 3 ký tự).').max(200),
  description: optionalText(4000),
  priority: z.enum(MAINTENANCE_PRIORITIES).default('NORMAL'),
  reported_by: optionalText(120),
  assignee_id: uuidSchema.nullish().transform((v) => v ?? null),
});

export const maintenanceUpdateSchema = z.strictObject({
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  priority: z.enum(MAINTENANCE_PRIORITIES).optional(),
  assignee_id: uuidSchema.nullish(),
  title: z.string().trim().min(3).max(200).optional(),
  description: optionalText(4000),
  resolution_note: optionalText(2000),
  /** Liên kết khoản chi đã ghi cho việc sửa chữa này. */
  expense_id: uuidSchema.nullish(),
  expected_version: expectedVersionSchema,
});

export const maintenanceListQuerySchema = pageQuerySchema.extend({
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  open_only: z.enum(['true', 'false']).optional(),
  building_id: uuidSchema.optional(),
  room_id: uuidSchema.optional(),
});

export const maintenanceSchema = z.object({
  id: z.string(),
  code: z.string(),
  room_id: z.string(),
  room_code: z.string(),
  building_code: z.string(),
  tenancy_id: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(MAINTENANCE_PRIORITIES),
  status: z.enum(MAINTENANCE_STATUSES),
  assignee_id: z.string().nullable(),
  assignee_name: z.string().nullable(),
  reported_by: z.string().nullable(),
  resolved_at: z.string().nullable(),
  resolution_note: z.string().nullable(),
  expense_id: z.string().nullable(),
  expense_number: z.string().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string(),
  version: z.number(),
});
export type MaintenanceDto = z.infer<typeof maintenanceSchema>;
