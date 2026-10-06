import { describe, expect, it } from 'vitest';
import { contractStatus, coversDate, defaultRenewalStart, latestStartedSigned, rentalMode, type ContractDates } from './contract-status.js';

const signed = (termStart: string, termEnd: string, terminatedOn: string | null = null): ContractDates => ({
  lifecycle: 'SIGNED',
  termStart,
  termEnd,
  terminatedOn,
});

describe('contractStatus (T05)', () => {
  const c = signed('2026-10-01', '2027-03-31');
  it.each([
    ['2026-09-30', 'SCHEDULED'],
    ['2026-10-01', 'ACTIVE'],
    ['2027-03-31', 'ACTIVE'],
    ['2027-04-01', 'EXPIRED'],
  ] as const)('ngày %s → %s', (on, expected) => {
    expect(contractStatus(c, on)).toBe(expected);
  });

  it('vòng đời DRAFT/CANCELLED và kết thúc sớm ưu tiên trước ngày', () => {
    expect(contractStatus({ ...c, lifecycle: 'DRAFT' }, '2026-11-01')).toBe('DRAFT');
    expect(contractStatus({ ...c, lifecycle: 'CANCELLED' }, '2026-11-01')).toBe('CANCELLED');
    expect(contractStatus(signed('2026-10-01', '2027-03-31', '2026-12-16'), '2027-05-01')).toBe('TERMINATED_EARLY');
  });
});

describe('rentalMode', () => {
  it('hết hạn hợp đồng thì là thuê theo tháng; khoảng trống giữa hai kỳ cũng là thuê theo tháng (T04, T08)', () => {
    const contracts = [signed('2026-01-01', '2026-06-30'), signed('2026-09-01', '2027-02-28')];
    expect(rentalMode(contracts, '2026-06-30')).toBe('FIXED_TERM');
    expect(rentalMode(contracts, '2026-07-15')).toBe('MONTH_TO_MONTH');
    expect(rentalMode(contracts, '2026-09-01')).toBe('FIXED_TERM');
    expect(rentalMode(contracts, '2027-03-01')).toBe('MONTH_TO_MONTH');
  });

  it('hợp đồng nháp không tạo cam kết; kết thúc sớm ngừng bao phủ từ ngày đó', () => {
    expect(rentalMode([{ ...signed('2026-01-01', '2027-01-01'), lifecycle: 'DRAFT' }], '2026-06-01')).toBe('MONTH_TO_MONTH');
    expect(coversDate(signed('2026-01-01', '2027-01-01', '2026-06-10'), '2026-06-09')).toBe(true);
    expect(coversDate(signed('2026-01-01', '2027-01-01', '2026-06-10'), '2026-06-10')).toBe(false);
  });
});

describe('kỳ gia hạn và hợp đồng hiện hành', () => {
  it('gia hạn mặc định bắt đầu ngày sau kỳ SIGNED cuối cùng', () => {
    expect(defaultRenewalStart([signed('2026-01-01', '2026-06-30'), signed('2026-07-01', '2026-12-31')], '2026-10-06')).toBe('2027-01-01');
    expect(defaultRenewalStart([], '2026-10-06')).toBe('2026-10-06');
  });

  it('hợp đồng hiện hành là kỳ SIGNED đã bắt đầu gần nhất (kỳ tương lai chưa tính)', () => {
    const a = signed('2026-01-01', '2026-06-30');
    const b = signed('2026-07-01', '2026-12-31');
    const future = signed('2027-01-01', '2027-06-30');
    expect(latestStartedSigned([future, a, b], '2026-10-06')).toBe(b);
    expect(latestStartedSigned([future], '2026-10-06')).toBeNull();
  });
});
