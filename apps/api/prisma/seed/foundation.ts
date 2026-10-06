import { ALL_PERMISSIONS, ROLE_PRESETS, type RoleCode } from '@ql-tro/shared';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/modules/auth/password.js';

/** ID cố định để seed chạy lại nhiều lần vẫn ra cùng dữ liệu. Dữ liệu hoàn toàn hư cấu. */
export const SEED_IDS = {
  workspace: '01920000-0000-7000-8000-000000000001',
  buildings: {
    A: '01920000-0000-7000-8000-0000000000a1',
    B: '01920000-0000-7000-8000-0000000000b1',
    C: '01920000-0000-7000-8000-0000000000c1',
  },
} as const;

export const SEED_USERS = {
  owner: { email: 'owner@example.test', displayName: 'Chủ trọ Demo', role: 'OWNER' as RoleCode, buildings: [] as string[] },
  staffA: { email: 'staff.a@example.test', displayName: 'Nhân viên Tòa A', role: 'STAFF' as RoleCode, buildings: ['A'] },
  staffBC: { email: 'staff.bc@example.test', displayName: 'Nhân viên Tòa B, C', role: 'STAFF' as RoleCode, buildings: ['B', 'C'] },
} as const;

const BUILDINGS = [
  { key: 'A', code: 'A', name: 'Tòa A — Hẻm 12 Đường Số 7', address: '12 Đường Số 7, Phường Mẫu, TP. Demo' },
  { key: 'B', code: 'B', name: 'Tòa B — Khu Phố Xanh', address: '45 Đường Hoa Sữa, Phường Mẫu, TP. Demo' },
  { key: 'C', code: 'C', name: 'Tòa C — Ngõ Bình Yên', address: '8 Ngõ Bình Yên, Phường Mẫu, TP. Demo' },
] as const;

export interface FoundationPasswords {
  owner: string;
  staff: string;
}

/**
 * Seed nền tảng, idempotent: quyền, vai trò, workspace, 3 tòa, 1 OWNER và 2 STAFF với phạm vi tòa khác nhau.
 * Dùng chung cho `prisma db seed` và integration test.
 */
export async function seedFoundation(prisma: PrismaClient, passwords: FoundationPasswords): Promise<void> {
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  }

  for (const [code, preset] of Object.entries(ROLE_PRESETS)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: preset.name },
      create: { code, name: preset.name },
    });
    const permissions = await prisma.permission.findMany({ where: { code: { in: preset.permissions } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }

  const workspace = await prisma.workspace.upsert({
    where: { id: SEED_IDS.workspace },
    update: {},
    create: { id: SEED_IDS.workspace, name: 'Nhà trọ Demo', timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
  });

  for (const b of BUILDINGS) {
    await prisma.building.upsert({
      where: { id: SEED_IDS.buildings[b.key] },
      update: { name: b.name, address: b.address },
      create: { id: SEED_IDS.buildings[b.key], workspaceId: workspace.id, code: b.code, name: b.name, address: b.address },
    });
  }

  const ownerHash = await hashPassword(passwords.owner);
  const staffHash = await hashPassword(passwords.staff);

  for (const u of Object.values(SEED_USERS)) {
    const passwordHash = u.role === 'OWNER' ? ownerHash : staffHash;
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { displayName: u.displayName, passwordHash, isActive: true },
      create: { workspaceId: workspace.id, email: u.email, displayName: u.displayName, passwordHash },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: u.role } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    await prisma.userBuildingScope.deleteMany({ where: { userId: user.id } });
    for (const key of u.buildings) {
      await prisma.userBuildingScope.create({
        data: {
          userId: user.id,
          workspaceId: workspace.id,
          buildingId: SEED_IDS.buildings[key as keyof typeof SEED_IDS.buildings],
        },
      });
    }
  }
}
