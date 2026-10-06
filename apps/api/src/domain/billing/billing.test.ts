import { describe, expect, it } from 'vitest';
import { allocate, type BillingPolicy, prorateMonth, SCALE } from './proration.js';
import { reconcile, subtotal } from './reconcile.js';
import { monthsBetween, overlap, slice, versionAt } from './segments.js';

const vnd = (n: number) => BigInt(n) * SCALE;
const ACTUAL: BillingPolicy = { proration: 'ACTUAL_DAYS', rounding_unit: 1 };
const FIXED: BillingPolicy = { proration: 'FIXED_30', rounding_unit: 1 };

describe('MASTER_PLAN 8.3 — ba ví dụ', () => {
  it('Ví dụ 1: nhận phòng 20/10, 3.000.000 × 12/31 = 1.161.290', () => {
    const r = prorateMonth('2026-10-01', [{ start: '2026-10-20', endExclusive: '2026-11-01', rate: vnd(3_000_000) }], ACTUAL);
    expect(r.amount).toBe(1_161_290n);
    expect(r.shares).toEqual([1_161_290n]);
  });
  it('Ví dụ 2: FIXED_30, hai đoạn cùng giá đủ tháng 31 ngày → 3.000.000 (1.451.613 + 1.548.387)', () => {
    const r = prorateMonth(
      '2026-10-01',
      [
        { start: '2026-10-01', endExclusive: '2026-10-16', rate: vnd(3_000_000) },
        { start: '2026-10-16', endExclusive: '2026-11-01', rate: vnd(3_000_000) },
      ],
      FIXED,
    );
    expect(r.amount).toBe(3_000_000n);
    expect(r.shares).toEqual([1_451_613n, 1_548_387n]);
  });
  it('Ví dụ 3: đổi giá 16/10 → M = 3.154.839 = 1.451.613 + 1.703.226', () => {
    const r = prorateMonth(
      '2026-10-01',
      [
        { start: '2026-10-01', endExclusive: '2026-10-16', rate: vnd(3_000_000) },
        { start: '2026-10-16', endExclusive: '2026-11-01', rate: vnd(3_300_000) },
      ],
      ACTUAL,
    );
    expect(r.amount).toBe(3_154_839n);
    expect(r.shares).toEqual([1_451_613n, 1_703_226n]);
  });
});

describe('T10 — tháng 28/29/30/31 ngày', () => {
  const half = (month: string, from: string): bigint =>
    prorateMonth(month, [{ start: from, endExclusive: monthsBetween(month, month).length ? nextMonth(month) : month, rate: vnd(3_000_000) }], ACTUAL).amount;
  const nextMonth = (m: string) => {
    const [y, mo] = m.split('-').map(Number) as [number, number];
    return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  };
  it('ACTUAL_DAYS chia theo số ngày thực', () => {
    expect(half('2027-02-01', '2027-02-15')).toBe(1_500_000n); // 14/28
    expect(half('2028-02-01', '2028-02-15')).toBe(1_551_724n); // 15/29 = 1.551.724,14
    expect(half('2026-11-01', '2026-11-16')).toBe(1_500_000n); // 15/30
    expect(half('2026-10-01', '2026-10-17')).toBe(1_451_613n); // 15/31 = 1.451.612,90
  });
  it('FIXED_30: thiếu tháng chia 30, đủ tháng luôn đúng giá tháng kể cả tháng 31 hoặc 28 ngày', () => {
    const fixed = (month: string, from: string, to: string) => prorateMonth(month, [{ start: from, endExclusive: to, rate: vnd(3_000_000) }], FIXED).amount;
    expect(fixed('2026-10-01', '2026-10-17', '2026-11-01')).toBe(1_500_000n); // 15/30
    expect(fixed('2026-10-01', '2026-10-01', '2026-11-01')).toBe(3_000_000n); // đủ tháng 31 ngày
    expect(fixed('2027-02-01', '2027-02-01', '2027-03-01')).toBe(3_000_000n); // đủ tháng 28 ngày
    expect(fixed('2027-02-01', '2027-02-15', '2027-03-01')).toBe(1_400_000n); // 14/30
  });
});

