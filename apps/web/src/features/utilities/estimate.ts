/**
 * Ước tính hiển thị ngay khi gõ chỉ số (chưa lưu). Chỉ để xem: sau khi lưu, màn hình hiện số API trả về
 * (API dùng đúng hàm tính chính thức). Số thập phân 2 chữ số xử lý bằng bigint, không dùng số thực.
 */
const PATTERN = /^(\d+)(?:[.,](\d{1,2}))?$/;

export function toHundredths(value: string): bigint | null {
  const m = PATTERN.exec(value.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

export function fromHundredths(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const frac = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / 100n}${frac ? `,${frac}` : ''}`;
}

/** Chuẩn hóa chuỗi người dùng gõ ("1.234,5" không hợp lệ; "1234,5" → "1234.5") để gửi API. */
export const normalizeReading = (value: string) => value.trim().replace(',', '.');

export interface Estimate {
  usage: bigint;
  amount: bigint | null;
}

/** Tiêu thụ = phần đồng hồ cũ + (mới − trước); tiền = tiêu thụ × đơn giá, làm tròn HALF_UP theo đơn vị. Âm → null. */
export function estimate(newValue: string, previous: string | null, carried: string, unitPrice: string | null, roundingUnit: number): Estimate | null {
  const v = toHundredths(newValue);
  const p = previous === null ? null : toHundredths(previous);
  const c = toHundredths(carried) ?? 0n;
  if (v === null || p === null || v < p) return null;
  const usage = c + v - p;
  const price = unitPrice === null ? null : toHundredths(unitPrice);
  if (price === null) return { usage, amount: null };
  const unit = BigInt(roundingUnit) * 10_000n;
  return { usage, amount: ((usage * price + unit / 2n) / unit) * BigInt(roundingUnit) };
}
