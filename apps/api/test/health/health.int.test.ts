import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, type TestApp } from '../helpers/test-app.js';

describe('health, error envelope, request id', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
  });
  afterAll(() => t.close());

  it('liveness trả ok, không cần đăng nhập', async () => {
    const res = await request(t.server).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('readiness kiểm tra database và không lộ biến môi trường', async () => {
    const res = await request(t.server).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok' } });
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/postgres|DATABASE_URL|secret|password/i);
  });

  it('route không tồn tại trả error envelope tiếng Việt kèm request_id', async () => {
    const res = await request(t.server).get('/api/v1/khong-ton-tai');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      code: 'ROUTE_NOT_FOUND',
      message: 'Không tìm thấy đường dẫn.',
      request_id: expect.any(String),
    });
    expect(res.headers['x-request-id']).toBe(res.body.request_id);
  });

  it('dùng lại X-Request-Id hợp lệ từ client, bỏ qua giá trị không hợp lệ', async () => {
    const ok = await request(t.server).get('/api/v1/khong-ton-tai').set('X-Request-Id', 'client-req-12345');
    expect(ok.body.request_id).toBe('client-req-12345');
    const bad = await request(t.server).get('/api/v1/khong-ton-tai').set('X-Request-Id', 'x"; drop');
    expect(bad.body.request_id).not.toBe('x"; drop');
  });

  it('header bảo mật của helmet có mặt, không lộ X-Powered-By', async () => {
    const res = await request(t.server).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
