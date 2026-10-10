import { z } from 'zod';
import { expectedVersionSchema, optionalPhone, optionalText, pageQuerySchema, reasonSchema } from './common.js';
import { businessDateSchema, moneyVndSchema, uuidSchema } from './primitives.js';
import { readingValueSchema } from './tenancy.js';
import { unitPriceSchema } from './utilities.js';

const codeSchema = z
  .string()
  .trim()
  .min(1, 'Vui lòng nhập mã.')
  .max(20)
  .regex(/^[A-Za-z0-9._-]+$/, 'Mã chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang.')
  .transform((v) => v.toUpperCase());

// ---------- Tòa ----------

const optionalUnitPrice = unitPriceSchema.nullish().transform((v) => v ?? null);
const periodStartCheck = (v: { effective_from?: string | null }, ctx: z.RefinementCtx) => {
  if (v.effective_from && !v.effective_from.endsWith('-01')) ctx.addIssue({ code: 'custom', path: ['effective_from'], message: 'Giá điện nước áp dụng từ đầu một kỳ (ngày 1).' });
};

/**
 * Giá điện (đ/kWh) và nước (đ/m³) nhập ngay khi tạo tòa — không bắt buộc (D-043). Tạo phiên bản giá như “Đặt giá”;
 * `effective_from` mặc định là kỳ hiện tại.
 */
export const buildingMeterPricesCreateSchema = z
  .strictObject({
    ELECTRICITY: optionalUnitPrice,
    WATER: optionalUnitPrice,
    effective_from: businessDateSchema.nullish().transform((v) => v ?? null),
  })
  .superRefine(periodStartCheck);

/** Đổi giá điện nước trong “Sửa tòa”: chỉ gửi loại có giá mới; vẫn là phiên bản giá mới, có kỳ áp dụng và lý do (D-043). */
export const buildingMeterPricesChangeSchema = z
  .strictObject({
    ELECTRICITY: optionalUnitPrice,
    WATER: optionalUnitPrice,
    effective_from: businessDateSchema,
    reason: reasonSchema,
    /** Bắt buộc true nếu kỳ áp dụng đã có chỉ số chốt (tiền tạm tính của kỳ đó sẽ đổi). */
    confirm_existing_readings: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    periodStartCheck(v, ctx);
    if (v.ELECTRICITY === null && v.WATER === null) ctx.addIssue({ code: 'custom', path: ['ELECTRICITY'], message: 'Nhập giá điện hoặc giá nước mới.' });
  });

export const buildingCreateSchema = z.strictObject({
  code: codeSchema,
  name: z.string().trim().min(1, 'Vui lòng nhập tên tòa.').max(120),
  address: optionalText(300),
  floors: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
  contact_name: optionalText(120),
  contact_phone: optionalPhone,
  note: optionalText(1000),
  meter_prices: buildingMeterPricesCreateSchema.nullish().transform((v) => v ?? null),
});

export const buildingUpdateSchema = buildingCreateSchema
  .omit({ meter_prices: true })
  .partial()
  .extend({ expected_version: expectedVersionSchema, meter_prices: buildingMeterPricesChangeSchema.nullish().transform((v) => v ?? null) });
export const versionOnlySchema = z.strictObject({ expected_version: expectedVersionSchema });

export const buildingSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  floors: z.number().nullable(),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  note: z.string().nullable(),
  archived_at: z.string().nullable(),
  version: z.number(),
  room_count: z.number(),
  /** Tài khoản đang hoạt động được giao phụ trách tòa (phạm vi tòa của Quản lý). Giao ở Cấu hình → Người dùng. */
  managers: z.array(z.object({ id: z.string(), display_name: z.string() })),
});
export type Building = z.infer<typeof buildingSchema>;

export const buildingListQuerySchema = z.object({
  include_archived: z.enum(['true', 'false']).default('false'),
});

// ---------- Phòng ----------

export const ROOM_DISPLAY_STATUSES = ['OCCUPIED', 'MAINTENANCE', 'RESERVED', 'AVAILABLE'] as const;
export type RoomDisplayStatus = (typeof ROOM_DISPLAY_STATUSES)[number];
export const ROOM_STATUS_LABELS: Record<RoomDisplayStatus, string> = {
  OCCUPIED: 'Đang thuê',
  MAINTENANCE: 'Bảo trì',
  RESERVED: 'Đã giữ',
  AVAILABLE: 'Trống',
};

export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,2})?$/, 'Số không hợp lệ (tối đa 2 chữ số thập phân).');

export const roomCreateSchema = z.strictObject({
  building_id: uuidSchema,
  code: codeSchema,
  floor: z.number().int().min(-5).max(100).nullish().transform((v) => v ?? null),
  area_m2: decimalStringSchema.nullish().transform((v) => v ?? null),
  default_rent_vnd: moneyVndSchema,
  max_occupants: z.number().int().min(1, 'Sức chứa tối thiểu 1 người.').max(50),
  amenities: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  note: optionalText(1000),
  /**
   * Chỉ số ban đầu khi thiết lập phòng (nhập một lần): có giá trị thì tạo đồng hồ điện/nước của phòng với chỉ số này, ngày lắp là hôm nay.
   * Số seri không bắt buộc. Các tháng sau tự lấy làm chỉ số trước.
   */
  initial_readings: z
    .strictObject({ ELECTRICITY: readingValueSchema.nullish(), WATER: readingValueSchema.nullish() })
    .nullish()
    .transform((v) => v ?? null),
});

