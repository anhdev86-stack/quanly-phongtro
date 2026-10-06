import { PERMISSIONS } from '@ql-tro/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapProduction } from '../../prisma/seed/bootstrap.js';
import { assertTestDatabase } from '../helpers/global-setup.js';
import { CSRF_HEADER, createTestApp, resetDatabase, type TestApp } from '../helpers/test-app.js';
import request from 'supertest';

describe('Phase 9 — khởi tạo database production (db:bootstrap)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await resetDatabase(t);
    await t.close();
  });

  async function emptyDatabase() {
    assertTestDatabase(process.env.DATABASE_URL);
    const tables = await t.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await t.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }

  it('database trống: thiếu biến thì từ chối; đủ biến thì tạo nhà trọ + chủ trọ (không có dữ liệu demo), đăng nhập được; chạy lại không tạo thêm', async () => {
    await emptyDatabase();
    await expect(bootstrapProduction(t.prisma, {})).rejects.toThrow(/BOOTSTRAP_OWNER_PASSWORD/);
    await expect(bootstrapProduction(t.prisma, { BOOTSTRAP_WORKSPACE_NAME: 'Nhà trọ X', BOOTSTRAP_OWNER_EMAIL: 'chu@tro.vn', BOOTSTRAP_OWNER_PASSWORD: 'ngan' })).rejects.toThrow();
    expect(await t.prisma.user.count()).toBe(0);

    const env = { BOOTSTRAP_WORKSPACE_NAME: 'Nhà trọ Hoa Sữa', BOOTSTRAP_OWNER_EMAIL: 'Chu.Tro@Example.VN', BOOTSTRAP_OWNER_NAME: 'Cô Lan', BOOTSTRAP_OWNER_PASSWORD: 'mat-khau-rat-dai-123' };
    const log = await bootstrapProduction(t.prisma, env);
    expect(log.join('\n')).not.toContain(env.BOOTSTRAP_OWNER_PASSWORD);
    expect(await t.prisma.user.count()).toBe(1);
    expect(await t.prisma.building.count()).toBe(0);
    expect(await t.prisma.paymentAccount.count()).toBe(0);
    expect(await t.prisma.service.count()).toBeGreaterThan(0);

    const agent = request.agent(t.server);
    const login = await agent.post('/api/v1/auth/login').send({ email: 'chu.tro@example.vn', password: env.BOOTSTRAP_OWNER_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.body.user ?? me.body).toMatchObject({ display_name: 'Cô Lan' });
    const csrf = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('qt_csrf='))!.split(';')[0]!.slice('qt_csrf='.length);
    const b = await agent.post('/api/v1/buildings').set(CSRF_HEADER, csrf).send({ code: 'A', name: 'Tòa A' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);

    await bootstrapProduction(t.prisma, { ...env, BOOTSTRAP_OWNER_EMAIL: 'khac@example.vn' });
    expect(await t.prisma.user.count()).toBe(1);
  });

  it('mỗi lần triển khai đồng bộ lại quyền của vai trò (bản mới thêm quyền thì vai trò có ngay)', async () => {
    const staff = await t.prisma.role.findUniqueOrThrow({ where: { code: 'STAFF' } });
    const perm = await t.prisma.permission.findUniqueOrThrow({ where: { code: PERMISSIONS.REMINDERS_VIEW } });
    await t.prisma.rolePermission.deleteMany({ where: { roleId: staff.id, permissionId: perm.id } });
    await bootstrapProduction(t.prisma, {});
    expect(await t.prisma.rolePermission.count({ where: { roleId: staff.id, permissionId: perm.id } })).toBe(1);
  });
});
