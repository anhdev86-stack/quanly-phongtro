/**
 * Ngày nghiệp vụ dạng chuỗi YYYY-MM-DD. Cột PostgreSQL DATE được Prisma trả về là Date ở 00:00 UTC;
 * mọi chuyển đổi đi qua các hàm này để không lệch múi giờ.
 */
export type DateOnly = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: string): boolean {
  const m = RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** "2026-10-06" → Date 2026-10-06T00:00:00Z (dùng để ghi vào cột DATE). */
export function toDbDate(value: DateOnly): Date {
  if (!isDateOnly(value)) throw new Error(`Ngày không hợp lệ: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date từ cột DATE → "YYYY-MM-DD". */
export function fromDbDate(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: DateOnly, days: number): DateOnly {
  const d = toDbDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** Số ngày từ a đến b (b − a). */
export function diffDays(a: DateOnly, b: DateOnly): number {
  return Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / 86_400_000);
}

export function firstDayOfMonth(value: DateOnly): DateOnly {
  return `${value.slice(0, 7)}-01`;
}

export function addMonths(monthStart: DateOnly, months: number): DateOnly {
  const d = toDbDate(firstDayOfMonth(monthStart));
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromDbDate(d);
}

export function daysInMonth(value: DateOnly): number {
  return diffDays(firstDayOfMonth(value), addMonths(value, 1));
}

/** Ngày cụ thể trong tháng; ngày không tồn tại (ví dụ 31/02) thì lấy ngày cuối tháng. */
export function dayOfMonthClamped(monthStart: DateOnly, day: number): DateOnly {
  const last = daysInMonth(monthStart);
  return `${monthStart.slice(0, 7)}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function minDate(a: DateOnly, b: DateOnly): DateOnly {
  return a <= b ? a : b;
}

export function maxDate(a: DateOnly, b: DateOnly): DateOnly {
  return a >= b ? a : b;
}
