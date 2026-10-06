import type { DateOnly } from '../dates/date-only.js';
import type { Fixed2 } from './fixed2.js';

/**
 * Chuỗi điểm đọc của một (phòng, loại đồng hồ) trong một lần thuê (MASTER_PLAN 8.5, D-025).
 * INSTALL là điểm ngầm định khi lắp đồng hồ (chỉ số ban đầu của đồng hồ); CLOSING là chỉ số chốt đồng hồ cũ khi thay.
 * Mốc kỳ là INITIAL hoặc PERIODIC. Tiêu thụ giữa hai điểm liên tiếp chỉ tính khi cùng đồng hồ;
 * chuyển sang đồng hồ khác đóng góp 0, nên usage = (chốt cũ − đầu) + (hiện tại − ban đầu mới).
 */
export type PointKind = 'INSTALL' | 'INITIAL' | 'PERIODIC' | 'FINAL' | 'CLOSING';

export interface MeterPoint {
  meterId: string;
  readOn: DateOnly;
  value: Fixed2;
  kind: PointKind;
  readingId?: string;
}

const RANK: Record<PointKind, number> = { CLOSING: 0, FINAL: 0, INSTALL: 1, INITIAL: 2, PERIODIC: 3 };

export function sortPoints(points: MeterPoint[]): MeterPoint[] {
  return [...points].sort((a, b) => (a.readOn === b.readOn ? RANK[a.kind] - RANK[b.kind] : a.readOn < b.readOn ? -1 : 1));
}

const isBoundary = (p: MeterPoint) => p.kind === 'INITIAL' || p.kind === 'PERIODIC';

/** Tổng tiêu thụ cùng đồng hồ giữa các điểm liên tiếp trong points[from..to]. Âm → null (dữ liệu sai thứ tự). */
function chainUsage(points: MeterPoint[], from: number, to: number): Fixed2 | null {
  let total = 0n;
  for (let i = from; i < to; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.meterId !== b.meterId) continue;
    const d = b.value - a.value;
    if (d < 0n) return null;
    total += d;
  }
  return total;
}

export interface PendingInterval {
  /** Mốc kỳ trước (INITIAL/PERIODIC gần nhất); null nếu chưa có mốc nào. */
  boundary: MeterPoint | null;
  /** Điểm gần nhất trên đồng hồ đang dùng — “chỉ số trước” hiển thị cho người nhập. */
  previous: MeterPoint | null;
  /** Tiêu thụ đã ghi trên đồng hồ cũ (đã thay) kể từ mốc kỳ trước. */
  carried: Fixed2;
}

/**
 * Khoảng đang chờ chỉ số mới trên `meterId`, chỉ xét các điểm có ngày < `before` (nếu có).
 * Màn hình nhập dùng: tiêu thụ = carried + (chỉ số mới − previous.value).
 */
export function pendingInterval(points: MeterPoint[], meterId: string, before?: DateOnly): PendingInterval {
  const sorted = sortPoints(points.filter((p) => before === undefined || p.readOn < before));
  let b = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (isBoundary(sorted[i]!)) {
      b = i;
      break;
    }
  }
  let previous: MeterPoint | null = null;
  let last = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.meterId === meterId) {
      previous = sorted[i]!;
      last = i;
      break;
    }
  }
  const start = Math.max(b, 0);
  const carried = previous && last > start ? (chainUsage(sorted, start, last) ?? 0n) : 0n;
  return { boundary: b >= 0 ? sorted[b]! : null, previous, carried };
}

export type UsageResult = { ok: true; usage: Fixed2 } | { ok: false; reason: 'NO_PREVIOUS' | 'NEGATIVE' };

/** Tiêu thụ nếu nhập `value` cho đồng hồ của khoảng đang chờ. Bằng 0 hợp lệ; âm bị từ chối (T13). */
export function usageFor(interval: PendingInterval, value: Fixed2): UsageResult {
  if (!interval.previous) return { ok: false, reason: 'NO_PREVIOUS' };
  const d = value - interval.previous.value;
  if (d < 0n) return { ok: false, reason: 'NEGATIVE' };
  return { ok: true, usage: interval.carried + d };
}

/** Tiêu thụ của từng khoảng kỳ đã chốt (giữa hai mốc liên tiếp) — để so sánh bất thường. */
export function closedIntervalUsages(points: MeterPoint[]): Fixed2[] {
  const sorted = sortPoints(points);
  const marks = sorted.map((p, i) => (isBoundary(p) ? i : -1)).filter((i) => i >= 0);
  const out: Fixed2[] = [];
  for (let k = 1; k < marks.length; k++) {
    const u = chainUsage(sorted, marks[k - 1]!, marks[k]!);
    if (u !== null) out.push(u);
  }
  return out;
}
