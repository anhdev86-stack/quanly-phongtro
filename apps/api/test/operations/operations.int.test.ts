import type { FileDto, MaintenanceDto } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('anh-thu-nghiem')]);
const PDF = Buffer.from('%PDF-1.4\n% hop dong scan thu nghiem\n');
let keySeq = 0;

describe('Phase 13 — tệp riêng tư (T34 cho tệp) và yêu cầu bảo trì', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const upload = (s: Session, fields: Record<string, string>, data: Buffer = PNG, name = 'cccd mặt trước.png') => {
    const r = s.agent.post('/api/v1/files').set(CSRF_HEADER, s.csrf);
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r.attach('file', data, name);
  };
  const json = (s: Session, method: 'post' | 'patch', url: string, body: unknown) => s.agent[method](url).set(CSRF_HEADER, s.csrf).send(body as object);

  async function moveIn(building: 'A' | 'B') {
    const room = await createRoom(t, { building });
    const res = await owner.agent
      .post('/api/v1/tenancies/move-in')
      .set(CSRF_HEADER, owner.csrf)
      .set('Idempotency-Key', `p13-${Date.now()}-${++keySeq}`)
      .send({ room_id: room.id, start_date: '2026-10-01', monthly_rent_vnd: '3000000', deposit_required_vnd: '0', primary: { new_tenant: { full_name: `Khách ${building}` } } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tenancy = (await owner.agent.get(`/api/v1/tenancies/${res.body.id}`)).body;
    return { roomId: room.id, tenancyId: res.body.id as string, tenantId: tenancy.members[0].tenant_id as string };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    await at('2026-10-01');
  });
  afterAll(() => t.close());

  it('tải lên/tải xuống: kiểm tra chữ ký tệp, phạm vi tòa (404), quyền giấy tờ tùy thân, nhật ký khi xem CCCD, lưu trữ không xóa', async () => {
    const a = await moveIn('A');
    const b = await moveIn('B');

    // Sai định dạng (đuôi .png nhưng nội dung không phải ảnh) → 400; thiếu tệp → 400
    expect((await upload(owner, { owner_type: 'tenant', owner_id: a.tenantId, category: 'IDENTITY' }, Buffer.from('<script>alert(1)</script>'), 'x.png')).status).toBe(400);
    expect((await owner.agent.post('/api/v1/files').set(CSRF_HEADER, owner.csrf).field('owner_type', 'tenant').field('owner_id', a.tenantId).field('category', 'OTHER')).status).toBe(400);
    // Tệp quá 10 MB → bị chặn
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    const tooBig = await upload(owner, { owner_type: 'tenancy', owner_id: a.tenancyId, category: 'OTHER' }, big, 'lon.pdf');
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.code).toBe('VALIDATION_FAILED');
    expect(await t.prisma.storedFile.count()).toBe(0);

    const id = await upload(owner, { owner_type: 'tenant', owner_id: a.tenantId, category: 'IDENTITY' });
    expect(id.status, JSON.stringify(id.body)).toBe(201);
    const idFile: FileDto = id.body;
    expect(idFile).toMatchObject({ mime: 'image/png', original_name: 'cccd mặt trước.png', category: 'IDENTITY' });
    const scan = await upload(owner, { owner_type: 'tenancy', owner_id: a.tenancyId, category: 'CONTRACT_SCAN' }, PDF, 'hop-dong.pdf');
    expect(scan.status).toBe(201);
    expect(scan.body.mime).toBe('application/pdf');

    // Chủ trọ tải được, nội dung đúng, header an toàn; xem CCCD có nhật ký
    const dl = await owner.agent.get(idFile.url).buffer(true);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['cache-control']).toContain('no-store');
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    expect(await t.prisma.auditLog.count({ where: { action: 'file.view_identity', entityId: idFile.id } })).toBe(1);

    // Nhân viên tòa A: không có files.identity.view → không thấy tên tệp CCCD, tải CCCD 404, tải lên CCCD 403; vẫn thấy bản scan
    const staffA = await login(t, 'staffA');
    const list = (await staffA.agent.get(`/api/v1/files?owner_type=tenant&owner_id=${a.tenantId}`)).body as FileDto[];
    expect(list).toEqual([]);
    expect((await staffA.agent.get(idFile.url)).status).toBe(404);
    expect((await upload(staffA, { owner_type: 'tenant', owner_id: a.tenantId, category: 'IDENTITY' })).status).toBe(403);
    expect((await staffA.agent.get(`/api/v1/files?owner_type=tenancy&owner_id=${a.tenancyId}`)).body.map((f: FileDto) => f.original_name)).toEqual(['hop-dong.pdf']);
    expect((await staffA.agent.get(scan.body.url)).status).toBe(200);

    // T34: người ngoài tòa A (kế toán tòa B, nhân viên B/C) → 404 khi xem/tải/tải lên vào đối tượng tòa A
    const accB = await login(t, 'accountantB');
    expect((await accB.agent.get(scan.body.url)).status).toBe(404);
    expect((await accB.agent.get(`/api/v1/files?owner_type=tenancy&owner_id=${a.tenancyId}`)).status).toBe(404);
    expect((await upload(await login(t, 'managerA'), { owner_type: 'tenancy', owner_id: b.tenancyId, category: 'OTHER' })).status).toBe(404);
    // Id không tồn tại → 404
    expect((await owner.agent.get('/api/v1/files/01920000-0000-7000-8000-00000000ffff/content')).status).toBe(404);

    // Lưu trữ: cần lý do; sau đó không tải được, vẫn còn khi xem kèm lưu trữ; dữ liệu trong kho không bị xóa
    expect((await json(owner, 'post', `/api/v1/files/${scan.body.id}/archive`, {})).status).toBe(400);
    const arch = await json(owner, 'post', `/api/v1/files/${scan.body.id}/archive`, { reason: 'Tải nhầm bản cũ' });
    expect(arch.status).toBe(200);
    expect(arch.body.archive_reason).toBe('Tải nhầm bản cũ');
    expect((await owner.agent.get(scan.body.url)).status).toBe(404);
    expect((await owner.agent.get(`/api/v1/files?owner_type=tenancy&owner_id=${a.tenancyId}&include_archived=true`)).body).toHaveLength(1);
    expect(await t.prisma.storedFile.count()).toBe(2);
  });

  it('bảo trì: tạo theo phòng (gắn lần thuê đang mở), chuyển trạng thái hợp lệ, xong có thời điểm, liên kết khoản chi; phạm vi tòa; việc cần xử lý', async () => {
    const a = await moveIn('A');
    const roomB = await createRoom(t, { building: 'B' });
    const staffA = await login(t, 'staffA');
    const c = await json(staffA, 'post', '/api/v1/maintenance-requests', { room_id: a.roomId, title: 'Vòi nước rò rỉ', priority: 'HIGH', reported_by: 'Khách A' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const m: MaintenanceDto = c.body;
    expect(m).toMatchObject({ code: 'BT-2610-0001', status: 'OPEN', priority: 'HIGH', tenancy_id: a.tenancyId, building_code: 'A' });
    // Ngoài phạm vi
    expect((await json(staffA, 'post', '/api/v1/maintenance-requests', { room_id: roomB.id, title: 'Hỏng đèn' })).status).toBe(404);
    expect((await (await login(t, 'accountantB')).agent.get(`/api/v1/maintenance-requests/${m.id}`)).status).toBe(404);
    // Kế toán xem được nhưng không tạo
    expect((await json(await login(t, 'accountantB'), 'post', '/api/v1/maintenance-requests', { room_id: roomB.id, title: 'Hỏng đèn' })).status).toBe(403);

    // Việc cần xử lý
    const todo = (await owner.agent.get('/api/v1/dashboard')).body.todo as { kind: string; count: number }[];
    expect(todo.find((x) => x.kind === 'MAINTENANCE_OPEN')?.count).toBe(1);

    // Chuyển trạng thái: OPEN → IN_PROGRESS → DONE (có thời điểm) ; DONE → CANCELLED không hợp lệ ; sai version 409
    const u1 = await json(staffA, 'patch', `/api/v1/maintenance-requests/${m.id}`, { status: 'IN_PROGRESS', assignee_id: (await t.prisma.user.findUniqueOrThrow({ where: { email: 'staff.a@example.test' } })).id, expected_version: 1 });
    expect(u1.status, JSON.stringify(u1.body)).toBe(200);
    expect(u1.body.assignee_name).toBe('Nhân viên Tòa A');
    expect((await json(staffA, 'patch', `/api/v1/maintenance-requests/${m.id}`, { status: 'DONE', expected_version: 1 })).status).toBe(409);
    const exp = await owner.agent.post('/api/v1/expenses').set(CSRF_HEADER, owner.csrf).set('Idempotency-Key', `p13e-${Date.now()}`).send({ room_id: a.roomId, category: 'REPAIR', amount_vnd: '150000', spent_on: '2026-10-01', method: 'CASH' });
    expect(exp.status).toBe(201);
    const done = await json(owner, 'patch', `/api/v1/maintenance-requests/${m.id}`, { status: 'DONE', resolution_note: 'Thay ron vòi', expense_id: exp.body.id, expected_version: 2 });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'DONE', resolution_note: 'Thay ron vòi', expense_number: exp.body.number });
    expect(done.body.resolved_at).not.toBeNull();
    expect((await json(owner, 'patch', `/api/v1/maintenance-requests/${m.id}`, { status: 'CANCELLED', expected_version: 3 })).status).toBe(422);
    const reopened = await json(owner, 'patch', `/api/v1/maintenance-requests/${m.id}`, { status: 'OPEN', expected_version: 3 });
    expect(reopened.body).toMatchObject({ status: 'OPEN', resolved_at: null });

    // Ảnh bảo trì gắn vào yêu cầu
    expect((await upload(staffA, { owner_type: 'maintenance_request', owner_id: m.id, category: 'MAINTENANCE_PHOTO' }, PNG, 'voi.png')).status).toBe(201);
    expect(await t.prisma.auditLog.count({ where: { action: { startsWith: 'maintenance.' } } })).toBe(4);
  });
});
