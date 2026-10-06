import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COOKIE_NAMES,
  CSRF_HEADER,
  SEED_USERS,
  TEST_PASSWORDS,
  cookieValue,
  createTestApp,
  getSetCookies,
  login,
  resetDatabase,
  type TestApp,
} from '../helpers/test-app.js';

describe('Auth: đăng nhập, phiên, refresh, đăng xuất', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => resetDatabase(t));
  afterAll(() => t.close());

  it('đăng nhập đặt 3 cookie với thuộc tính đúng', async () => {
    const res = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: SEED_USERS.owner.email, password: TEST_PASSWORDS.owner });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const cookies = getSetCookies(res);
    const access = cookies.find((c) => c.startsWith(`${COOKIE_NAMES.ACCESS}=`));
    const refresh = cookies.find((c) => c.startsWith(`${COOKIE_NAMES.REFRESH}=`));
    const csrf = cookies.find((c) => c.startsWith(`${COOKIE_NAMES.CSRF}=`));
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(access).toMatch(/Path=\/;/);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
    expect(csrf).not.toMatch(/HttpOnly/i);
    // COOKIE_SECURE=false ở môi trường test/dev
    expect(access).not.toMatch(/Secure/);
  });

  it('refresh token chỉ lưu dạng hash trong database', async () => {
    const s = await login(t, 'owner');
    const raw = cookieValue(s.setCookies, COOKIE_NAMES.REFRESH)!;
    const secret = decodeURIComponent(raw).split('.')[1]!;
    const rows = await t.prisma.refreshSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(secret);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('/auth/me trả quyền và phạm vi tòa', async () => {
    const owner = await login(t, 'owner');
    const me = await owner.agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(SEED_USERS.owner.email);
    expect(me.body.roles).toEqual(['OWNER']);
    expect(me.body.all_buildings).toBe(true);
    expect(me.body.buildings.map((b: { code: string }) => b.code)).toEqual(['A', 'B', 'C']);
    expect(me.body.permissions).toContain('finance.reverse');

    const staff = await login(t, 'staffBC');
    const meStaff = await staff.agent.get('/api/v1/auth/me');
    expect(meStaff.body.all_buildings).toBe(false);
    expect(meStaff.body.buildings.map((b: { code: string }) => b.code)).toEqual(['B', 'C']);
    expect(meStaff.body.permissions).not.toContain('finance.reverse');
  });

  it('sai mật khẩu và email không tồn tại trả cùng một lỗi', async () => {
    const wrong = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: SEED_USERS.owner.email, password: 'sai-mat-khau' });
    const unknown = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: 'khong-ton-tai@example.test', password: 'sai-mat-khau' });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      expect(getSetCookies(res)).toHaveLength(0);
    }
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('email không phân biệt hoa thường', async () => {
    const res = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: '  OWNER@Example.TEST ', password: TEST_PASSWORDS.owner });
    expect(res.status).toBe(200);
  });

  it('dữ liệu đăng nhập sai định dạng trả 400 kèm field_errors; field lạ bị từ chối', async () => {
    const res = await request(t.server).post('/api/v1/auth/login').send({ email: 'abc', password: '', admin: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.field_errors)).toEqual(expect.arrayContaining(['email', 'password', 'admin']));
  });

  it('tài khoản bị vô hiệu hóa không đăng nhập được và phiên cũ mất hiệu lực ngay', async () => {
    const s = await login(t, 'staffA');
    await t.prisma.user.update({ where: { email: SEED_USERS.staffA.email }, data: { isActive: false } });
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(401);
    const res = await request(t.server)
      .post('/api/v1/auth/login')
      .send({ email: SEED_USERS.staffA.email, password: TEST_PASSWORDS.staff });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('chặn sau 5 lần sai liên tiếp trong 15 phút, mở lại khi hết cửa sổ', async () => {
    const attempt = (password: string) =>
      request(t.server).post('/api/v1/auth/login').send({ email: SEED_USERS.owner.email, password });
    for (let i = 0; i < 5; i++) expect((await attempt('sai-mat-khau')).status).toBe(401);
    const blocked = await attempt(TEST_PASSWORDS.owner);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS');

    t.clock.advanceMs(15 * 60 * 1000 + 1);
    expect((await attempt(TEST_PASSWORDS.owner)).status).toBe(200);
  });

  it('access token hết hạn theo Clock trả 401; refresh cấp lại phiên', async () => {
    const s = await login(t, 'owner');
    t.clock.advanceMs(16 * 60 * 1000);
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(401);

    const refreshed = await s.agent.post('/api/v1/auth/refresh').set(CSRF_HEADER, s.csrf);
    expect(refreshed.status).toBe(200);
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('refresh xoay vòng token; dùng lại token cũ thu hồi cả họ phiên', async () => {
    const s = await login(t, 'owner');
    const oldRefresh = cookieValue(s.setCookies, COOKIE_NAMES.REFRESH)!;

    const first = await s.agent.post('/api/v1/auth/refresh').set(CSRF_HEADER, s.csrf);
    expect(first.status).toBe(200);
    const newRefresh = cookieValue(getSetCookies(first), COOKIE_NAMES.REFRESH)!;
    expect(newRefresh).not.toBe(oldRefresh);

    // Kẻ gian dùng lại refresh token cũ
    const replay = await request(t.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`${COOKIE_NAMES.REFRESH}=${oldRefresh}`, `${COOKIE_NAMES.CSRF}=${s.csrf}`])
      .set(CSRF_HEADER, s.csrf);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

    // Cả họ phiên bị thu hồi: token mới và access token hiện tại đều mất hiệu lực
    const afterReuse = await s.agent.post('/api/v1/auth/refresh').set(CSRF_HEADER, s.csrf);
    expect(afterReuse.status).toBe(401);
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(401);
    const sessions = await t.prisma.refreshSession.findMany();
    expect(sessions.every((x) => x.revokedAt !== null)).toBe(true);
    expect(await t.prisma.auditLog.count({ where: { action: 'auth.refresh_reuse_detected' } })).toBe(1);
  });

  it('refresh token hết hạn bị từ chối', async () => {
    const s = await login(t, 'owner');
    t.clock.advanceMs(31 * 24 * 60 * 60 * 1000);
    const res = await s.agent.post('/api/v1/auth/refresh').set(CSRF_HEADER, s.csrf);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('đăng xuất thu hồi phiên, xóa cookie; refresh sau đó thất bại', async () => {
    const s = await login(t, 'owner');
    const refreshCookie = cookieValue(s.setCookies, COOKIE_NAMES.REFRESH)!;
    const out = await s.agent.post('/api/v1/auth/logout').set(CSRF_HEADER, s.csrf);
    expect(out.status).toBe(200);
    expect(getSetCookies(out).some((c) => c.startsWith(`${COOKIE_NAMES.ACCESS}=;`))).toBe(true);

    const reuse = await request(t.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`${COOKIE_NAMES.REFRESH}=${refreshCookie}`, `${COOKIE_NAMES.CSRF}=${s.csrf}`])
      .set(CSRF_HEADER, s.csrf);
    expect(reuse.status).toBe(401);
    expect(await t.prisma.refreshSession.count({ where: { revokedReason: 'logout' } })).toBe(1);
  });

  it('access token giả mạo chữ ký bị từ chối', async () => {
    const s = await login(t, 'owner');
    const access = cookieValue(s.setCookies, COOKIE_NAMES.ACCESS)!;
    const [h, p] = access.split('.');
    const forged = `${h}.${p}.${'A'.repeat(43)}`;
    const res = await request(t.server).get('/api/v1/auth/me').set('Cookie', `${COOKIE_NAMES.ACCESS}=${forged}`);
    expect(res.status).toBe(401);
  });
});
