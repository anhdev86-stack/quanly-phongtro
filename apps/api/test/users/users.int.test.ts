import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

describe('Phase 1 — quản lý người dùng', () => {
  let t: TestApp;
  let owner: Session;

  const send = (method: 'post' | 'patch' | 'put', url: string, body: unknown, s: Session = owner) =>
    s.agent[method](url).set(CSRF_HEADER, s.csrf).send(body as object);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    owner = await login(t, 'owner');
  });
  afterAll(() => t.close());

  it('tạo quản lý với phạm vi tòa; đăng nhập được và chỉ thấy tòa đó', async () => {
    const res = await send('post', '/api/v1/users', {
      email: 'Moi.NV@example.test',
      display_name: 'Quản lý mới',
      password: 'mat-khau-moi-123',
      role: 'MANAGER',
      building_ids: [SEED_IDS.buildings.C],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'moi.nv@example.test', roles: ['MANAGER'], buildings: [{ code: 'C' }] });
    expect(JSON.stringify(res.body)).not.toContain('mat-khau');

    const login2 = await request(t.server).post('/api/v1/auth/login').send({ email: 'moi.nv@example.test', password: 'mat-khau-moi-123' });
    expect(login2.status).toBe(200);
  });

  it('email trùng trả 409; chỉ gán được Chủ trọ/Quản lý — vai trò cũ Nhân viên/Kế toán bị từ chối (D-041)', async () => {
    expect((await send('post', '/api/v1/users', { email: 'owner@example.test', display_name: 'x', password: '12345678', role: 'MANAGER' })).status).toBe(409);
    for (const role of ['STAFF', 'ACCOUNTANT']) {
      expect((await send('post', '/api/v1/users', { email: `${role.toLowerCase()}@example.test`, display_name: 'x', password: '12345678', role })).status).toBe(400);
    }
    const ql = await send('post', '/api/v1/users', { email: 'ql@example.test', display_name: 'x', password: '12345678', role: 'MANAGER' });
    expect(ql.status, JSON.stringify(ql.body)).toBe(201);
    expect(ql.body.roles).toEqual(['MANAGER']);
  });

  it('STAFF không truy cập được quản lý người dùng', async () => {
    const staff = await login(t, 'staffA');
    expect((await staff.agent.get('/api/v1/users')).status).toBe(403);
  });

  it('không tự vô hiệu hóa, không tự bỏ vai trò chủ trọ, luôn còn ít nhất một chủ trọ', async () => {
    const me = (await owner.agent.get('/api/v1/auth/me')).body;
    expect((await send('patch', `/api/v1/users/${me.id}`, { is_active: false, expected_version: 1 })).status).toBe(422);
    expect((await send('patch', `/api/v1/users/${me.id}`, { role: 'MANAGER', expected_version: 1 })).status).toBe(422);
  });

  it('vô hiệu hóa nhân viên thu hồi phiên ngay', async () => {
    const staff = await login(t, 'staffA');
    const target = (await owner.agent.get('/api/v1/users')).body.find((u: { email: string }) => u.email === 'staff.a@example.test');
    const res = await send('patch', `/api/v1/users/${target.id}`, { is_active: false, expected_version: target.version });
    expect(res.body.is_active).toBe(false);
    expect((await staff.agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('đổi phạm vi tòa có hiệu lực ngay; tòa không tồn tại bị từ chối', async () => {
    const staff = await login(t, 'staffA');
    const target = (await owner.agent.get('/api/v1/users')).body.find((u: { email: string }) => u.email === 'staff.a@example.test');
    const res = await send('put', `/api/v1/users/${target.id}/building-scopes`, { building_ids: [SEED_IDS.buildings.B], expected_version: target.version });
    expect(res.body.buildings.map((b: { code: string }) => b.code)).toEqual(['B']);
    expect((await staff.agent.get('/api/v1/buildings')).body.map((b: { code: string }) => b.code)).toEqual(['B']);
    const bad = await send('put', `/api/v1/users/${target.id}/building-scopes`, {
      building_ids: ['01920000-0000-7000-8000-0000000000ff'],
      expected_version: res.body.version,
    });
    expect(bad.status).toBe(422);
  });

  it('đặt lại mật khẩu: mật khẩu cũ hết dùng được, phiên cũ bị thu hồi', async () => {
    const staff = await login(t, 'staffBC');
    const target = (await owner.agent.get('/api/v1/users')).body.find((u: { email: string }) => u.email === 'staff.bc@example.test');
    expect((await send('post', `/api/v1/users/${target.id}/reset-password`, { new_password: 'mat-khau-dat-lai-1', expected_version: target.version })).status).toBe(200);
    expect((await staff.agent.get('/api/v1/auth/me')).status).toBe(401);
    const ok = await request(t.server).post('/api/v1/auth/login').send({ email: 'staff.bc@example.test', password: 'mat-khau-dat-lai-1' });
    expect(ok.status).toBe(200);
    expect(await t.prisma.auditLog.count({ where: { action: 'user.reset_password' } })).toBe(1);
  });
});
