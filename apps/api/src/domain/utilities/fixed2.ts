/**
 * Số thập phân tối đa 2 chữ số (chỉ số đồng hồ, số lượng, đơn giá) biểu diễn bằng bigint phần trăm,
 * để tính tiền không qua số thực.
 */
export type Fixed2 = bigint;

const PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function parseFixed2(value: string): Fixed2 {
  const m = PATTERN.exec(value.trim());
  if (!m) throw new RangeError(`Số không hợp lệ: ${value}`);
  const abs = BigInt(m[2]!) * 100n + BigInt((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -abs : abs;
}

/** 12345n → "123.45"; 1200n → "12"; 1250n → "12.5". */
export function formatFixed2(value: Fixed2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const int = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}
