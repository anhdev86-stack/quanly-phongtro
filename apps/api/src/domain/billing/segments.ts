import { addMonths, type DateOnly, maxDate, minDate } from '../dates/date-only.js';

/**
 * Dựng các đoạn phí liên tục trong một tháng (MASTER_PLAN 8.3/8.4): khoảng thuê ∩ tháng, cắt tại mọi mốc
 * (phiên bản giá, phiên bản dịch vụ, thành viên vào/ra). Các mẩu liền nhau có cùng khóa nguồn được gộp.
 */
export interface Piece<K> {
  start: DateOnly;
  endExclusive: DateOnly;
  value: K;
}

export function monthRange(monthStart: DateOnly) {
  return { start: monthStart, end: addMonths(monthStart, 1) };
}

/** Khoảng thuê ∩ tháng; null nếu không giao. */
export function overlap(monthStart: DateOnly, tenancyStart: DateOnly, tenancyEndExclusive: DateOnly | null) {
  const m = monthRange(monthStart);
  const start = maxDate(m.start, tenancyStart);
  const end = tenancyEndExclusive ? minDate(m.end, tenancyEndExclusive) : m.end;
  return start < end ? { start, end } : null;
}

/**
 * Cắt [start, end) tại các mốc rồi hỏi `at(ngày)` giá trị của từng mẩu (null = không tính phí mẩu đó).
 * Gộp mẩu liền nhau có cùng `key(value)`.
 */
export function slice<V>(start: DateOnly, end: DateOnly, cuts: DateOnly[], at: (day: DateOnly) => V | null, key: (v: V) => string): Piece<V>[] {
  const points = [...new Set([start, end, ...cuts.filter((c) => c > start && c < end)])].sort();
  const out: Piece<V>[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i]!;
    const e = points[i + 1]!;
    const v = at(s);
    if (v === null) continue;
    const prev = out[out.length - 1];
    if (prev && prev.endExclusive === s && key(prev.value) === key(v)) prev.endExclusive = e;
    else out.push({ start: s, endExclusive: e, value: v });
  }
  return out;
}

/** Phiên bản có hiệu lực tại ngày: effective_from lớn nhất ≤ ngày; cùng ngày thì bản tạo sau (đã sắp xếp tăng dần). */
export function versionAt<T extends { effectiveFrom: DateOnly }>(sortedAsc: T[], day: DateOnly): T | null {
  let found: T | null = null;
  for (const v of sortedAsc) if (v.effectiveFrom <= day) found = v;
  return found;
}

/** Các tháng dương lịch (ngày 1) từ tháng của `from` đến `toMonthStart` (bao gồm). */
export function monthsBetween(from: DateOnly, toMonthStart: DateOnly): DateOnly[] {
  const out: DateOnly[] = [];
  for (let m = `${from.slice(0, 7)}-01`; m <= toMonthStart; m = addMonths(m, 1)) out.push(m);
  return out;
}
