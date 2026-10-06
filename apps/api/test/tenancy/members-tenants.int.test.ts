import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;

describe('Phase 2 — thành viên và người thuê', () => {
  let t: TestApp;
  let owner: Session;
  let tenancyId: string;

  const post = (url: string, body: unknown, s: Session = owner) => s.agent.post(url).set(CSRF_HEADER, s.csrf).send(body as object);
  const detail = async () => (await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    owner = await login(t, 'owner');
    const room = await createRoom(t, { maxOccupants: 2 });
    const res = await owner.agent
      .post('/api/v1/tenancies/move-in')
      .set(CSRF_HEADER, owner.csrf)
      .set('Idempotency-Key', `mt-${Date.now()}-${++keySeq}`)
      .send({
        room_id: room.id,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3000000',
        primary: { new_tenant: { full_name: 'Đại Diện', identity_number: '079123456789' } },
      });
    tenancyId = res.body.id;
  });
  afterAll(() => t.close());

  it('thêm thành viên trong sức chứa; vượt sức chứa bị chặn; thêm trùng người cùng thời gian bị chặn', async () => {
    const d = await detail();
    // Cùng một người không thể có hai khoảng ở chồng nhau trong cùng lần thuê (EXCLUDE) → 409
    const dup = await post(`/api/v1/tenancies/${tenancyId}/members`, { person: { tenant_id: d.members[0].tenant_id }, joined_on: '2026-10-06', expected_version: d.version });
    expect(dup.status).toBe(409);
    const add = await post(`/api/v1/tenancies/${tenancyId}/members`, { person: { new_tenant: { full_name: 'Thành Viên' } }, joined_on: '2026-10-05', expected_version: d.version });
    expect(add.status).toBe(200);
    expect(add.body.member_count).toBe(2);
    const full = await post(`/api/v1/tenancies/${tenancyId}/members`, { person: { new_tenant: { full_name: 'Người Thứ Ba' } }, joined_on: '2026-10-06', expected_version: add.body.version });
    expect(full.status).toBe(422);
  });

  it('đại diện rời đi phải chọn người mới; người cuối cùng không “rời” được; lịch sử giữ nguyên', async () => {
    let d = await detail();
    const lastLeave = await post(`/api/v1/members/${d.members[0].id}/leave`, { last_day: '2026-10-20', expected_version: d.version });
    expect(lastLeave.status).toBe(422);

    d = (await post(`/api/v1/tenancies/${tenancyId}/members`, { person: { new_tenant: { full_name: 'Người Kế' } }, joined_on: '2026-10-05', expected_version: d.version })).body;
    const primary = d.members.find((m: { role: string }) => m.role === 'PRIMARY');
    const member = d.members.find((m: { role: string }) => m.role === 'MEMBER');
    const noNew = await post(`/api/v1/members/${primary.id}/leave`, { last_day: '2026-10-20', expected_version: d.version });
    expect(noNew.status).toBe(422);
    const ok = await post(`/api/v1/members/${primary.id}/leave`, { last_day: '2026-10-20', new_primary_member_id: member.id, expected_version: d.version });
    expect(ok.status).toBe(200);
    const after = ok.body.members;
    expect(after.find((m: { id: string }) => m.id === primary.id)).toMatchObject({ left_on: '2026-10-20', role: 'MEMBER' });
    expect(after.find((m: { id: string }) => m.id === member.id).role).toBe('PRIMARY');
    expect(await t.prisma.tenancyTenant.count({ where: { tenancyId } })).toBe(2);
  });

  it('đổi đại diện và cập nhật tạm trú', async () => {
    let d = await detail();
    d = (await post(`/api/v1/tenancies/${tenancyId}/members`, { person: { new_tenant: { full_name: 'Người B' } }, joined_on: '2026-10-02', expected_version: d.version })).body;
    const b = d.members.find((m: { full_name: string }) => m.full_name === 'Người B');
    const sp = await post(`/api/v1/members/${b.id}/set-primary`, { expected_version: d.version });
    expect(sp.body.primary_tenant_name).toBe('Người B');
    expect(sp.body.members.filter((m: { role: string }) => m.role === 'PRIMARY')).toHaveLength(1);
    const res = await post(`/api/v1/members/${b.id}/residence`, {
      residence_status: 'REGISTERED',
      residence_registered_on: '2026-10-03',
      expected_version: sp.body.members.find((m: { id: string }) => m.id === b.id).version,
    });
    expect(res.body.members.find((m: { id: string }) => m.id === b.id)).toMatchObject({ residence_status: 'REGISTERED', residence_registered_on: '2026-10-03' });
  });

  it('CCCD bị che với STAFF, đầy đủ với OWNER; cảnh báo trùng CCCD khi tạo người mới', async () => {
    const d = await detail();
    const tenantId = d.members[0].tenant_id;
    expect((await owner.agent.get(`/api/v1/tenants/${tenantId}`)).body).toMatchObject({ identity_number: '079123456789', identity_masked: false });
    const staff = await login(t, 'staffA');
    expect((await staff.agent.get(`/api/v1/tenants/${tenantId}`)).body).toMatchObject({ identity_number: '********6789', identity_masked: true });
    // STAFF không tìm được theo số CCCD
    expect((await staff.agent.get('/api/v1/tenants?q=079123456789')).body.total).toBe(0);

    const dup = await post('/api/v1/tenants', { full_name: 'Người Trùng', identity_number: '079123456789' });
    expect(dup.status).toBe(201);
    expect(dup.body.duplicate_identity).toEqual([{ id: tenantId, full_name: 'Đại Diện' }]);
  });

  it('STAFF tòa khác không thấy lần thuê và người thuê của tòa A', async () => {
    const staff = await login(t, 'staffBC');
    expect((await staff.agent.get(`/api/v1/tenancies/${tenancyId}`)).status).toBe(404);
    const d = await detail();
    expect((await staff.agent.get(`/api/v1/tenants/${d.members[0].tenant_id}`)).status).toBe(404);
    expect((await staff.agent.get('/api/v1/tenancies')).body.total).toBe(0);
  });
});
