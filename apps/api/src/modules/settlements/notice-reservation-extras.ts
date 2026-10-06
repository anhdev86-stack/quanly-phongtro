import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { fromDbDate } from '../../domain/dates/date-only.js';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import { DefaultReservationExtras } from '../reservations/reservation-extras.js';
import { OPEN_TENANCY_STATUSES } from '../rooms/rooms.service.js';

/**
 * Giữ phòng khi khách cũ đã báo trả (MASTER_PLAN 5.6, 7.5): được giữ chỗ từ sau ngày dự kiến trả. Báo trả bị hủy (hoặc
 * lịch giữ chạm vào thời gian khách cũ còn ở) → lượt giữ hiện “xung đột lịch”, không tự hủy (T55).
 */
@Injectable()
export class NoticeReservationExtras extends DefaultReservationExtras {
  override async assertNotBlockedByTenancy(db: Db, roomId: string, holdFrom: string): Promise<void> {
    const open = await db.tenancy.findFirst({ where: { roomId, status: { in: [...OPEN_TENANCY_STATUSES] } } });
    if (!open) return;
    const notice = await db.moveOutNotice.findFirst({ where: { tenancyId: open.id, status: 'ACTIVE' } });
    if (!notice) {
      throw new AppError('BUSINESS_RULE_VIOLATION', 'Phòng đang có khách thuê và chưa có báo trả phòng. Chỉ giữ chỗ được cho thời gian sau ngày khách cũ trả phòng.');
    }
    const last = fromDbDate(notice.plannedLastChargeDate);
    if (holdFrom <= last) {
      throw new AppError('BUSINESS_RULE_VIOLATION', `Khách cũ dự kiến trả hết ngày ${last}; lịch giữ phải bắt đầu sau ngày đó.`, { hold_from: ['Trùng thời gian khách cũ còn ở.'] });
    }
  }

  override async scheduleConflicts(db: Db, reservations: { id: string; roomId: string; holdFrom: string }[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!reservations.length) return out;
    const open = await db.tenancy.findMany({ where: { roomId: { in: [...new Set(reservations.map((r) => r.roomId))] }, status: { in: [...OPEN_TENANCY_STATUSES] } } });
    if (!open.length) return out;
    const notices = await db.moveOutNotice.findMany({ where: { tenancyId: { in: open.map((t) => t.id) }, status: 'ACTIVE' } });
    for (const r of reservations) {
      const t = open.find((x) => x.roomId === r.roomId);
      if (!t) continue;
      const n = notices.find((x) => x.tenancyId === t.id);
      if (!n || r.holdFrom <= fromDbDate(n.plannedLastChargeDate)) out.add(r.id);
    }
    return out;
  }
}
