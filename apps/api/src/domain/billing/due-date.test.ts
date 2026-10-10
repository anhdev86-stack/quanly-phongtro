import { describe, expect, it } from 'vitest';
import { effectiveDueDate } from './due-date.js';

describe('effectiveDueDate (D-044)', () => {
  it('còn trong hạn theo lịch: giữ nguyên hạn', () => {
    expect(effectiveDueDate('2026-11-05', '2026-11-01')).toBe('2026-11-05');
    expect(effectiveDueDate('2026-11-05', '2026-11-05')).toBe('2026-11-05');
  });
  it('lập/phát hành sau hạn theo lịch: hạn = ngày phát hành + 7 ngày (qua tháng được)', () => {
    expect(effectiveDueDate('2026-10-05', '2026-10-09')).toBe('2026-10-16');
    expect(effectiveDueDate('2026-10-05', '2026-10-28')).toBe('2026-11-04');
  });
  it('thông báo đầu tiên phát hành đúng ngày nhận phòng: đến hạn ngay ngày đó', () => {
    expect(effectiveDueDate('2026-10-10', '2026-10-10')).toBe('2026-10-10');
  });
});
