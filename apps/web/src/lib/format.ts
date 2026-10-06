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
