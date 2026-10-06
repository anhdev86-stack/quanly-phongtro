import type { Decimal } from '@prisma/client/runtime/client';
import { fromDbDate } from '../../domain/dates/date-only.js';

/** Tiền BIGINT → chuỗi (MASTER_PLAN 4.1: không trả JSON number cho tiền). */
export const money = (v: bigint): string => v.toString();
export const moneyOrNull = (v: bigint | null | undefined): string | null => (v === null || v === undefined ? null : v.toString());

export const iso = (v: Date | null | undefined): string | null => (v ? v.toISOString() : null);
export const day = (v: Date): string => fromDbDate(v);
export const dayOrNull = (v: Date | null | undefined): string | null => (v ? fromDbDate(v) : null);

export const decimal = (v: Decimal | null | undefined): string | null => (v === null || v === undefined ? null : v.toString());

/** Chuỗi tiền đã validate (moneyVndSchema) → BigInt. */
export const toBigInt = (v: string): bigint => BigInt(v);

export function paged<T>(all: T[], page: number, pageSize: number) {
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, page_size: pageSize };
}

/** So sánh mã có số theo thứ tự tự nhiên: 101 < 102 < 1001, A2 < A10. */
export const naturalCompare = (a: string, b: string): number => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' });
