import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import { LedgersService } from '../ledgers/ledgers.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import type { ReservationExtras } from './reservations.service.js';

/**
 * Các hook của giữ phòng: số dư tiền giữ chỗ (Phase 2); báo trả và xung đột lịch (mở rộng ở Phase 7).
 */
@Injectable()
export class DefaultReservationExtras implements ReservationExtras {
  constructor(
    protected readonly rooms: RoomsService,
    protected readonly ledgers: LedgersService,
  ) {}

  holdingBalances(db: Db, ids: string[]): Promise<Map<string, bigint>> {
    return this.ledgers.holdingBalances(db, ids);
  }

  async scheduleConflicts(_db: Db, _reservations: { id: string; roomId: string; holdFrom: string }[]): Promise<Set<string>> {
    return new Set();
  }

  async assertNotBlockedByTenancy(db: Db, roomId: string, _holdFrom: string): Promise<void> {
    const open = await this.rooms.openTenancies(db, [roomId]);
    if (open.size > 0) {
      throw new AppError(
        'BUSINESS_RULE_VIOLATION',
        'Phòng đang có khách thuê và chưa có báo trả phòng. Chỉ giữ chỗ được cho thời gian sau ngày khách cũ trả phòng.',
      );
    }
  }
}
