import { describe, expect, it } from 'vitest';
import { formatFixed2, parseFixed2 } from './fixed2.js';
import { meterCharge, usageWarning } from './meter-charge.js';
import { nextReadingPeriod, priceOn } from './meter-price.js';
import { closedIntervalUsages, type MeterPoint, pendingInterval, usageFor } from './meter-usage.js';
import { occupantSegments, quantitySegments, unitDays } from './timeline.js';

const f = parseFixed2;
const p = (meterId: string, readOn: string, value: string, kind: MeterPoint['kind']): MeterPoint => ({ meterId, readOn, value: f(value), kind });

describe('Fixed2', () => {
  it('đọc/ghi không qua số thực', () => {
    expect(f('1520')).toBe(152000n);
    expect(f('0.1')).toBe(10n);
    expect(f('12.05')).toBe(1205n);
    expect(formatFixed2(f('12.50'))).toBe('12.5');
    expect(formatFixed2(f('7'))).toBe('7');
    expect(() => f('1.234')).toThrow();
    expect(() => f('abc')).toThrow();
  });
});

describe('meterCharge — HALF_UP một lần', () => {
  it('đơn vị 1 đồng', () => {
    expect(meterCharge(f('120'), f('3500'), 1)).toBe(420_000n);
    expect(meterCharge(f('0.5'), f('3'), 1)).toBe(2n); // 1.5 → 2
    expect(meterCharge(f('0.49'), f('3'), 1)).toBe(1n); // 1.47 → 1
    expect(meterCharge(f('0'), f('3500'), 1)).toBe(0n);
  });
  it('đơn vị 1.000 đồng', () => {
    expect(meterCharge(f('123'), f('3500'), 1000)).toBe(431_000n); // 430.500 → 431.000
    expect(meterCharge(f('122.8'), f('3500'), 1000)).toBe(430_000n); // 429.800 → 430.000
  });
});

describe('T13 — chỉ số bằng/nhỏ hơn lần trước', () => {
  const points = [p('m1', '2026-10-01', '100', 'INITIAL'), p('m1', '2026-10-31', '150', 'PERIODIC')];
  it('usage 0 hợp lệ, âm bị chặn', () => {
    const i = pendingInterval(points, 'm1');
    expect(i.previous?.value).toBe(f('150'));
    expect(usageFor(i, f('150'))).toEqual({ ok: true, usage: 0n });
    expect(usageFor(i, f('149.99'))).toEqual({ ok: false, reason: 'NEGATIVE' });
  });
  it('xét lại chỉ số của kỳ hiện tại: chỉ dùng điểm trước ngày đọc', () => {
    const i = pendingInterval(points, 'm1', '2026-10-31');
    expect(i.previous?.value).toBe(f('100'));
    expect(usageFor(i, f('150'))).toEqual({ ok: true, usage: f('50') });
  });
  it('chưa có điểm nào thì không tính được', () => {
    expect(usageFor(pendingInterval([], 'm1'), f('1'))).toEqual({ ok: false, reason: 'NO_PREVIOUS' });
  });
});

describe('T14 — thay đồng hồ giữa kỳ', () => {
  // Đầu kỳ 150 trên m1; ngày 15/11 chốt m1 = 190, lắp m2 bắt đầu từ 0; cuối kỳ m2 = 25.
  const points = [
    p('m1', '2026-10-01', '100', 'INITIAL'),
    p('m1', '2026-10-31', '150', 'PERIODIC'),
    p('m1', '2026-11-15', '190', 'CLOSING'),
    p('m2', '2026-11-15', '0', 'INSTALL'),
  ];
  it('chỉ số trước là chỉ số ban đầu của đồng hồ mới; tiêu thụ cộng phần đồng hồ cũ', () => {
    const i = pendingInterval(points, 'm2');
    expect(i.boundary?.value).toBe(f('150'));
    expect(i.previous).toMatchObject({ meterId: 'm2', kind: 'INSTALL' });
    expect(i.carried).toBe(f('40'));
    expect(usageFor(i, f('25'))).toEqual({ ok: true, usage: f('65') });
  });
  it('lịch sử tiêu thụ các kỳ đã chốt', () => {
    const all = [...points, p('m2', '2026-11-30', '25', 'PERIODIC'), p('m2', '2026-12-31', '80', 'PERIODIC')];
    expect(closedIntervalUsages(all)).toEqual([f('50'), f('65'), f('55')]);
  });
});