export const roomUpdateSchema = roomCreateSchema
  .omit({ building_id: true, initial_readings: true })
  .partial()
  .extend({ expected_version: expectedVersionSchema });

export const roomOperationalStatusSchema = z.strictObject({
  status: z.enum(['READY', 'MAINTENANCE']),
  note: optionalText(500),
  expected_version: expectedVersionSchema,
});

export const roomListQuerySchema = pageQuerySchema.extend({
  building_id: uuidSchema.optional(),
  status: z.enum(ROOM_DISPLAY_STATUSES).optional(),
  floor: z.coerce.number().int().optional(),
  q: z.string().trim().max(50).optional(),
  include_archived: z.enum(['true', 'false']).default('false'),
});

export const reservationSummarySchema = z.object({
  id: z.string(),
  hold_from: z.string(),
  expected_move_in: z.string(),
  hold_until: z.string(),
  contact_name: z.string(),
  status: z.string(),
});

export const roomSchema = z.object({
  id: z.string(),
  building_id: z.string(),
  building_code: z.string(),
  building_name: z.string(),
  code: z.string(),
  floor: z.number().nullable(),
  area_m2: z.string().nullable(),
  default_rent_vnd: z.string(),
  max_occupants: z.number(),
  amenities: z.array(z.string()),
  operational_status: z.enum(['READY', 'MAINTENANCE']),
  maintenance_note: z.string().nullable(),
  note: z.string().nullable(),
  display_status: z.enum(ROOM_DISPLAY_STATUSES),
  /** Phòng có khách nhưng đang có ghi chú bảo trì. */
  maintenance_badge: z.boolean(),
  current_reservation: reservationSummarySchema.nullable(),
  current_tenancy: z
    .object({ id: z.string(), code: z.string(), primary_tenant_name: z.string().nullable(), status: z.string() })
    .nullable(),
  archived_at: z.string().nullable(),
  version: z.number(),
});
export type Room = z.infer<typeof roomSchema>;

// ---------- Giữ phòng ----------

const reservationDates = z.object({
  hold_from: businessDateSchema,
  expected_move_in: businessDateSchema,
  hold_until: businessDateSchema,
});

function checkDateOrder(v: z.infer<typeof reservationDates>, ctx: z.RefinementCtx) {
  if (v.hold_from > v.expected_move_in) {
    ctx.addIssue({ code: 'custom', path: ['expected_move_in'], message: 'Ngày dự kiến nhận phải từ ngày bắt đầu giữ trở đi.' });
  }
  if (v.expected_move_in > v.hold_until) {
    ctx.addIssue({ code: 'custom', path: ['hold_until'], message: 'Hạn giữ chỗ phải từ ngày dự kiến nhận trở đi.' });
  }
}

export const reservationCreateSchema = z
  .strictObject({
    room_id: uuidSchema,
    ...reservationDates.shape,
    contact_name: z.string().trim().min(1, 'Vui lòng nhập tên người giữ chỗ.').max(120),
    contact_phone: optionalPhone,
    note: optionalText(1000),
  })
  .superRefine(checkDateOrder);

export const reservationRescheduleSchema = z
  .strictObject({ ...reservationDates.shape, expected_version: expectedVersionSchema })
  .superRefine(checkDateOrder);

export const reservationCancelSchema = z.strictObject({ reason: reasonSchema, expected_version: expectedVersionSchema });

export const RESERVATION_DISPLAY_STATUSES = ['ACTIVE', 'EXPIRED', 'CONVERTED', 'CANCELLED'] as const;
export const RESERVATION_STATUS_LABELS: Record<(typeof RESERVATION_DISPLAY_STATUSES)[number], string> = {
  ACTIVE: 'Đang giữ',
  EXPIRED: 'Quá hạn giữ',
  CONVERTED: 'Đã nhận phòng',
  CANCELLED: 'Đã hủy',
};

export const reservationListQuerySchema = pageQuerySchema.extend({
  room_id: uuidSchema.optional(),
  building_id: uuidSchema.optional(),
  status: z.enum(RESERVATION_DISPLAY_STATUSES).optional(),
});

export const reservationSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  room_code: z.string(),
  building_id: z.string(),
  building_code: z.string(),
  hold_from: z.string(),
  expected_move_in: z.string(),
  hold_until: z.string(),
  status: z.enum(['ACTIVE', 'CONVERTED', 'CANCELLED']),
  display_status: z.enum(RESERVATION_DISPLAY_STATUSES),
  contact_name: z.string(),
  contact_phone: z.string().nullable(),
  note: z.string().nullable(),
  cancelled_reason: z.string().nullable(),
  /** Có xung đột với lịch thuê hiện tại (ví dụ báo trả đã bị hủy). */
  schedule_conflict: z.boolean(),
  holding_balance_vnd: z.string(),
  version: z.number(),
});
export type Reservation = z.infer<typeof reservationSchema>;
