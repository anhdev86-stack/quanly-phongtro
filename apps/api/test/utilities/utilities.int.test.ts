import type { ReadingSheet, SheetMeter } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { fromDbDate } from '../../src/domain/dates/date-only.js';
import { parseFixed2 } from '../../src/domain/utilities/fixed2.js';
import { meterCharge } from '../../src/domain/utilities/meter-charge.js';
import { quantitySegments, unitDays } from '../../src/domain/utilities/timeline.js';
import { createRoom, serviceId } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const A = SEED_IDS.buildings.A;
const B = SEED_IDS.buildings.B;

describe('Phase 4 — điện nước, đồng hồ, dịch vụ (T12–T14, T60, T61)', () => {
  let t: TestApp;
  let owner: Session;

  const post = (url: string, body: unknown, s: Session = owner) => s.agent.post(url).set(CSRF_HEADER, s.csrf).send(body as object);
  const at = (date: string) => t.clock.set(`${date}T03:00:00.000Z`);
  const sheet = async (building: string, period: string, s: Session = owner): Promise<ReadingSheet> => {
    const res = await s.agent.get(`/api/v1/meter-readings/sheet?building_id=${building}&period=${period}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const meterOf = (sh: ReadingSheet, roomId: string, type = 'ELECTRICITY'): SheetMeter & { meter_id: string } =>
    sh.rows.find((r) => r.room_id === roomId)!.meters.find((m) => m.type === type)! as SheetMeter & { meter_id: string };
  const setPrice = (building: string, body: Record<string, unknown>) =>
    post(`/api/v1/buildings/${building}/meter-prices`, { meter_type: 'ELECTRICITY', reason: 'Đặt giá điện', ...body });

  async function moveIn(building: 'A' | 'B', extra: Record<string, unknown> = {}) {
    const room = await createRoom(t, { building });
    const res = await owner.agent
      .post('/api/v1/tenancies/move-in')
      .set(CSRF_HEADER, owner.csrf)
      .set('Idempotency-Key', `ut-${Date.now()}-${++keySeq}`)
      .send({
        room_id: room.id,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: '0',
        primary: { new_tenant: { full_name: 'Khách Điện Nước' } },
        meter_readings: [
          { type: 'ELECTRICITY', value: '1000' },
          { type: 'WATER', value: '50' },
        ],
        ...extra,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { roomId: room.id, tenancyId: res.body.id as string };
  }

  async function save(period: string, readOn: string, meterId: string, value: string, extra: Record<string, unknown> = {}, s: Session = owner) {
    return post('/api/v1/meter-readings', { period, read_on: readOn, items: [{ meter_id: meterId, value, ...extra }] }, s);
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    at('2026-10-01');
    owner = await login(t, 'owner');
  });
  afterAll(() => t.close());

  it('T61: chỉ số trước tự lấy; nhập chỉ số mới → tiêu thụ và tiền tạm tính bằng tiền tính bằng hàm chính thức', async () => {
    const { roomId } = await moveIn('A');
    expect((await setPrice(A, { effective_from: '2026-10-01', unit_price: '3500' })).status).toBe(201);
    at('2026-10-31');
    owner = await login(t, 'owner');
    let sh = await sheet(A, '2026-11');
    let m = meterOf(sh, roomId);
    expect(m.previous).toMatchObject({ value: '1000', kind: 'INITIAL', read_on: '2026-10-01' });
    expect(m.current).toBeNull();
    expect(sh.totals).toMatchObject({ entered: 0, expected: 2 });

    const res = await save('2026-11', '2026-10-31', m.meter_id, '1120.5');
    expect(res.status).toBe(200);
    expect(res.body.saved[0]).toMatchObject({ kind: 'PERIODIC', period: '2026-11', value: '1120.5' });
    sh = await sheet(A, '2026-11');
    m = meterOf(sh, roomId);
    const official = meterCharge(parseFixed2('120.5'), parseFixed2('3500'), 1).toString();
    expect(m).toMatchObject({ usage: '120.5', unit_price: '3500', provisional_vnd: official, current: { value: '1120.5' } });
    expect(official).toBe('421750');
    expect(sh.totals).toMatchObject({ provisional_vnd: '421750', entered: 1 });
    // Nước chưa có giá: chưa tạm tính được, không đoán
    expect(meterOf(sh, roomId, 'WATER')).toMatchObject({ unit_price: null, provisional_vnd: null });
  });

  it('T61: sửa chỉ số bắt buộc lý do, có audit và lịch sử sửa; chỉ số sửa không được vượt lần đọc sau', async () => {
    const { roomId } = await moveIn('A');
    await setPrice(A, { effective_from: '2026-10-01', unit_price: '3500' });
    at('2026-10-31');
    owner = await login(t, 'owner');
    const m = meterOf(await sheet(A, '2026-11'), roomId);
    await save('2026-11', '2026-10-31', m.meter_id, '1100');
    const initial = await t.prisma.meterReading.findFirstOrThrow({ where: { meterId: m.meter_id, kind: 'INITIAL' } });

    expect((await post(`/api/v1/meter-readings/${initial.id}/correct`, { value: '990', expected_version: 1 })).status).toBe(400);
    expect((await post(`/api/v1/meter-readings/${initial.id}/correct`, { value: '1100.01', reason: 'Nhập nhầm', expected_version: 1 })).status).toBe(422);
    const ok = await post(`/api/v1/meter-readings/${initial.id}/correct`, { value: '990', reason: 'Đọc nhầm số lúc nhận phòng', expected_version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ value: '990', version: 2 });
    expect(meterOf(await sheet(A, '2026-11'), roomId)).toMatchObject({ usage: '110', provisional_vnd: '385000' });
    const event = await t.prisma.meterEvent.findFirstOrThrow({ where: { readingId: initial.id } });
    expect(event).toMatchObject({ kind: 'CORRECTION', reason: 'Đọc nhầm số lúc nhận phòng' });
    expect(event.oldValue?.toString()).toBe('1000');
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'meter_reading.correct', entityId: initial.id } });
    expect(log.reason).toBe('Đọc nhầm số lúc nhận phòng');
    expect((await post(`/api/v1/meter-readings/${initial.id}/correct`, { value: '980', reason: 'Sai version', expected_version: 1 })).status).toBe(409);
  });

  it('T13: chỉ số bằng lần trước hợp lệ (cảnh báo khi có người ở), nhỏ hơn bị chặn; nhập lại kỳ cần expected_version', async () => {
    const { roomId } = await moveIn('A');
    at('2026-10-31');
    owner = await login(t, 'owner');
    const m = meterOf(await sheet(A, '2026-11'), roomId);
    const lower = await save('2026-11', '2026-10-31', m.meter_id, '999.99');
    expect(lower.status).toBe(422);
    expect(lower.body.field_errors['items.0.value']).toBeDefined();
    expect((await save('2026-11', '2026-10-31', m.meter_id, '1000')).status).toBe(200);
    expect(meterOf(await sheet(A, '2026-11'), roomId)).toMatchObject({ usage: '0', warning: 'ZERO_WHILE_OCCUPIED' });

    expect((await save('2026-11', '2026-10-31', m.meter_id, '1050')).status).toBe(409);
    const cur = meterOf(await sheet(A, '2026-11'), roomId).current!;
    expect((await save('2026-11', '2026-10-31', m.meter_id, '1050', { expected_version: cur.version })).status).toBe(200);
    expect(meterOf(await sheet(A, '2026-11'), roomId)).toMatchObject({ usage: '50', warning: null });
    // Không có chỉ số tương lai
    expect((await save('2026-12', '2026-11-30', m.meter_id, '1100')).status).toBe(422);
  });

  it('T14: thay đồng hồ — chốt đồng hồ cũ, đồng hồ mới bắt đầu từ chỉ số riêng, tiêu thụ cộng cả hai', async () => {
    const { roomId } = await moveIn('A');
    await setPrice(A, { effective_from: '2026-10-01', unit_price: '3500' });
    at('2026-10-31');
    owner = await login(t, 'owner');
    const m1 = meterOf(await sheet(A, '2026-11'), roomId).meter_id;
    await save('2026-11', '2026-10-31', m1, '1120');
    at('2026-11-30');
    owner = await login(t, 'owner');

    expect((await post(`/api/v1/meters/${m1}/replace`, { replaced_on: '2026-11-15', closing_value: '1119', new_initial_reading: '0', reason: 'Đồng hồ hỏng' })).status).toBe(422);
    expect((await post(`/api/v1/meters/${m1}/replace`, { replaced_on: '2026-10-31', closing_value: '1200', new_initial_reading: '0', reason: 'Đồng hồ hỏng' })).status).toBe(422);
    const rep = await post(`/api/v1/meters/${m1}/replace`, { replaced_on: '2026-11-15', closing_value: '1200', new_serial: 'NEW-01', new_initial_reading: '0', reason: 'Đồng hồ hỏng' });
    expect(rep.status).toBe(200);
    const elec = rep.body.meters.filter((x: { type: string }) => x.type === 'ELECTRICITY');
    expect(elec.map((x: { retired_on: string | null; serial: string | null }) => [x.serial, x.retired_on])).toEqual(
      expect.arrayContaining([
        [null, '2026-11-15'],
        ['NEW-01', null],
      ]),
    );
    expect(rep.body.events[0]).toMatchObject({ kind: 'REPLACEMENT', old_value: '1200', new_value: '0' });

    const m = meterOf(await sheet(A, '2026-12'), roomId);
    expect(m.meter_id).not.toBe(m1);
    expect(m).toMatchObject({ previous: { value: '0', kind: 'INSTALL', read_on: '2026-11-15' }, carried_usage: '80' });
    expect((await save('2026-12', '2026-11-30', m1, '1300')).status).toBe(422); // đồng hồ đã ngưng
    expect((await save('2026-12', '2026-11-30', m.meter_id, '25')).status).toBe(200);
    expect(meterOf(await sheet(A, '2026-12'), roomId)).toMatchObject({ usage: '105', provisional_vnd: '367500' });
    // Kỳ trước không đổi
    expect(meterOf(await sheet(A, '2026-11'), roomId)).toMatchObject({ usage: '120', provisional_vnd: '420000' });
  });

  it('T60: hai tòa khác giá; “Thay đổi giá” áp dụng từ kỳ tiếp theo, kỳ đã tính không đổi; lịch sử có người đổi và lý do', async () => {
    const a = await moveIn('A');
    const b = await moveIn('B');
    await setPrice(A, { effective_from: '2026-10-01', unit_price: '3500' });
    await setPrice(B, { effective_from: '2026-10-01', unit_price: '3800' });
    at('2026-10-31');
    owner = await login(t, 'owner');
    await save('2026-11', '2026-10-31', meterOf(await sheet(A, '2026-11'), a.roomId).meter_id, '1100');
    await save('2026-11', '2026-10-31', meterOf(await sheet(B, '2026-11'), b.roomId).meter_id, '1100');
    expect(meterOf(await sheet(A, '2026-11'), a.roomId).provisional_vnd).toBe('350000');
    expect(meterOf(await sheet(B, '2026-11'), b.roomId).provisional_vnd).toBe('380000');

    const prices = (await owner.agent.get(`/api/v1/buildings/${A}/meter-prices`)).body;
    expect(prices.next_period_start).toBe('2026-12-01');
    // Đổi giá cho kỳ đã có chỉ số phải xác nhận
    const backdate = await setPrice(A, { effective_from: '2026-11-01', unit_price: '4000', reason: 'Tăng giá điện' });
    expect(backdate.status).toBe(422);
    expect(backdate.body.field_errors.confirm_existing_readings).toBeDefined();
    expect((await setPrice(A, { effective_from: '2026-12-15', unit_price: '4000' })).status).toBe(400);
    const change = await setPrice(A, { effective_from: prices.next_period_start, unit_price: '4000', reason: 'EVN tăng giá' });
    expect(change.status).toBe(201);
    const elec = change.body.items.find((i: { meter_type: string }) => i.meter_type === 'ELECTRICITY');
    expect(elec.current).toMatchObject({ unit_price: '3500' });
    expect(elec.upcoming).toEqual([expect.objectContaining({ effective_from: '2026-12-01', unit_price: '4000', reason: 'EVN tăng giá', created_by_name: 'Chủ trọ Demo' })]);
    expect((await setPrice(A, { effective_from: '2026-12-01', unit_price: '4100' })).status).toBe(409);

    expect(meterOf(await sheet(A, '2026-11'), a.roomId).provisional_vnd).toBe('350000');
    expect(meterOf(await sheet(B, '2026-11'), b.roomId).provisional_vnd).toBe('380000');
    expect((await sheet(A, '2026-12')).unit_prices).toEqual({ ELECTRICITY: '4000', WATER: null });
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'meter_price.change', reason: 'EVN tăng giá' } });
    expect(audit.before).toMatchObject({ unit_price: '3500' });
  });

  it('phạm vi: nhân viên xem giá và nhập chỉ số tòa được giao; không đổi giá; tòa khác 404', async () => {
    const a = await moveIn('A');
    at('2026-10-31');
    const staff = await login(t, 'staffA');
    expect((await staff.agent.get(`/api/v1/buildings/${A}/meter-prices`)).status).toBe(200);
    expect((await post(`/api/v1/buildings/${A}/meter-prices`, { meter_type: 'WATER', effective_from: '2026-11-01', unit_price: '1', reason: 'Nhân viên đổi' }, staff)).status).toBe(403);
    expect((await staff.agent.get(`/api/v1/buildings/${B}/meter-prices`)).status).toBe(404);
    expect((await staff.agent.get(`/api/v1/meter-readings/sheet?building_id=${B}&period=2026-11`)).status).toBe(404);
    const m = meterOf(await sheet(A, '2026-11', staff), a.roomId);
    expect((await save('2026-11', '2026-10-31', m.meter_id, '1010', {}, staff)).status).toBe(200);
    expect((await post(`/api/v1/meters/${m.meter_id}/replace`, { replaced_on: '2026-10-31', closing_value: '1', new_initial_reading: '0', reason: 'x x x' }, staff)).status).toBe(403);
  });

  it('T12 (dữ liệu): đổi số xe giữa tháng cần xác nhận, lịch sử phiên bản cho đúng xe-ngày; ngưng; không thêm trùng', async () => {
    const { tenancyId } = await moveIn('A');
    const parking = await serviceId(t, 'PARKING');
    const url = `/api/v1/tenancies/${tenancyId}/services`;
    expect((await post(url, { action: 'ADD', service_id: parking, effective_from: '2026-10-01', quantity: '1' })).status).toBe(201);
    expect((await post(url, { action: 'ADD', service_id: parking, effective_from: '2026-11-01', quantity: '1' })).status).toBe(409);
    const mid = await post(url, { action: 'CHANGE_QUANTITY', service_id: parking, effective_from: '2026-11-16', quantity: '2', reason: 'Thêm một xe' });
    expect(mid.status).toBe(422);
    expect(mid.body.field_errors.confirm_mid_month).toBeDefined();
    const ok = await post(url, { action: 'CHANGE_QUANTITY', service_id: parking, effective_from: '2026-11-16', quantity: '2', reason: 'Thêm một xe', confirm_mid_month: true });
    expect(ok.status).toBe(201);
    expect((await post(url, { action: 'STOP', service_id: parking, effective_from: '2027-01-01', reason: 'Bán xe' })).status).toBe(201);

    const rows = await t.prisma.tenancyService.findMany({ where: { tenancyId, serviceId: parking } });
    const versions = rows.map((r) => ({
      effectiveFrom: fromDbDate(r.effectiveFrom),
      endExclusive: r.endExclusive ? fromDbDate(r.endExclusive) : null,
      quantity: Number(r.quantity),
      status: r.status,
    }));
    expect(unitDays(quantitySegments(versions, '2026-11-01', '2026-12-01'))).toBe(15 * 1 + 15 * 2);
    expect(unitDays(quantitySegments(versions, '2027-01-01', '2027-02-01'))).toBe(0);
    const audit = await t.prisma.auditLog.count({ where: { entityId: tenancyId, action: { startsWith: 'tenancy_service.' } } });
    expect(audit).toBe(3);
  });

  it('nước theo người cùng đồng hồ nước: chặn khi nhận phòng, bật sau phải xác nhận tính cả hai khoản', async () => {
    const waterPp = await serviceId(t, 'WATER_PP');
    const room = await createRoom(t);
    const blocked = await owner.agent
      .post('/api/v1/tenancies/move-in')
      .set(CSRF_HEADER, owner.csrf)
      .set('Idempotency-Key', `ut-dual-${++keySeq}-xxxxxx`)
      .send({
        room_id: room.id,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: '0',
        primary: { new_tenant: { full_name: 'Khách nước' } },
        services: [{ service_id: waterPp, quantity: '1' }],
        meter_readings: [{ type: 'WATER', value: '5' }],
      });
    expect(blocked.status).toBe(422);

    const { tenancyId } = await moveIn('A');
    const url = `/api/v1/tenancies/${tenancyId}/services`;
    const need = await post(url, { action: 'ADD', service_id: waterPp, effective_from: '2026-11-01' });
    expect(need.status).toBe(422);
    expect(need.body.field_errors.confirm_dual_utility).toBeDefined();
    expect((await post(url, { action: 'ADD', service_id: waterPp, effective_from: '2026-11-01', confirm_dual_utility: true })).status).toBe(201);
    const row = await t.prisma.tenancyService.findFirstOrThrow({ where: { tenancyId, serviceId: waterPp } });
    expect(row.billingPolicySnapshot).toEqual({ dual_utility_confirmed: true });
  });

  it('gắn đồng hồ cho phòng chưa có: chỉ số ban đầu dùng làm chỉ số trước; không gắn trùng loại', async () => {
    const room = await createRoom(t);
    const res = await post(`/api/v1/rooms/${room.id}/meters`, { type: 'ELECTRICITY', installed_on: '2026-09-20', initial_reading: '300' });
    expect(res.status).toBe(201);
    expect((await post(`/api/v1/rooms/${room.id}/meters`, { type: 'ELECTRICITY', installed_on: '2026-09-21', initial_reading: '0' })).status).toBe(409);
    const meterId = res.body.meters[0].id;
    expect((await post(`/api/v1/meters/${meterId}/correct-initial`, { initial_reading: '310', reason: 'Đọc lại số trên đồng hồ' })).status).toBe(200);
    const res2 = await owner.agent
      .post('/api/v1/tenancies/move-in')
      .set(CSRF_HEADER, owner.csrf)
      .set('Idempotency-Key', `ut-attach-${++keySeq}-xxxxx`)
      .send({ room_id: room.id, start_date: '2026-10-01', monthly_rent_vnd: '1', deposit_required_vnd: '0', primary: { new_tenant: { full_name: 'Khách' } } });
    expect(res2.status).toBe(201);
    const m = meterOf(await sheet(A, '2026-11'), room.id);
    expect(m.previous).toMatchObject({ value: '310', read_on: '2026-09-20' });
  });

  it('cấu hình tính phí có phiên bản; làm tròn tạm tính theo cấu hình của kỳ', async () => {
    expect((await owner.agent.get('/api/v1/settings/billing')).body).toMatchObject({ current: { rounding_unit: 1, proration: 'ACTUAL_DAYS' }, effective_from: null });
    const res = await post('/api/v1/settings/billing', { effective_from: '2026-11-01', proration: 'ACTUAL_DAYS', rounding_unit: 1000, due_day: 5, default_charge_timing: 'ADVANCE' });
    expect(res.status).toBe(201);
    expect((await post('/api/v1/settings/billing', { effective_from: '2026-11-01', proration: 'FIXED_30', rounding_unit: 1, due_day: 5, default_charge_timing: 'ADVANCE' })).status).toBe(409);
    const staff = await login(t, 'staffA');
    expect((await post('/api/v1/settings/billing', { effective_from: '2026-12-01', proration: 'FIXED_30', rounding_unit: 1, due_day: 5, default_charge_timing: 'ADVANCE' }, staff)).status).toBe(403);

    const { roomId } = await moveIn('A');
    await setPrice(A, { effective_from: '2026-10-01', unit_price: '3500' });
    at('2026-10-31');
    owner = await login(t, 'owner');
    await save('2026-11', '2026-10-31', meterOf(await sheet(A, '2026-11'), roomId).meter_id, '1123');
    const sh = await sheet(A, '2026-11');
    expect(sh.rounding_unit).toBe(1000);
    expect(meterOf(sh, roomId).provisional_vnd).toBe('431000'); // 430.500 → 431.000
  });

  it('danh mục dịch vụ: thêm, đổi giá chung/giá riêng tòa, không sửa loại điện nước', async () => {
    const created = await post('/api/v1/services', { code: 'laundry', name: 'Giặt sấy', type: 'QUANTITY', unit: 'lần' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'LAUNDRY', charge_timing: 'ADVANCE', current_price: null });
    expect((await post('/api/v1/services', { code: 'LAUNDRY', name: 'x', type: 'QUANTITY', unit: 'x' })).status).toBe(409);
    const id = created.body.id;
    expect((await post(`/api/v1/services/${id}/prices`, { effective_from: '2026-10-15', unit_price: '20000', reason: 'Giá mới' })).status).toBe(422);
    expect((await post(`/api/v1/services/${id}/prices`, { effective_from: '2026-10-01', unit_price: '20000', reason: 'Giá mới' })).status).toBe(201);
    const detail = await post(`/api/v1/services/${id}/prices`, { building_id: B, effective_from: '2026-10-01', unit_price: '25000', reason: 'Tòa B đắt hơn' });
    expect(detail.body.current_price).toBe('20000');
    expect(detail.body.prices.map((p: { building_code: string | null; unit_price: string }) => [p.building_code, p.unit_price])).toEqual(
      expect.arrayContaining([
        [null, '20000'],
        ['B', '25000'],
      ]),
    );
    const elec = await serviceId(t, 'ELEC');
    const v = (await owner.agent.get(`/api/v1/services/${elec}`)).body.version;
    expect((await owner.agent.patch(`/api/v1/services/${elec}`).set(CSRF_HEADER, owner.csrf).send({ charge_timing: 'ADVANCE', expected_version: v })).status).toBe(422);
    expect((await post(`/api/v1/services/${elec}/prices`, { effective_from: '2026-10-01', unit_price: '1', reason: 'Không được' })).status).toBe(422);
  });
});
