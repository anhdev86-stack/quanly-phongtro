import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type TestApp } from '../helpers/test-app.js';

describe('Quyền và phạm vi tòa (enforce ở backend)', () => {
  let t: TestApp;
  let otherWorkspaceBuildingId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
    const other = await t.prisma.workspace.create({ data: { name: 'Workspace khác' } });
    const b = await t.prisma.building.create({ data: { workspaceId: other.id, code: 'X', name: 'Tòa của workspace khác' } });
    otherWorkspaceBuildingId = b.id;
  });
  afterAll(() => t.close());

  it('chưa đăng nhập trả 401', async () => {
    const res = await request(t.server).get(`/api/v1/__probe/buildings/${SEED_IDS.buildings.A}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('STAFF tòa A xem được tòa A', async () => {
    const s = await login(t, 'staffA');
    const res = await s.agent.get(`/api/v1/__probe/buildings/${SEED_IDS.buildings.A}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('A');
  });

  it('STAFF tòa A truy cập tòa B bằng ID trả 404 như không tồn tại', async () => {
    const s = await login(t, 'staffA');
    const res = await s.agent.get(`/api/v1/__probe/buildings/${SEED_IDS.buildings.B}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('danh sách chỉ gồm tòa trong phạm vi', async () => {
    const a = await login(t, 'staffA');
    expect((await a.agent.get('/api/v1/__probe/buildings')).body).toEqual(['A']);
    const bc = await login(t, 'staffBC');
    expect((await bc.agent.get('/api/v1/__probe/buildings')).body).toEqual(['B', 'C']);
    const owner = await login(t, 'owner');
    expect((await owner.agent.get('/api/v1/__probe/buildings')).body).toEqual(['A', 'B', 'C']);
  });

  it('OWNER cũng không thấy tòa của workspace khác', async () => {
    const s = await login(t, 'owner');
    const res = await s.agent.get(`/api/v1/__probe/buildings/${otherWorkspaceBuildingId}`);
    expect(res.status).toBe(404);
  });

  it('ID sai định dạng trả 400, không gây lỗi database', async () => {
    const s = await login(t, 'owner');
    const res = await s.agent.get('/api/v1/__probe/buildings/khong-phai-uuid');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('thiếu quyền trả 403; OWNER có quyền thì qua', async () => {
    const staff = await login(t, 'staffA');
    const denied = await staff.agent.post('/api/v1/__probe/owner-only').set(CSRF_HEADER, staff.csrf);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');

    const owner = await login(t, 'owner');
    expect((await owner.agent.post('/api/v1/__probe/owner-only').set(CSRF_HEADER, owner.csrf)).status).toBe(201);
  });

  it('thu hồi phạm vi có hiệu lực ngay ở request kế tiếp (quyền đọc lại từ DB)', async () => {
    const s = await login(t, 'staffA');
    expect((await s.agent.get(`/api/v1/__probe/buildings/${SEED_IDS.buildings.A}`)).status).toBe(200);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: 'staff.a@example.test' } });
    await t.prisma.userBuildingScope.deleteMany({ where: { userId: user.id } });
    expect((await s.agent.get(`/api/v1/__probe/buildings/${SEED_IDS.buildings.A}`)).status).toBe(404);
  });

  it('database chặn gán phạm vi tòa của workspace khác (FK kép)', async () => {
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: 'staff.bc@example.test' } });
    await expect(
      t.prisma.userBuildingScope.create({
        data: { userId: user.id, buildingId: otherWorkspaceBuildingId, workspaceId: user.workspaceId },
      }),
    ).rejects.toThrow();
  });
});
