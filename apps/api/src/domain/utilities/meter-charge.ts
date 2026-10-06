import type { Fixed2 } from './fixed2.js';

export type RoundingUnit = 1 | 100 | 1000;

/**
 * Tiền điện/nước của một khoảng: tiêu thụ × đơn giá, làm tròn HALF_UP một lần theo đơn vị làm tròn (MASTER_PLAN 4.3, 8.5).
 * Hai tham số ở dạng phần trăm (Fixed2); kết quả là VND nguyên. Billing engine (Phase 5) dùng lại đúng hàm này,
 * nên tiền tạm tính bằng tiền chính thức khi dữ liệu không đổi (T61).
 */
export function meterCharge(usage: Fixed2, unitPrice: Fixed2, roundingUnit: RoundingUnit): bigint {
  if (usage < 0n || unitPrice < 0n) throw new RangeError('Tiêu thụ và đơn giá không âm.');
  const exactTimes1e4 = usage * unitPrice; // VND × 10^4
  const unit = BigInt(roundingUnit) * 10_000n;
  return ((exactTimes1e4 + unit / 2n) / unit) * BigInt(roundingUnit);
}

export type UsageWarning = 'ZERO_WHILE_OCCUPIED' | 'HIGH' | 'LOW';

/**
 * Cảnh báo bất thường, chỉ để kiểm tra lại, không chặn lưu (MASTER_PLAN 8.5):
 * bằng 0 khi phòng có người ở; hơn 3 lần hoặc dưới 1/3 trung bình tối đa 3 kỳ trước.
 */
export function usageWarning(usage: Fixed2, history: Fixed2[], occupied: boolean): UsageWarning | null {
  if (usage === 0n) return occupied ? 'ZERO_WHILE_OCCUPIED' : null;
  const recent = history.slice(-3);
  if (!recent.length) return null;
  const sum = recent.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return null;
  const n = BigInt(recent.length);
  if (usage * n > 3n * sum) return 'HIGH';
  if (usage * n * 3n < sum) return 'LOW';
  return null;
}