describe('T54 — chia đoạn và làm tròn', () => {
  it('FIXED_30 nhiều đoạn không vượt giá tháng; tổng các dòng = M', () => {
    const segs = [
      { start: '2026-10-01', endExclusive: '2026-10-11', rate: vnd(3_000_000) },
      { start: '2026-10-11', endExclusive: '2026-10-21', rate: vnd(3_000_000) },
      { start: '2026-10-21', endExclusive: '2026-11-01', rate: vnd(3_000_000) },
    ];
    const r = prorateMonth('2026-10-01', segs, FIXED);
    expect(r.amount).toBe(3_000_000n);
    expect(r.shares.reduce((a, b) => a + b, 0n)).toBe(r.amount);
  });
  it('đổi cách chia dòng không đổi M', () => {
    const one = prorateMonth('2026-10-01', [{ start: '2026-10-05', endExclusive: '2026-11-01', rate: vnd(2_850_000) }], ACTUAL);
    const two = prorateMonth(
      '2026-10-01',
      [
        { start: '2026-10-05', endExclusive: '2026-10-20', rate: vnd(2_850_000) },
        { start: '2026-10-20', endExclusive: '2026-11-01', rate: vnd(2_850_000) },
      ],
      ACTUAL,
    );
    expect(two.amount).toBe(one.amount);
  });
  it('làm tròn 1.000 đồng, phân bổ theo bội 1.000', () => {
    const r = prorateMonth(
      '2026-10-01',
      [
        { start: '2026-10-01', endExclusive: '2026-10-16', rate: vnd(3_000_000) },
        { start: '2026-10-16', endExclusive: '2026-11-01', rate: vnd(3_300_000) },
      ],
      { proration: 'ACTUAL_DAYS', rounding_unit: 1000 },
    );
    expect(r.amount).toBe(3_155_000n);
    expect(r.shares.every((s) => s % 1000n === 0n)).toBe(true);
    expect(r.shares.reduce((a, b) => a + b, 0n)).toBe(3_155_000n);
  });
  it('phần dư bằng nhau ưu tiên đoạn sớm hơn', () => {
    expect(allocate(1n, [1n, 1n])).toEqual([1n, 0n]);
    expect(allocate(5n, [0n, 0n])).toEqual([5n, 0n]);
  });
  it('số lượng thập phân (×10⁴) vẫn chính xác', () => {
    // 1,5 xe × 100.000đ cả tháng 30 ngày
    const r = prorateMonth('2026-11-01', [{ start: '2026-11-01', endExclusive: '2026-12-01', rate: 10_000_000n * 150n }], ACTUAL);
    expect(r.amount).toBe(150_000n);
  });
});

describe('dựng đoạn', () => {
  it('khoảng thuê ∩ tháng, cắt tại mốc và gộp mẩu cùng khóa', () => {
    expect(overlap('2026-10-01', '2026-10-20', null)).toEqual({ start: '2026-10-20', end: '2026-11-01' });
    expect(overlap('2026-10-01', '2026-11-05', null)).toBeNull();
    expect(overlap('2026-11-01', '2026-10-20', '2026-11-21')).toEqual({ start: '2026-11-01', end: '2026-11-21' });
    const versions = [
      { id: 'a', effectiveFrom: '2026-10-01' },
      { id: 'b', effectiveFrom: '2026-10-16' },
    ];
    const pieces = slice('2026-10-01', '2026-11-01', ['2026-10-10', '2026-10-16'], (d) => versionAt(versions, d), (v) => v.id);
    expect(pieces.map((p) => [p.start, p.endExclusive, p.value.id])).toEqual([
      ['2026-10-01', '2026-10-16', 'a'],
      ['2026-10-16', '2026-11-01', 'b'],
    ]);
    expect(monthsBetween('2026-10-20', '2027-01-01')).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
  });
});

describe('đối soát (T46, T49)', () => {
  const units = [
    { unitKey: 'RENT:t:2026-10', expected: 1_161_290n, freshLines: ['l1'] },
    { unitKey: 'RENT:t:2026-11', expected: 3_000_000n, freshLines: ['l2'] },
  ];
  it('u chưa phát hành → phí mới; đã phát hành và không đổi → không tạo dòng', () => {
    const out = reconcile(units, [{ id: 'p1', unitKey: 'RENT:t:2026-10', direction: 'DEBIT', amount: 1_161_290n, order: 1 }]);
    expect(out).toEqual([{ kind: 'FRESH', unitKey: 'RENT:t:2026-11', lines: ['l2'] }]);
  });
  it('đã phát hành khác phí đúng → một dòng điều chỉnh trỏ tới dòng gần nhất', () => {
    const out = reconcile(
      [{ unitKey: 'RENT:t:2026-11', expected: 2_000_000n, freshLines: ['x'] }],
      [
        { id: 'p1', unitKey: 'RENT:t:2026-11', direction: 'DEBIT', amount: 3_000_000n, order: 1 },
        { id: 'p2', unitKey: 'RENT:t:2026-11', direction: 'CREDIT', amount: 500_000n, order: 2 },
      ],
    );
    expect(out).toEqual([{ kind: 'ADJUST', unitKey: 'RENT:t:2026-11', direction: 'CREDIT', amount: 500_000n, expected: 2_000_000n, published: 2_500_000n, correctsItemId: 'p2' }]);
  });
  it('u đã phát hành không còn trong phạm vi → hoàn toàn bộ; u bị bỏ qua thì không đụng', () => {
    const published = [{ id: 'p', unitKey: 'SVC:t:s:2026-11', direction: 'DEBIT' as const, amount: 100_000n, order: 1 }];
    expect(reconcile([], published)).toHaveLength(1);
    expect(reconcile([], published, (k) => k.startsWith('SVC:'))).toEqual([]);
  });
  it('tổng chứng từ', () => {
    expect(subtotal([{ direction: 'DEBIT', amount: 10n }, { direction: 'CREDIT', amount: 15n }])).toBe(-5n);
  });
});
