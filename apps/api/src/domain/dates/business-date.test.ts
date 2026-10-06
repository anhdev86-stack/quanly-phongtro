import { describe, expect, it } from 'vitest';
import { toBusinessDate } from './business-date.js';

const VN = 'Asia/Ho_Chi_Minh';

describe('toBusinessDate', () => {
  it('đổi sang ngày mới lúc 00:00 giờ Việt Nam (17:00 UTC hôm trước)', () => {
    expect(toBusinessDate(new Date('2026-10-31T16:59:59.999Z'), VN)).toBe('2026-10-31');
    expect(toBusinessDate(new Date('2026-10-31T17:00:00.000Z'), VN)).toBe('2026-11-01');
  });

  it('xử lý đúng ngày 29/02 năm nhuận và cuối năm', () => {
    expect(toBusinessDate(new Date('2028-02-28T17:00:00Z'), VN)).toBe('2028-02-29');
    expect(toBusinessDate(new Date('2026-12-31T17:30:00Z'), VN)).toBe('2027-01-01');
  });

  it('không phụ thuộc múi giờ của máy chạy', () => {
    expect(toBusinessDate(new Date('2026-10-06T03:00:00Z'), 'UTC')).toBe('2026-10-06');
    expect(toBusinessDate(new Date('2026-10-06T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-05');
  });
});
