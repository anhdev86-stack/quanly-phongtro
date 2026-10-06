import { z } from 'zod';

/** Tham số danh sách chung: page ≥ 1, page_size ≤ 100 (MASTER_PLAN mục 10). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export function pagedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    page_size: z.number().int(),
  });
}

export const expectedVersionSchema = z.number().int().min(1);

/** Chuỗi tùy chọn: chuỗi rỗng/khoảng trắng được coi là không nhập (null). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Số điện thoại Việt Nam: chấp nhận 0xxxxxxxxx hoặc +84xxxxxxxxx; lưu dạng 0xxxxxxxxx. */
export const vnPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s.-]/g, ''))
  .refine((v) => /^(0|\+84)\d{9}$/.test(v), 'Số điện thoại không hợp lệ (ví dụ 0912345678).')
  .transform((v) => (v.startsWith('+84') ? `0${v.slice(3)}` : v));

export const optionalPhone = z
  .union([z.literal(''), vnPhoneSchema])
  .nullish()
  .transform((v) => (v ? v : null));

export const reasonSchema = z.string().trim().min(3, 'Vui lòng nhập lý do (ít nhất 3 ký tự).').max(500);

export const okSchema = z.object({ ok: z.literal(true) });
