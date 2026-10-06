import { describe, expect, it } from 'vitest';
import { backoffMinutes, isQuietHour, localHour, maskPhone, maskPhonesIn, milestoneOf, normalizeVnMobile, renderReminder, scheduledAt, validateOffsets } from './schedule.js';

describe('lập lịch nhắc đóng tiền', () => {
  it('mốc và thời điểm gửi theo giờ Việt Nam', () => {
    expect(milestoneOf(-3)).toBe('BEFORE_DUE');
    expect(milestoneOf(0)).toBe('DUE');
    expect(milestoneOf(3)).toBe('OVERDUE');
    expect(scheduledAt('2026-11-05', -3, 9).toISOString()).toBe('2026-11-02T02:00:00.000Z');
    expect(scheduledAt('2026-11-05', 3, 9).toISOString()).toBe('2026-11-08T02:00:00.000Z');
    expect(localHour(new Date('2026-11-02T14:30:00Z'))).toBe(21);
  });
  it('giờ yên lặng vắt qua nửa đêm', () => {
    expect([20, 21, 23, 0, 6, 7].map((h) => isQuietHour(h, 21, 7))).toEqual([false, true, true, true, true, false]);
    expect(isQuietHour(12, 12, 14)).toBe(true);
    expect(isQuietHour(3, 5, 5)).toBe(false);
  });
  it('mốc hợp lệ', () => {
    expect(validateOffsets([-3, 0, 3])).toBeNull();
    expect(validateOffsets([-3, -1])).toContain('chỉ được một');
    expect(validateOffsets([-3, 0, 3, 5])).toContain('Tối đa 3');
    expect(validateOffsets([])).not.toBeNull();
  });
  it('số điện thoại: chuẩn hóa và che', () => {
    expect(normalizeVnMobile('+84 912 345 678')).toBe('0912345678');
    expect(normalizeVnMobile('0212345678')).toBeNull();
    expect(maskPhone('0912345689')).toBe('09******89');
    expect(maskPhonesIn('Gửi tới 0912345689 lỗi')).toBe('Gửi tới 09******89 lỗi');
  });
  it('thử lại giãn cách tăng dần', () => {
    expect([1, 2, 3].map(backoffMinutes)).toEqual([5, 15, 45]);
  });
  it('nội dung tin có nhà trọ, phòng, tháng, số tiền, hạn, link', () => {
    const t = renderReminder(
      { workspace_name: 'Nhà trọ Demo', room_code: 'A101', period: '2026-11', invoice_number: 'TB-202611-0001', remaining_vnd: '3100000', due_date: '2026-11-05', milestone: 'BEFORE_DUE' },
      'https://tro.example/p/abc',
    );
    expect(t).toBe('Nhà trọ Demo: Phòng A101 - thông báo TB-202611-0001 tháng 11/2026 còn 3.100.000đ, sắp đến hạn 05/11/2026. Xem và quét QR: https://tro.example/p/abc');
  });
});
