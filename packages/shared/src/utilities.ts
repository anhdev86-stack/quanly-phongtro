import { z } from 'zod';
import { expectedVersionSchema, optionalText, reasonSchema } from './common.js';
import { businessDateSchema, uuidSchema } from './primitives.js';
import { meterTypeSchema, readingValueSchema } from './tenancy.js';

// Phase 4: dịch vụ, giá điện nước theo tòa, đồng hồ, chỉ số, cấu hình tính phí (MASTER_PLAN 4.3, 6.4, 8.4, 8.5).

/** Đơn giá / số lượng: số không âm, tối đa 2 chữ số thập phân, dạng chuỗi. */
export const unitPriceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Đơn giá không hợp lệ (số không âm, tối đa 2 chữ số thập phân).');
export const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Số lượng không hợp lệ.');

/** Tháng phát hành dạng YYYY-MM. */
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Kỳ không hợp lệ (YYYY-MM).');

export const SERVICE_TYPES = ['FIXED_ROOM', 'PER_PERSON', 'QUANTITY', 'METER'] as const;
export const chargeTimingSchema = z.enum(['ADVANCE', 'ARREARS']);
export const CHARGE_TIMING_LABELS = { ADVANCE: 'Thu trước', ARREARS: 'Thu sau' } as const;

export const READING_KIND_LABELS = {
  INITIAL: 'Nhận phòng',
  PERIODIC: 'Chốt kỳ',
  FINAL: 'Trả phòng',
  CLOSING: 'Chốt đồng hồ cũ',
  INSTALL: 'Lắp đồng hồ',
} as const;

export const USAGE_WARNING_LABELS = {
  ZERO_WHILE_OCCUPIED: 'Tiêu thụ bằng 0 trong khi phòng có người ở',
  HIGH: 'Cao bất thường (gấp hơn 3 lần trung bình 3 kỳ trước)',
  LOW: 'Thấp bất thường (dưới 1/3 trung bình 3 kỳ trước)',
} as const;

// ---------- Danh mục dịch vụ ----------

export const serviceCreateSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/, 'Mã 2–20 ký tự: chữ không dấu, số, gạch dưới.'),
  name: z.string().trim().min(1, 'Nhập tên dịch vụ.').max(100),
  /** Điện, nước theo đồng hồ có sẵn; không tạo thêm dịch vụ METER. */
  type: z.enum(['FIXED_ROOM', 'PER_PERSON', 'QUANTITY']),
  unit: z.string().trim().min(1, 'Nhập đơn vị.').max(30),
  charge_timing: chargeTimingSchema.default('ADVANCE'),
  /** Dịch vụ thay cho đồng hồ (VD “Nước theo người” thay đồng hồ nước). */
  substitutes_meter: meterTypeSchema.nullish().transform((v) => v ?? null),
});

export const serviceUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  charge_timing: chargeTimingSchema.optional(),
  substitutes_meter: meterTypeSchema.nullable().optional(),
  archived: z.boolean().optional(),
  expected_version: expectedVersionSchema,
});

export const servicePriceCreateSchema = z.strictObject({
  /** null = giá chung cho mọi tòa; có giá trị = giá riêng của tòa đó (ưu tiên hơn giá chung). */
  building_id: uuidSchema.nullish().transform((v) => v ?? null),
  effective_from: businessDateSchema,
  unit_price: unitPriceSchema,
  reason: reasonSchema,
  confirm_mid_month: z.boolean().default(false),
});

export const servicePriceSchema = z.object({
  id: z.string(),
  service_id: z.string(),
  building_id: z.string().nullable(),
  building_code: z.string().nullable(),
  effective_from: z.string(),
  unit_price: z.string(),
  reason: z.string().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string(),
});
export type ServicePriceDto = z.infer<typeof servicePriceSchema>;

export const serviceDetailSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.enum(SERVICE_TYPES),
  unit: z.string(),
  charge_timing: chargeTimingSchema,
  meter_type: meterTypeSchema.nullable(),
  substitutes_meter: meterTypeSchema.nullable(),
  archived_at: z.string().nullable(),
  /** Giá chung đang áp dụng hôm nay (dịch vụ METER: null, xem giá theo tòa). */
  current_price: z.string().nullable(),
  prices: z.array(servicePriceSchema),
  version: z.number(),
});
export type ServiceDetail = z.infer<typeof serviceDetailSchema>;

