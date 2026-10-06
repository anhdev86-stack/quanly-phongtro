import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createReservation, createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

describe('Phase 1 — giữ phòng (T55 phần chồng lịch và đồng thời)', () => {
  let t: TestApp;
  let owner: Session;
  let roomId: string;

  const create = (s: Session, body: Record<string, unknown>) =>
    s.agent.post('/api/v1/reservations').set(CSRF_HEADER, s.csrf).send({ room_id: roomId, contact_name: 'Anh Bình', ...body });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    owner = await login(t, 'owner');
    roomId = (await createRoom(t)).id;
  });
  afterAll(() => t.close());

  it('tạo giữ phòng hợp lệ; phòng hiển thị RESERVED trong khoảng chặn lịch', async () => {
    const res = await create(owner, { hold_from: '2026-10-06', expected_move_in: '2026-10-10', hold_until: '2026-10-12', contact_phone: '0912 345 678' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ display_status: 'ACTIVE', contact_phone: '0912345678', holding_balance_vnd: '0' });
    const room = await owner.agent.get(`/api/v1/rooms/${roomId}`);
    expect(room.body.display_status).toBe('RESERVED');
    expect(room.body.current_reservation.id).toBe(res.body.id);
  });

  it('ba mốc ngày sai thứ tự bị từ chối ở API (400) và database (CHECK)', async () => {
    const res = await create(owner, { hold_from: '2026-10-10', expected_move_in: '2026-10-08', hold_until: '2026-10-12' });
    expect(res.status).toBe(400);
    expect(res.body.field_errors.expected_move_in).toBeDefined();
  });

  it('chồng lịch với lượt giữ ACTIVE bị database chặn → 409; sát biên thì được', async () => {
    await createReservation(t, roomId, { holdFrom: '2026-10-10', holdUntil: '2026-10-15' });
    const overlap = await create(owner, { hold_from: '2026-10-15', expected_move_in: '2026-10-15', hold_until: '2026-10-20' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.message).toContain('Trùng lịch');
    const adjacent = await create(owner, { hold_from: '2026-10-16', expected_move_in: '2026-10-16', hold_until: '2026-10-20' });
    expect(adjacent.status).toBe(201);
  });

  it('lượt giữ đã hủy không chặn lịch', async () => {
    await createReservation(t, roomId, { holdFrom: '2026-10-10', holdUntil: '2026-10-15' }, 'CANCELLED');
    expect((await create(owner, { hold_from: '2026-10-10', expected_move_in: '2026-10-10', hold_until: '2026-10-15' })).status).toBe(201);
  });

  it('hai request đồng thời cùng khoảng: chỉ một thành công', async () => {
    const body = { hold_from: '2026-10-20', expected_move_in: '2026-10-21', hold_until: '2026-10-25' };
    const results = await Promise.all([create(owner, body), create(owner, body), create(owner, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await t.prisma.reservation.count({ where: { roomId, status: 'ACTIVE' } })).toBe(1);
  });

  it('đổi lịch: chồng với lượt khác bị chặn; version cũ bị từ chối', async () => {
    await createReservation(t, roomId, { holdFrom: '2026-10-20', holdUntil: '2026-10-25' });
    const mine = await create(owner, { hold_from: '2026-10-10', expected_move_in: '2026-10-10', hold_until: '2026-10-12' });
    const url = `/api/v1/reservations/${mine.body.id}/reschedule`;
    const clash = await owner.agent.post(url).set(CSRF_HEADER, owner.csrf).send({ hold_from: '2026-10-18', expected_move_in: '2026-10-21', hold_until: '2026-10-22', expected_version: 1 });
    expect(clash.status).toBe(409);
    const ok = await owner.agent.post(url).set(CSRF_HEADER, owner.csrf).send({ hold_from: '2026-10-10', expected_move_in: '2026-10-11', hold_until: '2026-10-14', expected_version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ hold_until: '2026-10-14', version: 2 });
    const stale = await owner.agent.post(url).set(CSRF_HEADER, owner.csrf).send({ hold_from: '2026-10-10', expected_move_in: '2026-10-11', hold_until: '2026-10-13', expected_version: 1 });
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('hủy cần lý do; sau khi hủy không đổi lịch được; có audit', async () => {
    const r = await create(owner, { hold_from: '2026-10-07', expected_move_in: '2026-10-07', hold_until: '2026-10-09' });
    const noReason = await owner.agent.post(`/api/v1/reservations/${r.body.id}/cancel`).set(CSRF_HEADER, owner.csrf).send({ reason: '', expected_version: 1 });
    expect(noReason.status).toBe(400);
    const ok = await owner.agent.post(`/api/v1/reservations/${r.body.id}/cancel`).set(CSRF_HEADER, owner.csrf).send({ reason: 'Khách đổi ý', expected_version: 1 });
    expect(ok.body).toMatchObject({ status: 'CANCELLED', display_status: 'CANCELLED', cancelled_reason: 'Khách đổi ý' });
    const again = await owner.agent.post(`/api/v1/reservations/${r.body.id}/reschedule`).set(CSRF_HEADER, owner.csrf).send({ hold_from: '2026-10-07', expected_move_in: '2026-10-07', hold_until: '2026-10-09', expected_version: 2 });
    expect(again.status).toBe(422);
    expect(await t.prisma.auditLog.count({ where: { entityId: r.body.id, action: 'reservation.cancel' } })).toBe(1);
  });

  it('quá hold_until hiển thị EXPIRED; hạn giữ chỗ đã qua thì không tạo được', async () => {
    await createReservation(t, roomId, { holdFrom: '2026-10-01', holdUntil: '2026-10-03' });
    const list = await owner.agent.get(`/api/v1/reservations?room_id=${roomId}&status=EXPIRED`);
    expect(list.body.total).toBe(1);
    const past = await create(owner, { hold_from: '2026-10-01', expected_move_in: '2026-10-02', hold_until: '2026-10-05' });
    expect(past.status).toBe(422);
  });

  it('STAFF tạo giữ phòng trong tòa được giao; tòa khác trả 404', async () => {
    const staff = await login(t, 'staffBC');
    const res = await create(staff, { hold_from: '2026-10-07', expected_move_in: '2026-10-07', hold_until: '2026-10-08' });
    expect(res.status).toBe(404);
    const roomB = await createRoom(t, { building: 'B' });
    const ok = await staff.agent
      .post('/api/v1/reservations')
      .set(CSRF_HEADER, staff.csrf)
      .send({ room_id: roomB.id, contact_name: 'Chị Lan', hold_from: '2026-10-07', expected_move_in: '2026-10-07', hold_until: '2026-10-08' });
    expect(ok.status).toBe(201);
  });
});
