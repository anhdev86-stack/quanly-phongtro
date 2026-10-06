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

/** Tạo lần thuê trực tiếp trong DB (bỏ qua API) — dùng để dựng trạng thái như NOTICE_GIVEN/ENDED. */
export async function createTenancyRow(
  t: TestApp,
  roomId: string,
  opts: { status?: 'ACTIVE' | 'NOTICE_GIVEN' | 'MOVE_OUT_PROCESSING' | 'ENDED'; start?: string; chargeEndExclusive?: string } = {},
) {
  const tenant = await t.prisma.tenant.create({ data: { workspaceId: SEED_IDS.workspace, fullName: `Khách ${++seq}` } });
  const tenancy = await t.prisma.tenancy.create({
    data: {
      workspaceId: SEED_IDS.workspace,
      roomId,
      code: nextCode('LTF'),
      startDate: toDbDate(opts.start ?? '2026-09-01'),
      chargeEndExclusive: opts.chargeEndExclusive ? toDbDate(opts.chargeEndExclusive) : null,
      status: opts.status ?? 'ACTIVE',
      createdBy: await ownerId(t),
    },
  });
  await t.prisma.tenancyTenant.create({
    data: {
      workspaceId: SEED_IDS.workspace,
      tenancyId: tenancy.id,
      tenantId: tenant.id,
      role: 'PRIMARY',
      joinedOn: toDbDate(opts.start ?? '2026-09-01'),
      leftOnExclusive: opts.status === 'ENDED' && opts.chargeEndExclusive ? toDbDate(opts.chargeEndExclusive) : null,
    },
  });
  return tenancy;
}

export async function serviceId(t: TestApp, code: 'ELEC' | 'WATER' | 'INTERNET' | 'TRASH' | 'PARKING'): Promise<string> {
  return (await t.prisma.service.findFirstOrThrow({ where: { code } })).id;
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
