import { describe, expect, it } from 'vitest';
import { reservationDisplayStatus, roomDisplayStatus } from './room-status.js';

const today = '2026-10-06';

describe('roomDisplayStatus — ưu tiên OCCUPIED → MAINTENANCE → RESERVED → AVAILABLE', () => {
  it('phòng có khách luôn OCCUPIED, kèm badge nếu đang bảo trì', () => {
    expect(roomDisplayStatus({ operationalStatus: 'MAINTENANCE', hasOpenTenancy: true, activeReservations: [], today })).toEqual({
      status: 'OCCUPIED',
      maintenanceBadge: true,
    });
  });

  it('đặt trước cho khách mới sau ngày khách cũ rời không đổi badge phòng đang thuê', () => {
    const r = roomDisplayStatus({
      operationalStatus: 'READY',
      hasOpenTenancy: true,
      activeReservations: [{ holdFrom: '2026-10-01', holdUntil: '2026-10-20' }],
      today,
    });
    expect(r.status).toBe('OCCUPIED');
  });

  it('MAINTENANCE thắng RESERVED', () => {
    expect(
      roomDisplayStatus({
        operationalStatus: 'MAINTENANCE',
        hasOpenTenancy: false,
        activeReservations: [{ holdFrom: today, holdUntil: today }],
        today,
      }).status,
    ).toBe('MAINTENANCE');
  });

  it('RESERVED chỉ trong khoảng chặn lịch, tính cả hai đầu', () => {
    const at = (holdFrom: string, holdUntil: string) =>
      roomDisplayStatus({ operationalStatus: 'READY', hasOpenTenancy: false, activeReservations: [{ holdFrom, holdUntil }], today }).status;
    expect(at('2026-10-06', '2026-10-06')).toBe('RESERVED');
    expect(at('2026-10-01', '2026-10-05')).toBe('AVAILABLE');
    expect(at('2026-10-07', '2026-10-10')).toBe('AVAILABLE');
  });
});

describe('reservationDisplayStatus', () => {
  it('ACTIVE quá hold_until hiển thị EXPIRED; trạng thái khác giữ nguyên', () => {
    expect(reservationDisplayStatus('ACTIVE', '2026-10-05', today)).toBe('EXPIRED');
    expect(reservationDisplayStatus('ACTIVE', '2026-10-06', today)).toBe('ACTIVE');
    expect(reservationDisplayStatus('CANCELLED', '2026-10-01', today)).toBe('CANCELLED');
  });
});
