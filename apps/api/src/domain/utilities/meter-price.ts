import { type DateOnly, addMonths, firstDayOfMonth } from '../dates/date-only.js';

export interface PriceVersion {
  effectiveFrom: DateOnly;
}

/** Phiên bản có hiệu lực tại ngày (effective_from lớn nhất ≤ ngày). Giá điện nước tra theo ngày 1 của kỳ (D-028). */
export function priceOn<T extends PriceVersion>(versions: T[], on: DateOnly): T | null {
  let best: T | null = null;
  for (const v of versions) if (v.effectiveFrom <= on && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  return best;
}

/**
 * “Kỳ đọc tiếp theo” — mặc định của nút Thay đổi giá: tháng sau kỳ mới nhất đã có chỉ số chốt của tòa,
 * nhưng không trước tháng hiện tại.
 */
export function nextReadingPeriod(latestPeriodWithReadings: DateOnly | null, today: DateOnly): DateOnly {
  const current = firstDayOfMonth(today);
  if (!latestPeriodWithReadings) return current;
  const next = addMonths(latestPeriodWithReadings, 1);
  return next > current ? next : current;
}