// ---------- Giá điện nước theo tòa ----------

export const meterPriceCreateSchema = z
  .strictObject({
    meter_type: meterTypeSchema,
    /** Ngày 1 của kỳ bắt đầu áp dụng (D-028). Mặc định ở UI: kỳ đọc tiếp theo. */
    effective_from: businessDateSchema,
    unit_price: unitPriceSchema,
    reason: reasonSchema,
    /** Bắt buộc true nếu kỳ áp dụng đã có chỉ số chốt (tiền tạm tính của kỳ đó sẽ đổi). */
    confirm_existing_readings: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (!v.effective_from.endsWith('-01')) ctx.addIssue({ code: 'custom', path: ['effective_from'], message: 'Giá điện nước áp dụng từ đầu một kỳ (ngày 1).' });
  });

export const meterPricesSchema = z.object({
  building_id: z.string(),
  /** Kỳ đọc tiếp theo — mặc định cho nút “Thay đổi giá”. */
  next_period_start: z.string(),
  items: z.array(
    z.object({
      meter_type: meterTypeSchema,
      service_id: z.string(),
      name: z.string(),
      unit: z.string(),
      /** Giá áp dụng cho kỳ hiện tại; null = tòa chưa đặt giá (chặn phát hành). */
      current: servicePriceSchema.nullable(),
      /** Phiên bản đã đặt cho các kỳ sau. */
      upcoming: z.array(servicePriceSchema),
      history: z.array(servicePriceSchema),
    }),
  ),
});
export type MeterPrices = z.infer<typeof meterPricesSchema>;

// ---------- Dịch vụ của lần thuê ----------

const subscriptionBase = {
  service_id: uuidSchema,
  effective_from: businessDateSchema,
  confirm_mid_month: z.boolean().default(false),
};

export const tenancyServiceChangeSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('ADD'),
    ...subscriptionBase,
    quantity: quantitySchema.default('1'),
    reason: optionalText(500),
    /** Bật dịch vụ thay đồng hồ khi phòng đang có đồng hồ cùng loại: phải xác nhận tính cả hai khoản. */
    confirm_dual_utility: z.boolean().default(false),
  }),
  z.strictObject({ action: z.literal('CHANGE_QUANTITY'), ...subscriptionBase, quantity: quantitySchema, reason: reasonSchema }),
  /** effective_from = ngày đầu tiên không còn dùng dịch vụ. */
  z.strictObject({ action: z.literal('STOP'), ...subscriptionBase, reason: reasonSchema }),
]);
export type TenancyServiceChange = z.input<typeof tenancyServiceChangeSchema>;

// ---------- Đồng hồ ----------

export const readingKindSchema = z.enum(['INITIAL', 'PERIODIC', 'FINAL', 'CLOSING']);

export const readingSchema = z.object({
  id: z.string(),
  meter_id: z.string(),
  meter_type: meterTypeSchema,
  tenancy_id: z.string().nullable(),
  read_on: z.string(),
  value: z.string(),
  kind: readingKindSchema,
  /** Kỳ của chỉ số chốt (YYYY-MM). */
  period: z.string().nullable(),
  note: z.string().nullable(),
  version: z.number(),
  created_by_name: z.string().nullable(),
});
export type ReadingDto = z.infer<typeof readingSchema>;

export const meterSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  type: meterTypeSchema,
  serial: z.string().nullable(),
  installed_on: z.string(),
  retired_on: z.string().nullable(),
  initial_reading: z.string(),
  last_reading: z.object({ value: z.string(), read_on: z.string(), kind: z.string() }).nullable(),
});
export type MeterDto = z.infer<typeof meterSchema>;

export const meterEventSchema = z.object({
  id: z.string(),
  meter_id: z.string(),
  meter_type: meterTypeSchema,
  kind: z.enum(['REPLACEMENT', 'CORRECTION']),
  reason: z.string(),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string(),
});

export const roomMetersSchema = z.object({
  meters: z.array(meterSchema),
  readings: z.array(readingSchema),
  events: z.array(meterEventSchema),
});
export type RoomMeters = z.infer<typeof roomMetersSchema>;

export const meterCreateSchema = z.strictObject({
  type: meterTypeSchema,
  serial: optionalText(50),
  installed_on: businessDateSchema,
  initial_reading: readingValueSchema,
  confirm_dual_utility: z.boolean().default(false),
});

