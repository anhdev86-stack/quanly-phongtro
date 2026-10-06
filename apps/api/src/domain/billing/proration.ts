import { addMonths, type DateOnly, daysInMonth, diffDays } from '../dates/date-only.js';

/**
 * Phí chia theo ngày ở cấp đơn vị u = (tenancy, nguồn phí, tháng dương lịch) — MASTER_PLAN 8.3.
 * Mức phí tháng dùng thang ×10⁴ (Fixed4) để giá/số lượng có 2 chữ số thập phân vẫn chính xác bằng bigint.
 */
export type Proration = 'ACTUAL_DAYS' | 'FIXED_30';
export type RoundingUnit = 1 | 100 | 1000;

export interface BillingPolicy {
  proration: Proration;
  rounding_unit: RoundingUnit;
}

export const SCALE = 10_000n;

export interface RateSegment {
  start: DateOnly;
  endExclusive: DateOnly;
  /** Mức phí tháng × 10⁴ (VND). */
  rate: bigint;
}

export interface ProrationResult {
  /** M — tiền của u, đã làm tròn một lần. */
  amount: bigint;
  /** Phân bổ M vào từng đoạn (tổng đúng bằng M). */
  shares: bigint[];
  monthDays: number;
  coveredDays: number;
  /** W = Σ r_i × n_i (×10⁴). */
  weighted: bigint;
  divisor: number;
}

/** round_HALF_UP(numerator / denominator) cho số không âm. */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Tính M của một u và phân bổ vào các đoạn (phần dư lớn nhất, theo bội của đơn vị làm tròn; dư bằng nhau ưu tiên đoạn sớm).
 * ACTUAL_DAYS: A = W/D. FIXED_30: A = W/D nếu đủ tháng, W/30 nếu thiếu tháng (không vượt mức phí bình quân).
 */
export function prorateMonth(monthStart: DateOnly, segments: RateSegment[], policy: BillingPolicy): ProrationResult {
  const monthDays = daysInMonth(monthStart);
  const monthEnd = addMonths(monthStart, 1);
  const days = segments.map((s) => {
    if (s.start < monthStart || s.endExclusive > monthEnd || s.start >= s.endExclusive) throw new RangeError('Đoạn phí nằm ngoài tháng.');
    if (s.rate < 0n) throw new RangeError('Mức phí âm.');
    return diffDays(s.start, s.endExclusive);
  });
  const coveredDays = days.reduce((a, b) => a + b, 0);
  if (coveredDays > monthDays) throw new RangeError('Các đoạn phí chồng nhau.');
  const weights = segments.map((s, i) => s.rate * BigInt(days[i]!));
  const weighted = weights.reduce((a, b) => a + b, 0n);
  const divisor = policy.proration === 'FIXED_30' && coveredDays < monthDays ? 30 : monthDays;
  const unit = BigInt(policy.rounding_unit);
  const units = roundHalfUp(weighted, BigInt(divisor) * SCALE * unit);
  const amount = units * unit;
  return { amount, shares: allocate(units, weights).map((u) => u * unit), monthDays, coveredDays, weighted, divisor };
}

/** Chia `total` đơn vị theo tỷ lệ `weights` bằng phần dư lớn nhất; tổng kết quả luôn bằng `total`. */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    // Không có trọng số (mọi đoạn 0đ): dồn vào đoạn đầu để tổng vẫn đúng.
    return weights.map((_, i) => (i === 0 ? total : 0n));
  }
  const floors = weights.map((w) => (total * w) / sum);
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let leftover = total - floors.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    floors[i]! += 1n;
    leftover -= 1n;
  }
  return floors;
}
