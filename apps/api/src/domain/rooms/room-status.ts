import type { DateOnly } from '../dates/date-only.js';

export type RoomDisplayStatus = 'OCCUPIED' | 'MAINTENANCE' | 'RESERVED' | 'AVAILABLE';

export interface RoomStatusInput {
  operationalStatus: 'READY' | 'MAINTENANCE';
  /** Có tenancy chưa ENDED (ACTIVE, NOTICE_GIVEN, MOVE_OUT_PROCESSING). */
  hasOpenTenancy: boolean;
  /** Reservation ACTIVE của phòng. */
  activeReservations: { holdFrom: DateOnly; holdUntil: DateOnly }[];
  today: DateOnly;
}

/**
 * Trạng thái hiển thị của phòng, ưu tiên OCCUPIED → MAINTENANCE → RESERVED → AVAILABLE (MASTER_PLAN 5.1).
 * RESERVED khi hôm nay nằm trong khoảng chặn lịch [hold_from, hold_until] của một reservation ACTIVE.
 */
export function roomDisplayStatus(input: RoomStatusInput): { status: RoomDisplayStatus; maintenanceBadge: boolean } {
  if (input.hasOpenTenancy) {
    return { status: 'OCCUPIED', maintenanceBadge: input.operationalStatus === 'MAINTENANCE' };
  }
  if (input.operationalStatus === 'MAINTENANCE') return { status: 'MAINTENANCE', maintenanceBadge: false };
  const reservedNow = input.activeReservations.some((r) => r.holdFrom <= input.today && input.today <= r.holdUntil);
  return { status: reservedNow ? 'RESERVED' : 'AVAILABLE', maintenanceBadge: false };
}

export type ReservationDisplayStatus = 'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'CANCELLED';

/** EXPIRED là trạng thái suy ra khi ngày nghiệp vụ > hold_until (MASTER_PLAN 5.6). */
export function reservationDisplayStatus(
  status: 'ACTIVE' | 'CONVERTED' | 'CANCELLED',
  holdUntil: DateOnly,
  today: DateOnly,
): ReservationDisplayStatus {
  if (status !== 'ACTIVE') return status;
  return today > holdUntil ? 'EXPIRED' : 'ACTIVE';
}
