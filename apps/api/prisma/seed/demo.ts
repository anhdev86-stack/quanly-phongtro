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

/**
 * Giá demo (Phase 4): giá chung cho dịch vụ không đồng hồ và giá điện nước riêng từng tòa, áp dụng từ đầu năm 2026.
 * Chỉ tạo khi chưa có phiên bản nào, để không ghi đè giá người dùng đã đổi.
 */
export async function seedDemoPrices(prisma: PrismaClient, createdBy: string): Promise<number> {
  const from = new Date('2026-01-01');
  const services = await prisma.service.findMany({ where: { workspaceId: SEED_IDS.workspace } });
  const byCode = new Map(services.map((s) => [s.code, s.id]));
  const rows: { code: string; building: keyof typeof SEED_IDS.buildings | null; price: string }[] = [
    { code: 'INTERNET', building: null, price: '100000' },
    { code: 'TRASH', building: null, price: '30000' },
    { code: 'PARKING', building: null, price: '100000' },
    { code: 'WATER_PP', building: null, price: '100000' },
    { code: 'ELEC', building: 'A', price: '3500' },
    { code: 'WATER', building: 'A', price: '15000' },
    { code: 'ELEC', building: 'B', price: '3800' },
    { code: 'WATER', building: 'B', price: '18000' },
    { code: 'ELEC', building: 'C', price: '3300' },
    { code: 'WATER', building: 'C', price: '14000' },
  ];
  let created = 0;
  for (const r of rows) {
    const serviceId = byCode.get(r.code);
    if (!serviceId) continue;
    const buildingId = r.building ? SEED_IDS.buildings[r.building] : null;
    if (await prisma.servicePriceHistory.findFirst({ where: { serviceId, buildingId } })) continue;
    await prisma.servicePriceHistory.create({
      data: { workspaceId: SEED_IDS.workspace, serviceId, buildingId, effectiveFrom: from, unitPrice: r.price, reason: 'Giá ban đầu (dữ liệu demo)', createdBy },
    });
    created++;
  }
  return created;
}