describe('cảnh báo bất thường (không chặn)', () => {
  it('bằng 0 khi có người ở, cao/thấp so với trung bình 3 kỳ', () => {
    expect(usageWarning(0n, [], true)).toBe('ZERO_WHILE_OCCUPIED');
    expect(usageWarning(0n, [], false)).toBeNull();
    const h = [f('100'), f('110'), f('90')];
    expect(usageWarning(f('300'), h, true)).toBeNull();
    expect(usageWarning(f('300.01'), h, true)).toBe('HIGH');
    expect(usageWarning(f('33'), h, true)).toBe('LOW');
    expect(usageWarning(f('34'), h, true)).toBeNull();
  });
});

describe('giá điện nước theo kỳ (D-028)', () => {
  const versions = [
    { effectiveFrom: '2026-10-01', unitPrice: '3500' },
    { effectiveFrom: '2026-12-01', unitPrice: '3800' },
  ];
  it('tra theo ngày 1 của kỳ', () => {
    expect(priceOn(versions, '2026-09-01')).toBeNull();
    expect(priceOn(versions, '2026-11-01')?.unitPrice).toBe('3500');
    expect(priceOn(versions, '2026-12-01')?.unitPrice).toBe('3800');
  });
  it('kỳ đọc tiếp theo', () => {
    expect(nextReadingPeriod(null, '2026-10-06')).toBe('2026-10-01');
    expect(nextReadingPeriod('2026-11-01', '2026-10-28')).toBe('2026-12-01');
    expect(nextReadingPeriod('2026-08-01', '2026-10-06')).toBe('2026-10-01');
  });
});

describe('T12 — thành viên/số xe đổi giữa tháng (phần dữ liệu)', () => {
  it('số xe: 1 xe từ đầu tháng, 2 xe từ 16/11 → 15 + 30 = 45 xe-ngày', () => {
    const segs = quantitySegments(
      [
        { effectiveFrom: '2026-10-01', endExclusive: '2026-11-16', quantity: 1, status: 'ACTIVE' },
        { effectiveFrom: '2026-11-16', endExclusive: null, quantity: 2, status: 'ACTIVE' },
        { effectiveFrom: '2026-11-10', endExclusive: null, quantity: 9, status: 'VOIDED' },
      ],
      '2026-11-01',
      '2026-12-01',
    );
    expect(segs.map((s) => [s.start, s.endExclusive, s.value, s.days])).toEqual([
      ['2026-11-01', '2026-11-16', 1, 15],
      ['2026-11-16', '2026-12-01', 2, 15],
    ]);
    expect(unitDays(segs)).toBe(45);
  });
  it('người ở: PRIMARY cả tháng, thêm người 11/11, một người rời từ 21/11', () => {
    const segs = occupantSegments(
      [
        { joinedOn: '2026-10-01', leftOnExclusive: null },
        { joinedOn: '2026-11-11', leftOnExclusive: null },
        { joinedOn: '2026-10-01', leftOnExclusive: '2026-11-21' },
      ],
      '2026-11-01',
      '2026-12-01',
    );
    expect(segs.map((s) => [s.start, s.value, s.days])).toEqual([
      ['2026-11-01', 2, 10],
      ['2026-11-11', 3, 10],
      ['2026-11-21', 2, 10],
    ]);
    expect(unitDays(segs)).toBe(70);
  });
});