export const meterReplaceSchema = z.strictObject({
  replaced_on: businessDateSchema,
  /** Chỉ số chốt của đồng hồ cũ tại ngày thay. */
  closing_value: readingValueSchema,
  new_serial: optionalText(50),
  new_initial_reading: readingValueSchema,
  reason: reasonSchema,
});

export const meterInitialCorrectSchema = z.strictObject({ initial_reading: readingValueSchema, reason: reasonSchema });

// ---------- Nhập chỉ số ----------

export const readingSheetQuerySchema = z.object({ building_id: uuidSchema, period: periodSchema });

export const sheetMeterSchema = z.object({
  type: meterTypeSchema,
  /** null = phòng chưa gắn đồng hồ loại này. */
  meter_id: z.string().nullable(),
  /** Chỉ số trước (tự lấy, không cho gõ đè). */
  previous: z.object({ value: z.string(), read_on: z.string(), kind: z.string(), reading_id: z.string().nullable(), version: z.number().nullable() }).nullable(),
  /** Tiêu thụ trên đồng hồ cũ đã thay trong kỳ, cộng vào tiêu thụ. */
  carried_usage: z.string(),
  current: z.object({ id: z.string(), value: z.string(), read_on: z.string(), version: z.number() }).nullable(),
  usage: z.string().nullable(),
  unit_price: z.string().nullable(),
  provisional_vnd: z.string().nullable(),
  warning: z.enum(['ZERO_WHILE_OCCUPIED', 'HIGH', 'LOW']).nullable(),
  /** Dịch vụ thay đồng hồ đang bật (VD nước theo người): đồng hồ vẫn ghi nhưng có thể không tính tiền. */
  substituted_by: z.string().nullable(),
});
export type SheetMeter = z.infer<typeof sheetMeterSchema>;

export const readingSheetSchema = z.object({
  building_id: z.string(),
  building_code: z.string(),
  period: z.string(),
  month_start: z.string(),
  rounding_unit: z.number(),
  unit_prices: z.object({ ELECTRICITY: z.string().nullable(), WATER: z.string().nullable() }),
  rows: z.array(
    z.object({
      room_id: z.string(),
      room_code: z.string(),
      floor: z.number().nullable(),
      tenancy_id: z.string(),
      tenancy_code: z.string(),
      primary_tenant_name: z.string().nullable(),
      occupants: z.number(),
      meters: z.array(sheetMeterSchema),
    }),
  ),
  totals: z.object({ provisional_vnd: z.string(), entered: z.number(), expected: z.number() }),
});
export type ReadingSheet = z.infer<typeof readingSheetSchema>;

export const readingBatchSchema = z
  .strictObject({
    period: periodSchema,
    read_on: businessDateSchema,
    items: z
      .array(
        z.strictObject({
          meter_id: uuidSchema,
          value: readingValueSchema,
          /** Có khi sửa chỉ số đã nhập của kỳ này. */
          expected_version: expectedVersionSchema.optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.meter_id)).size !== v.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Đồng hồ bị trùng.' });
  });

export const readingBatchResultSchema = z.object({ saved: z.array(readingSchema) });

export const readingCorrectSchema = z.strictObject({ value: readingValueSchema, reason: reasonSchema, expected_version: expectedVersionSchema });

// ---------- Cấu hình tính phí ----------

export const billingSettingsPayloadSchema = z.strictObject({
  proration: z.enum(['ACTUAL_DAYS', 'FIXED_30']),
  rounding_unit: z.union([z.literal(1), z.literal(100), z.literal(1000)]),
  due_day: z.number().int().min(1).max(28),
  default_charge_timing: chargeTimingSchema,
});
export type BillingSettings = z.infer<typeof billingSettingsPayloadSchema>;

export const BILLING_SETTINGS_DEFAULTS: BillingSettings = { proration: 'ACTUAL_DAYS', rounding_unit: 1, due_day: 5, default_charge_timing: 'ADVANCE' };

export const billingSettingsCreateSchema = billingSettingsPayloadSchema.extend({ effective_from: businessDateSchema });

export const billingSettingsSchema = z.object({
  current: billingSettingsPayloadSchema,
  effective_from: z.string().nullable(),
  history: z.array(
    z.object({ id: z.string(), effective_from: z.string(), payload: billingSettingsPayloadSchema, created_by_name: z.string().nullable(), created_at: z.string() }),
  ),
});
export type BillingSettingsDto = z.infer<typeof billingSettingsSchema>;
