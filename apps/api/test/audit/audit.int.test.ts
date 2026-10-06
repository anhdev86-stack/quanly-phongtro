import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { SEED_USERS, TEST_PASSWORDS, createTestApp, login, resetDatabase, type TestApp } from '../helpers/test-app.js';

describe('Audit log', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
  });
  afterAll(() => t.close());

  it('ghi đăng nhập thành công và thất bại, không chứa mật khẩu hay token', async () => {
    await request(t.server).post('/api/v1/auth/login').send({ email: SEED_USERS.owner.email, password: 'sai-mat-khau-xyz' });
    await login(t, 'owner');

    const rows = await t.prisma.auditLog.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['auth.login_failed', 'auth.login']);
    const dump = JSON.stringify(rows);
    for (const secret of ['sai-mat-khau-xyz', TEST_PASSWORDS.owner, '$argon2']) {
      expect(dump).not.toContain(secret);
    }
    expect(rows[1]!.requestId).toEqual(expect.any(String));
  });

  it('che dữ liệu nhạy cảm trong before/after khi ghi', async () => {
    const audit = t.app.get(AuditService);
    const id = await audit.record(t.prisma, {
      workspaceId: SEED_IDS.workspace,
      actorId: null,
      action: 'probe.redact',
      entityType: 'tenant',
      after: { full_name: 'Nguyễn Văn Mẫu', identity_number: '079123456789', password: 'x', amount: 3500000n },
    });
    const row = await t.prisma.auditLog.findUniqueOrThrow({ where: { id } });
    expect(row.after).toEqual({
      full_name: 'Nguyễn Văn Mẫu',
      identity_number: '********6789',
      password: '[REDACTED]',
      amount: '3500000',
    });
  });

  it('audit ghi trong transaction bị rollback cùng nghiệp vụ', async () => {
    const audit = t.app.get(AuditService);
    const before = await t.prisma.auditLog.count();
    await expect(
      t.prisma.$transaction(async (tx) => {
        await audit.record(tx, { workspaceId: SEED_IDS.workspace, actorId: null, action: 'probe.tx', entityType: 'probe' });
        throw new Error('nghiệp vụ lỗi');
      }),
    ).rejects.toThrow('nghiệp vụ lỗi');
    expect(await t.prisma.auditLog.count()).toBe(before);
  });
});
