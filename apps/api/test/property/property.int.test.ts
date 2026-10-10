import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { createReservation, createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

describe('Phase 1 — tòa và phòng', () => {
  let t: TestApp;
  let owner: Session;

  const post = (s: Session, url: string, body: unknown) => s.agent.post(url).set(CSRF_HEADER, s.csrf).send(body as object);
  const patch = (s: Session, url: string, body: unknown) => s.agent.patch(url).set(CSRF_HEADER, s.csrf).send(body as object);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    owner = await login(t, 'owner');
  });
  afterAll(() => t.close());

  describe('tòa', () => {
    it('OWNER tạo, sửa (expected_version), mã tòa unique trong workspace', async () => {
      const created = await post(owner, '/api/v1/buildings', { code: 'd', name: 'Tòa D', contact_phone: '+84912345678' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'D', contact_phone: '0912345678', room_count: 0, version: 1 });

      const dup = await post(owner, '/api/v1/buildings', { code: 'D', name: 'Trùng' });
      expect(dup.status).toBe(409);
      expect(dup.body.field_errors.code).toBeDefined();

      const updated = await patch(owner, `/api/v1/buildings/${created.body.id}`, { name: 'Tòa D mới', expected_version: 1 });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ name: 'Tòa D mới', version: 2 });

      const stale = await patch(owner, `/api/v1/buildings/${created.body.id}`, { name: 'Ghi đè', expected_version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('VERSION_CONFLICT');
      expect(await t.prisma.auditLog.count({ where: { entityId: created.body.id } })).toBe(2);
    });

    it('STAFF chỉ thấy tòa được giao và không tạo được tòa', async () => {
      const staff = await login(t, 'staffBC');
      const list = await staff.agent.get('/api/v1/buildings');
      expect(list.body.map((b: { code: string }) => b.code)).toEqual(['B', 'C']);
      expect((await staff.agent.get(`/api/v1/buildings/${SEED_IDS.buildings.A}`)).status).toBe(404);
      expect((await post(staff, '/api/v1/buildings', { code: 'X', name: 'X' })).status).toBe(403);
    });

    it('tòa hiển thị người được giao phụ trách (đang hoạt động), ở danh sách và chi tiết', async () => {
      const names = (b: { managers: { display_name: string }[] }) => b.managers.map((m) => m.display_name);
      const list = (await owner.agent.get('/api/v1/buildings')).body as { code: string; managers: { display_name: string }[] }[];
      expect(names(list.find((b) => b.code === 'A')!)).toEqual(['Nhân viên Tòa A', 'Quản lý Tòa A']);
      expect(names(list.find((b) => b.code === 'C')!)).toEqual(['Nhân viên Tòa B, C', 'Quản lý Tòa B, C']);
      // Tài khoản bị khóa không còn hiện là người phụ trách
      await t.prisma.user.update({ where: { email: 'staff.a@example.test' }, data: { isActive: false } });
      expect(names((await owner.agent.get(`/api/v1/buildings/${SEED_IDS.buildings.A}`)).body)).toEqual(['Quản lý Tòa A']);
      const fresh = (await post(owner, '/api/v1/buildings', { code: 'M1', name: 'Chưa giao' })).body;
      expect(fresh.managers).toEqual([]);
    });

    it('lưu trữ tòa bị chặn khi còn phòng chưa lưu trữ', async () => {
      await createRoom(t, { building: 'C' });
      const res = await post(owner, `/api/v1/buildings/${SEED_IDS.buildings.C}/archive`, { expected_version: 1 });
      expect(res.status).toBe(422);
    });
  });

  describe('phòng', () => {
    it('tạo phòng: mã unique trong tòa, giá dạng chuỗi, phòng mới hiển thị AVAILABLE', async () => {
      const res = await post(owner, '/api/v1/rooms', {
        building_id: SEED_IDS.buildings.A,
        code: '101',
        default_rent_vnd: '3500000',
        max_occupants: 2,
        floor: 1,
        area_m2: '18.5',
        amenities: ['Máy lạnh'],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ code: '101', default_rent_vnd: '3500000', area_m2: '18.5', display_status: 'AVAILABLE' });

      const dup = await post(owner, '/api/v1/rooms', { building_id: SEED_IDS.buildings.A, code: '101', default_rent_vnd: '1', max_occupants: 1 });
      expect(dup.status).toBe(409);
      // Cùng mã ở tòa khác thì được
      const other = await post(owner, '/api/v1/rooms', { building_id: SEED_IDS.buildings.B, code: '101', default_rent_vnd: '1', max_occupants: 1 });
      expect(other.status).toBe(201);
    });

    it('tiền âm, số thực hoặc dạng number bị từ chối', async () => {
      for (const default_rent_vnd of ['-1', '1.5', 3000000]) {
        const res = await post(owner, '/api/v1/rooms', { building_id: SEED_IDS.buildings.A, code: 'Z1', default_rent_vnd, max_occupants: 1 });
        expect(res.status).toBe(400);
      }
    });

    it('MAINTENANCE → trạng thái MAINTENANCE; READY lại thì AVAILABLE', async () => {
      const room = await createRoom(t);
      const m = await post(owner, `/api/v1/rooms/${room.id}/set-operational-status`, { status: 'MAINTENANCE', note: 'Sửa ống nước', expected_version: 1 });
      expect(m.body).toMatchObject({ display_status: 'MAINTENANCE', maintenance_note: 'Sửa ống nước' });
      const r = await post(owner, `/api/v1/rooms/${room.id}/set-operational-status`, { status: 'READY', expected_version: 2 });
      expect(r.body).toMatchObject({ display_status: 'AVAILABLE', maintenance_note: null });
    });

    it('danh sách lọc theo trạng thái, tầng, tìm mã; RESERVED theo khoảng chặn lịch', async () => {
      const a = await createRoom(t, { code: '201' });
      await createRoom(t, { code: '202', maintenance: true });
      await createRoom(t, { code: '203' });
      await createReservation(t, a.id, { holdFrom: '2026-10-05', holdUntil: '2026-10-08' });

      const reserved = await owner.agent.get('/api/v1/rooms?status=RESERVED');
      expect(reserved.body.items.map((r: { code: string }) => r.code)).toEqual(['201']);
      const maint = await owner.agent.get('/api/v1/rooms?status=MAINTENANCE');
      expect(maint.body.items.map((r: { code: string }) => r.code)).toEqual(['202']);
      const search = await owner.agent.get('/api/v1/rooms?q=203');
      expect(search.body.total).toBe(1);
      const pageSize = await owner.agent.get('/api/v1/rooms?page_size=101');
      expect(pageSize.status).toBe(400);
    });

    it('STAFF không thấy phòng tòa khác (danh sách và theo ID)', async () => {
      const roomB = await createRoom(t, { building: 'B' });
      await createRoom(t, { building: 'A' });
      const staff = await login(t, 'staffA');
      const list = await staff.agent.get('/api/v1/rooms');
      expect(list.body.items.every((r: { building_code: string }) => r.building_code === 'A')).toBe(true);
      expect((await staff.agent.get(`/api/v1/rooms/${roomB.id}`)).status).toBe(404);
      expect((await post(staff, '/api/v1/rooms', { building_id: SEED_IDS.buildings.A, code: 'S1', default_rent_vnd: '1', max_occupants: 1 })).status).toBe(403);
    });

    it('lưu trữ phòng bị chặn khi còn giữ chỗ hiệu lực', async () => {
      const room = await createRoom(t);
      await createReservation(t, room.id, { holdFrom: '2026-10-10', holdUntil: '2026-10-12' });
      expect((await post(owner, `/api/v1/rooms/${room.id}/archive`, { expected_version: 1 })).status).toBe(422);
    });
  });
});
