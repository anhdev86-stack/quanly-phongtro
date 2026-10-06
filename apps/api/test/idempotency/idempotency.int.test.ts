import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

const URL = '/api/v1/__probe/idempotent';

describe('Idempotency-Key (MASTER_PLAN 9.5)', () => {
  let t: TestApp;
  let owner: Session;

  const call = (s: Session, key: string | undefined, body: Record<string, unknown>) => {
    const req = s.agent.post(URL).set(CSRF_HEADER, s.csrf);
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const probeRows = () => t.prisma.auditLog.count({ where: { action: 'probe.idempotent' } });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    owner = await login(t, 'owner');
  });
  afterAll(() => t.close());

  it('thiếu key trả 400 IDEMPOTENCY_KEY_REQUIRED; key sai định dạng trả 400', async () => {
    const missing = await call(owner, undefined, { note: 'a' });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const tooShort = await call(owner, 'short', { note: 'a' });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
    const badChars = await call(owner, 'key/with/slash', { note: 'a' });
    expect(badChars.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect(await probeRows()).toBe(0);
  });

  it('cùng key, cùng payload: trả lại đúng kết quả cũ, nghiệp vụ chỉ chạy một lần', async () => {
    const first = await call(owner, 'key-same-0001', { note: 'thu tiền', delayMs: 0 });
    expect(first.status).toBe(201);
    // Thứ tự field khác nhau vẫn là cùng payload
    const second = await call(owner, 'key-same-0001', { delayMs: 0, note: 'thu tiền' });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await probeRows()).toBe(1);
  });

  it('cùng key, khác payload: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    await call(owner, 'key-diff-0001', { note: 'a' });
    const res = await call(owner, 'key-diff-0001', { note: 'b' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await probeRows()).toBe(1);
  });

  it('5 request đồng thời cùng key: chỉ một lần ghi, mọi response giống nhau', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call(owner, 'key-concurrent-01', { note: 'song song', delayMs: 300 })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const ids = new Set(results.map((r) => r.body.auditId));
    expect(ids.size).toBe(1);
    expect(await probeRows()).toBe(1);
    expect(await t.prisma.idempotencyRequest.count()).toBe(1);
  });

  it('nghiệp vụ lỗi giữa chừng: rollback toàn bộ, không lưu key; gọi lại cùng key thì chạy lại', async () => {
    const failed = await call(owner, 'key-rollback-01', { note: 'x', fail: true });
    expect(failed.status).toBe(422);
    expect(await probeRows()).toBe(0);
    expect(await t.prisma.idempotencyRequest.count()).toBe(0);

    // Lần sau payload khác (không còn fail) vẫn dùng được key vì lần trước không commit gì
    const retry = await call(owner, 'key-rollback-01', { note: 'x' });
    expect(retry.status).toBe(201);
    expect(await probeRows()).toBe(1);
  });

  it('cùng key nhưng khác người dùng là hai yêu cầu độc lập', async () => {
    const staff = await login(t, 'staffA');
    const a = await call(owner, 'key-per-actor-1', { note: 'n' });
    const b = await call(staff, 'key-per-actor-1', { note: 'n' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.auditId).not.toBe(b.body.auditId);
    expect(await probeRows()).toBe(2);
  });

  it('kết quả lưu cùng transaction: response đã commit lấy lại được dù client mất kết nối', async () => {
    const first = await call(owner, 'key-crash-0001', { note: 'mất mạng' });
    // Giả lập client không nhận được response: chỉ còn key; gọi lại vẫn nhận kết quả đã commit
    const stored = await t.prisma.idempotencyRequest.findFirstOrThrow({ where: { key: 'key-crash-0001' } });
    expect(stored.status).toBe('DONE');
    expect(stored.resultReference).toBe(first.body.auditId);
    const retry = await call(owner, 'key-crash-0001', { note: 'mất mạng' });
    expect(retry.body).toEqual(first.body);
  });
});
