import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

type Operation = { responses?: Record<string, unknown>; 'x-public'?: boolean; 'x-permissions'?: string[] };

describe('OpenAPI (MASTER_PLAN mục 10: mọi endpoint có request/response và permission)', () => {
  let t: TestApp;
  let paths: Record<string, Record<string, Operation>>;

  beforeAll(async () => {
    t = await createTestApp();
    const res = await request(t.server).get('/api/v1/docs-json');
    expect(res.status).toBe(200);
    paths = res.body.paths;
  });
  afterAll(() => t.close());

  it('có các endpoint auth và health', () => {
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
        '/api/v1/auth/logout',
        '/api/v1/auth/me',
        '/api/v1/health/live',
        '/api/v1/health/ready',
      ]),
    );
  });

  it('mọi operation khai báo x-public hoặc x-permissions, và có response 2xx kèm schema', () => {
    const problems: string[] = [];
    for (const [p, methods] of Object.entries(paths)) {
      if (p.startsWith('/api/v1/__probe')) continue; // endpoint chỉ có trong test
      for (const [method, op] of Object.entries(methods)) {
        const where = `${method.toUpperCase()} ${p}`;
        if (op['x-public'] !== true && !Array.isArray(op['x-permissions'])) problems.push(`${where}: thiếu x-public/x-permissions`);
        const ok = Object.entries(op.responses ?? {}).find(([code]) => code.startsWith('2'));
        if (!ok || !(ok[1] as { content?: unknown }).content) problems.push(`${where}: thiếu response 2xx có schema`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('chỉ login, refresh, logout, health và xem thông báo qua link là public (MASTER_PLAN 10)', () => {
    const publicOps = Object.entries(paths)
      .flatMap(([p, methods]) => Object.entries(methods).map(([m, op]) => ({ key: `${m.toUpperCase()} ${p}`, op })))
      .filter((x) => x.op['x-public'] === true)
      .map((x) => x.key)
      .sort();
    expect(publicOps).toEqual([
      'GET /api/v1/health/live',
      'GET /api/v1/health/ready',
      'GET /api/v1/public/invoices/{token}',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'POST /api/v1/auth/refresh',
    ]);
  });
});
