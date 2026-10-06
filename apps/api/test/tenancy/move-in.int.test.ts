import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createReservation, createRoom, createTenancyRow, serviceId } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const newKey = () => `movein-${Date.now()}-${++keySeq}`;

describe('Phase 2 — nhận phòng (T01, T02, T03, T32, T43, T55)', () => {
  let t: TestApp;
  let owner: Session;
  let roomId: string;

  const moveIn = (body: Record<string, unknown>, key: string | null = newKey(), s: Session = owner) => {
    const req = s.agent.post('/api/v1/tenancies/move-in').set(CSRF_HEADER, s.csrf);
    if (key) req.set('Idempotency-Key', key);
    return req.send({ room_id: roomId, start_date: '2026-10-06', monthly_rent_vnd: '3000000', primary: { new_tenant: { full_name: 'Trần Văn An' } }, ...body });
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    owner = await login(t, 'owner');
    roomId = (await createRoom(t, { maxOccupants: 3 })).id;
  });
  afterAll(() => t.close());

  it('T01: tạo đủ tenancy, thành viên, giá, dịch vụ, chỉ số ban đầu, cọc; phòng OCCUPIED', async () => {
    const internet = await serviceId(t, 'INTERNET');
    const parking = await serviceId(t, 'PARKING');
    const res = await moveIn({
      members: [{ new_tenant: { full_name: 'Lê Thị Bình', phone: '0912345678' } }],
      billing_due_day: 5,
      deposit_required_vnd: '3000000',
      deposit_received: { amount_vnd: '3000000', method: 'CASH', paid_at: '2026-10-06' },
      services: [
        { service_id: internet, quantity: '1' },
        { service_id: parking, quantity: '2' },
      ],
      meter_readings: [
        { type: 'ELECTRICITY', value: '1250.5' },
        { type: 'WATER', value: '312' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^LT2610-\d{4}$/);

    const detail = await owner.agent.get(`/api/v1/tenancies/${res.body.id}`);
    expect(detail.body).toMatchObject({
      status: 'ACTIVE',
      start_date: '2026-10-06',
      primary_tenant_name: 'Trần Văn An',
      member_count: 2,
      current_rent_vnd: '3000000',
      deposit_held_vnd: '3000000',
      rental_mode: 'MONTH_TO_MONTH',
      deposit: { required_vnd: '3000000', held_vnd: '3000000', shortfall_vnd: '0' },
    });
    expect(detail.body.members.filter((m: { role: string }) => m.role === 'PRIMARY')).toHaveLength(1);
    expect(detail.body.services.map((s: { quantity: string }) => s.quantity).sort()).toEqual(['1', '2']);
    expect(detail.body.initial_readings).toEqual(
      expect.arrayContaining([
        { type: 'ELECTRICITY', value: '1250.5', read_on: '2026-10-06' },
        { type: 'WATER', value: '312', read_on: '2026-10-06' },
      ]),
    );
    expect(await t.prisma.meter.count({ where: { roomId } })).toBe(2);

    const room = await owner.agent.get(`/api/v1/rooms/${roomId}`);
    expect(room.body).toMatchObject({ display_status: 'OCCUPIED', current_tenancy: { primary_tenant_name: 'Trần Văn An' } });
    expect(await t.prisma.auditLog.count({ where: { action: 'tenancy.move_in' } })).toBe(1);
  });

  it('thiếu Idempotency-Key bị từ chối; gọi lại cùng key trả kết quả cũ, không tạo lần thuê thứ hai', async () => {
    expect((await moveIn({}, null)).status).toBe(400);
    const key = newKey();
    const a = await moveIn({}, key);
    const b = await moveIn({}, key);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await t.prisma.tenancy.count()).toBe(1);
    const c = await moveIn({ monthly_rent_vnd: '1' }, key);
    expect(c.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('T02: ba request nhận phòng đồng thời (khác key) → chỉ một thành công', async () => {
    const results = await Promise.all([moveIn({}), moveIn({}), moveIn({})]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await t.prisma.tenancy.count({ where: { roomId } })).toBe(1);
    expect(await t.prisma.tenant.count()).toBe(1);
  });

  it('T03: phòng có tenancy NOTICE_GIVEN hoặc MOVE_OUT_PROCESSING thì không nhận khách mới', async () => {
    await createTenancyRow(t, roomId, { status: 'NOTICE_GIVEN' });
    expect((await moveIn({})).status).toBe(409);
    const room2 = await createRoom(t);
    await createTenancyRow(t, room2.id, { status: 'MOVE_OUT_PROCESSING' });
    expect((await moveIn({ room_id: room2.id })).status).toBe(409);
  });

  it('phòng MAINTENANCE và vượt sức chứa bị chặn', async () => {
    const m = await createRoom(t, { maintenance: true });
    expect((await moveIn({ room_id: m.id })).body.message).toContain('bảo trì');
    const res = await moveIn({ members: [{ new_tenant: { full_name: 'B' } }, { new_tenant: { full_name: 'C' } }, { new_tenant: { full_name: 'D' } }] });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('tối đa 3');
  });

  it('khách mới nhận sớm nhất ngày sau ngày cuối tính tiền của khách trước', async () => {
    await createTenancyRow(t, roomId, { status: 'ENDED', start: '2026-08-01', chargeEndExclusive: '2026-10-07' });
    const tooEarly = await moveIn({ start_date: '2026-10-06' });
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.message).toContain('2026-10-07');
    expect((await moveIn({ start_date: '2026-10-07' })).status).toBe(201);
  });

  it('T32: lỗi giữa transaction (dịch vụ không hợp lệ) → rollback hết, không còn bản ghi dở', async () => {
    const res = await moveIn({
      members: [{ new_tenant: { full_name: 'Người phụ' } }],
      deposit_received: { amount_vnd: '1000000', method: 'CASH', paid_at: '2026-10-06' },
      meter_readings: [{ type: 'ELECTRICITY', value: '10' }],
      services: [{ service_id: await serviceId(t, 'ELEC'), quantity: '1' }],
    });
    expect(res.status).toBe(422);
    for (const count of [
      t.prisma.tenancy.count(),
      t.prisma.tenant.count(),
      t.prisma.tenancyTenant.count(),
      t.prisma.depositTransaction.count(),
      t.prisma.meter.count(),
      t.prisma.meterReading.count(),
      t.prisma.rentPriceHistory.count(),
      t.prisma.idempotencyRequest.count(),
    ]) {
      expect(await count).toBe(0);
    }
  });

  it('chỉ số ban đầu không được nhỏ hơn lần đọc trước của đồng hồ đang dùng', async () => {
    await createTenancyRow(t, roomId, { status: 'ENDED', start: '2026-08-01', chargeEndExclusive: '2026-09-30' });
    const meter = await t.prisma.meter.create({
      data: { workspaceId: (await t.prisma.room.findUniqueOrThrow({ where: { id: roomId } })).workspaceId, roomId, type: 'ELECTRICITY', installedOn: new Date('2026-08-01'), initialReading: '500', createdBy: (await t.prisma.user.findFirstOrThrow()).id },
    });
    const low = await moveIn({ meter_readings: [{ type: 'ELECTRICITY', value: '499' }] });
    expect(low.status).toBe(422);
    const ok = await moveIn({ meter_readings: [{ type: 'ELECTRICITY', value: '520' }] });
    expect(ok.status).toBe(201);
    expect(await t.prisma.meter.count({ where: { roomId } })).toBe(1);
    expect(await t.prisma.meterReading.count({ where: { meterId: meter.id } })).toBe(1);
  });

  it('T55: ngày nhận nằm trong lịch giữ của khách khác bị chặn', async () => {
    await createReservation(t, roomId, { holdFrom: '2026-10-05', holdUntil: '2026-10-10' });
    const res = await moveIn({});
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('lịch giữ phòng');
  });

  it('T43: tiền giữ chỗ chuyển thành cọc bằng cặp giao dịch, không tạo tiền thu mới; giữ phòng thành CONVERTED', async () => {
    const r = await createReservation(t, roomId, { holdFrom: '2026-10-01', expectedMoveIn: '2026-10-06', holdUntil: '2026-10-08' });
    const hold = await owner.agent
      .post(`/api/v1/reservations/${r.id}/holding-transactions`)
      .set(CSRF_HEADER, owner.csrf)
      .set('Idempotency-Key', newKey())
      .send({ type: 'RECEIVED', amount_vnd: '1000000', method: 'BANK_TRANSFER', paid_at: '2026-10-01' });
    expect(hold.status).toBe(201);

    const res = await moveIn({ reservation_id: r.id, deposit_required_vnd: '3000000', deposit_received: { amount_vnd: '2000000', method: 'CASH', paid_at: '2026-10-06' } });
    expect(res.status).toBe(201);

    const ledger = await owner.agent.get(`/api/v1/tenancies/${res.body.id}/deposit-transactions`);
    expect(ledger.body.summary).toMatchObject({ held_vnd: '3000000', shortfall_vnd: '0' });
    const types = ledger.body.transactions.map((x: { type: string }) => x.type).sort();
    expect(types).toEqual(['CONVERTED_FROM_HOLDING', 'RECEIVED']);
    expect(ledger.body.transactions.find((x: { type: string }) => x.type === 'RECEIVED').amount_vnd).toBe('2000000');

    const holding = await owner.agent.get(`/api/v1/reservations/${r.id}/holding-transactions`);
    expect(holding.body.balance_vnd).toBe('0');
    const conv = holding.body.transactions.find((x: { type: string }) => x.type === 'CONVERTED_TO_DEPOSIT');
    expect(conv.linked_transaction_id).toBe(ledger.body.transactions.find((x: { type: string }) => x.type === 'CONVERTED_FROM_HOLDING').id);
    expect((await t.prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('CONVERTED');
  });
});
