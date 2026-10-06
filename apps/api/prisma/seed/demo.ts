import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { SEED_IDS } from './foundation.js';

/**
 * Dữ liệu demo theo MASTER_PLAN mục 15: 3 tòa × 15 phòng = 45 phòng. Idempotent theo (tòa, mã phòng).
 * Các phase sau bổ sung người thuê, hợp đồng, thông báo… qua kịch bản trong prisma/seed/scenarios.
 */
export async function seedDemoRooms(prisma: PrismaClient): Promise<number> {
  const buildings = [
    { key: 'A' as const, floors: 3, baseRent: 3_000_000n },
    { key: 'B' as const, floors: 3, baseRent: 2_500_000n },
    { key: 'C' as const, floors: 3, baseRent: 2_200_000n },
  ];
  let count = 0;
  for (const b of buildings) {
    for (let floor = 1; floor <= b.floors; floor++) {
      for (let n = 1; n <= 5; n++) {
        const code = `${b.key}${floor}0${n}`;
        const rent = b.baseRent + BigInt(floor - 1) * 200_000n + (n === 5 ? 300_000n : 0n);
        await prisma.room.upsert({
          where: { buildingId_code: { buildingId: SEED_IDS.buildings[b.key], code } },
          update: {},
          create: {
            workspaceId: SEED_IDS.workspace,
            buildingId: SEED_IDS.buildings[b.key],
            code,
            floor,
            areaM2: n === 5 ? '25.00' : '18.00',
            defaultRentVnd: rent,
            maxOccupants: n === 5 ? 4 : 2,
            amenities: n === 5 ? ['Máy lạnh', 'Nóng lạnh', 'Ban công'] : ['Máy lạnh', 'Nóng lạnh'],
          },
        });
        count++;
      }
    }
  }
  return count;
}
