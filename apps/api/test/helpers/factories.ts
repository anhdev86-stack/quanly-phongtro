import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { toDbDate } from '../../src/domain/dates/date-only.js';
import type { TestApp } from './test-app.js';

let seq = 0;
const nextCode = (prefix: string) => `${prefix}${++seq}`;

/** Tạo phòng trực tiếp trong DB (tòa A mặc định). */
export async function createRoom(
  t: TestApp,
  opts: { building?: keyof typeof SEED_IDS.buildings; code?: string; rent?: bigint; maxOccupants?: number; maintenance?: boolean } = {},
) {
  return t.prisma.room.create({
    data: {
      workspaceId: SEED_IDS.workspace,
      buildingId: SEED_IDS.buildings[opts.building ?? 'A'],
      code: opts.code ?? nextCode('R'),
      defaultRentVnd: opts.rent ?? 3_000_000n,
      maxOccupants: opts.maxOccupants ?? 2,
      operationalStatus: opts.maintenance ? 'MAINTENANCE' : 'READY',
    },
  });
}

export async function ownerId(t: TestApp): Promise<string> {
  return (await t.prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } })).id;
}

export async function createReservation(
  t: TestApp,
  roomId: string,
  dates: { holdFrom: string; expectedMoveIn?: string; holdUntil: string },
  status: 'ACTIVE' | 'CANCELLED' | 'CONVERTED' = 'ACTIVE',
) {
  return t.prisma.reservation.create({
    data: {
      workspaceId: SEED_IDS.workspace,
      roomId,
      holdFrom: toDbDate(dates.holdFrom),
      expectedMoveIn: toDbDate(dates.expectedMoveIn ?? dates.holdFrom),
      holdUntil: toDbDate(dates.holdUntil),
      contactName: 'Khách giữ chỗ',
      status,
      createdBy: await ownerId(t),
    },
  });
}
