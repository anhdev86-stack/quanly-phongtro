/**
 * Định dạng hiển thị theo thói quen Việt Nam. Chỉ để hiển thị: tổng tiền chính thức luôn do API tính.
 */
const moneyFormatter = new Intl.NumberFormat('vi-VN');

/** "3500000" → "3.500.000 ₫". Nhận chuỗi số nguyên từ API, không đổi sang float. */
export function formatVnd(amount: string | bigint): string {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount);
  return `${moneyFormatter.format(value)} ₫`;
}

/** "2026-10-06" → "06/10/2026". */
export function formatBusinessDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateOnly = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseDateOnly = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

/** Ngày hôm nay theo giờ máy người dùng, dạng YYYY-MM-DD — chỉ dùng làm giá trị mặc định cho ô nhập. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const d = parseDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnly(d);
}

/** Ngày cuối của kỳ dài `months` tháng bắt đầu từ `start` (2026-10-01, 6 → 2027-03-31). */
export function termEndAfterMonths(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return toDateOnly(dt);
}

/** Ngày 1 của tháng sau ngày `date`. */
export function firstOfNextMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return toDateOnly(new Date(Date.UTC(y, m, 1)));
}
