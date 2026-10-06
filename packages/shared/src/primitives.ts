import { z } from 'zod';

/** Tiền VND trên API luôn là chuỗi số nguyên không âm, ví dụ "3500000" (MASTER_PLAN 4.1). */
export const moneyVndSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,17})$/, 'Số tiền phải là số nguyên VND không âm, dạng chuỗi.');

/** Ngày nghiệp vụ dạng YYYY-MM-DD, phải là ngày có thật. */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD.')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Ngày không tồn tại.');

export const uuidSchema = z.uuid();

/** Idempotency-Key: 8–128 ký tự an toàn (UUID khuyến nghị). */
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const CSRF_HEADER = 'x-csrf-token';
export const REQUEST_ID_HEADER = 'x-request-id';

export const COOKIE_NAMES = {
  ACCESS: 'qt_access',
  REFRESH: 'qt_refresh',
  CSRF: 'qt_csrf',
} as const;
