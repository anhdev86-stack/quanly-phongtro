import { type DateOnly, diffDays, maxDate, minDate } from '../dates/date-only.js';

/**
 * Lịch sử theo ngày của số lượng dịch vụ và số người ở (MASTER_PLAN 8.4, T12).
 * Đoạn mới bắt đầu mỗi khi giá trị đổi; phần nằm ngoài [from, toExclusive) bị cắt.
 */
export interface Segment {
  start: DateOnly;
  endExclusive: DateOnly;
  days: number;
  value: number;
}

export interface QuantityVersion {
  effectiveFrom: DateOnly;
  endExclusive: DateOnly | null;
  quantity: number;
  status: 'ACTIVE' | 'VOIDED';
}

export interface Membership {
  joinedOn: DateOnly;
  leftOnExclusive: DateOnly | null;
}

/** Các phiên bản ACTIVE không giao nhau (ràng buộc EXCLUDE ở DB), nên chỉ cần cắt và sắp xếp. */
export function quantitySegments(versions: QuantityVersion[], from: DateOnly, toExclusive: DateOnly): Segment[] {
  return versions
    .filter((v) => v.status === 'ACTIVE')
    .map((v) => ({ start: maxDate(v.effectiveFrom, from), endExclusive: minDate(v.endExclusive ?? toExclusive, toExclusive), value: v.quantity }))
    .filter((s) => s.start < s.endExclusive)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map((s) => ({ ...s, days: diffDays(s.start, s.endExclusive) }));
}

/** Số người ở theo từng đoạn (tính cả PRIMARY); đoạn không có ai bị bỏ. */
export function occupantSegments(members: Membership[], from: DateOnly, toExclusive: DateOnly): Segment[] {
  const cuts = new Set<DateOnly>([from, toExclusive]);
  for (const m of members) {
    if (m.joinedOn > from && m.joinedOn < toExclusive) cuts.add(m.joinedOn);
    if (m.leftOnExclusive && m.leftOnExclusive > from && m.leftOnExclusive < toExclusive) cuts.add(m.leftOnExclusive);
  }
  const points = [...cuts].sort();
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    const value = members.filter((m) => m.joinedOn <= start && (m.leftOnExclusive === null || m.leftOnExclusive > start)).length;
    const prev = out[out.length - 1];
    if (prev && prev.value === value && prev.endExclusive === start) {
      prev.endExclusive = end;
      prev.days = diffDays(prev.start, end);
    } else if (value > 0) out.push({ start, endExclusive: end, days: diffDays(start, end), value });
  }
  return out;
}

/** Tổng đơn vị-ngày (người-ngày, xe-ngày) của các đoạn. */
export const unitDays = (segments: Segment[]): number => segments.reduce((sum, s) => sum + s.days * s.value, 0);
