import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type TestApp } from '../helpers/test-app.js';

describe('CSRF double-submit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
  });
  afterAll(() => t.close());

  it('mutation thiếu header X-CSRF-Token bị từ chối 403', async () => {
    const s = await login(t, 'owner');
    const res = await s.agent.post('/api/v1/__probe/owner-only');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('header không khớp cookie bị từ chối', async () => {
    const s = await login(t, 'owner');
    const res = await s.agent.post('/api/v1/__probe/owner-only').set(CSRF_HEADER, `${s.csrf.slice(0, -1)}x`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('header khớp cookie thì qua', async () => {
    const s = await login(t, 'owner');
    const res = await s.agent.post('/api/v1/__probe/owner-only').set(CSRF_HEADER, s.csrf);
    expect(res.status).toBe(201);
  });

  it('GET không cần CSRF', async () => {
    const s = await login(t, 'owner');
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('refresh và logout cũng cần CSRF', async () => {
    const s = await login(t, 'owner');
    expect((await s.agent.post('/api/v1/auth/refresh')).status).toBe(403);
    expect((await s.agent.post('/api/v1/auth/logout')).status).toBe(403);
  });

  it('kẻ tấn công chỉ có header (không có cookie) bị từ chối', async () => {
    const res = await request(t.server).post('/api/v1/auth/logout').set(CSRF_HEADER, 'a'.repeat(43));
    expect(res.status).toBe(403);
  });
});
