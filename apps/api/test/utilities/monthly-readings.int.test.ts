import type { InvoiceDetail, ReadingSheet, Room } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

const A = SEED_IDS.buildings.A;
let keySeq = 0;
const key = () => `elec-${Date.now()}-${++keySeq}`;

/**
 * Luồng điện nước theo cách dùng thực tế: thiết lập phòng (chỉ số ban đầu một lần) → nhận phòng → chốt chỉ số tháng tiêu thụ 10
 * → thông báo tháng 11 gồm tiền phòng tháng 11 + điện nước tháng 10.
 */
describe('Điện nước hàng tháng: tháng tiêu thụ, chỉ số nền, tiến độ theo phòng, vào thông báo tháng sau', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const post = (url: string, body: unknown, s: Session = owner, k?: string) => {
    const r = s.agent.post(url).set(CSRF_HEADER, s.csrf);
    if (k) r.set('Idempotency-Key', k);
    return r.send(body as object);
  };
  const sheet = async (month: string, s: Session = owner): Promise<ReadingSheet> => {
    const r = await s.agent.get(`/api/v1/meter-readings/sheet?building_id=${A}&consumption_month=${month}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  async function setPrices() {
    for (const [meter_type, unit_price] of [
      ['ELECTRICITY', '4000'],
      ['WATER', '20000'],
    ]) {
      const r = await post(`/api/v1/buildings/${A}/meter-prices`, { meter_type, effective_from: '2026-10-01', unit_price, reason: 'Giá đầu' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
  }
  async function room(code: string, initial: Record<string, string> | null, s: Session = owner): Promise<Room> {
    const r = await post('/api/v1/rooms', { building_id: A, code, default_rent_vnd: '3000000', max_occupants: 2, ...(initial ? { initial_readings: initial } : {}) }, s);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  }
  async function moveIn(roomId: string, readings: { type: string; value: string }[]) {
    const r = await post(
      '/api/v1/tenancies/move-in',
      { room_id: roomId, start_date: '2026-10-01', monthly_rent_vnd: '3000000', deposit_required_vnd: '0', primary: { new_tenant: { full_name: `Khách ${roomId.slice(-4)}` } }, meter_readings: readings },
      owner,
      key(),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  }

  async function publishDraft(tenancyId: string) {
    const id = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${tenancyId}&lifecycle=DRAFT`)).body.items[0].id as string;
    const d: InvoiceDetail = (await owner.agent.get(`/api/v1/invoices/${id}`)).body;
    expect((await post(`/api/v1/invoices/${id}/publish`, { expected_version: d.version, source_hash: d.source_hash })).status).toBe(200);
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    await at('2026-10-01');
  });
  afterAll(() => t.close());

  it('thiết lập phòng có chỉ số ban đầu → chốt tháng 10 → thông báo tháng 11 = tiền phòng tháng 11 + điện nước tháng 10', async () => {
    await setPrices();
    // Quản lý tòa A thiết lập phòng, nhập chỉ số ban đầu một lần (không cần số seri)
    const manager = await login(t, 'managerA');
    const r1 = await room('E101', { ELECTRICITY: '1000', WATER: '100' }, manager);
    const meters = await t.prisma.meter.findMany({ where: { roomId: r1.id }, orderBy: { type: 'asc' } });
    expect(meters.map((m) => [m.type, m.initialReading.toString(), m.serial])).toEqual([
      ['ELECTRICITY', '1000', null],
      ['WATER', '100', null],
    ]);
    // Nhận phòng: chỉ số lúc nhận (giao diện điền sẵn chỉ số gần nhất)
    const tenancyId = await moveIn(r1.id, [
      { type: 'ELECTRICITY', value: '1000' },
      { type: 'WATER', value: '100' },
    ]);
    const oct = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${tenancyId}&lifecycle=DRAFT`)).body.items[0].id as string;
    const octD: InvoiceDetail = (await owner.agent.get(`/api/v1/invoices/${oct}`)).body;
    expect((await post(`/api/v1/invoices/${oct}/publish`, { expected_version: octD.version, source_hash: octD.source_hash })).status).toBe(200);

    // Cuối tháng 10: bảng chỉ số theo THÁNG TIÊU THỤ 10, thuộc thông báo tháng 11
    await at('2026-10-31');
    let s = await sheet('2026-10');
    expect(s).toMatchObject({ consumption_month: '2026-10', period: '2026-11' });
    const row = s.rows.find((r) => r.room_code === 'E101')!;
    expect(row.status).toBe('TODO');
    expect(row.meters.map((m) => [m.type, m.previous?.value, m.needs_setup])).toEqual([
      ['ELECTRICITY', '1000', false],
      ['WATER', '100', false],
    ]);
    expect(s.totals.rooms).toEqual({ total: 1, done: 0, partial: 0, todo: 1, needs_setup: 0 });

    // Lưu từng phòng (cả hai đồng hồ của phòng trong một lần)
    const save = await post('/api/v1/meter-readings', {
      period: s.period,
      read_on: '2026-10-31',
      items: row.meters.map((m) => ({ meter_id: m.meter_id, value: m.type === 'ELECTRICITY' ? '1120' : '112' })),
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    s = await sheet('2026-10');
    const done = s.rows.find((r) => r.room_code === 'E101')!;
    expect(done.status).toBe('DONE');
    expect(done.meters.map((m) => [m.usage, m.unit_price, m.provisional_vnd])).toEqual([
      ['120', '4000', '480000'],
      ['12', '20000', '240000'],
    ]);
    expect(s.totals).toMatchObject({ provisional_vnd: '720000', rooms: { total: 1, done: 1, partial: 0, todo: 0, needs_setup: 0 } });

    // Đầu tháng 11: lập thông báo tháng 11
    await at('2026-11-01');
    const gen = await post('/api/v1/billing/generate', { period: '2026-11', tenancy_ids: [tenancyId] });
    expect(gen.body.items[0].errors, JSON.stringify(gen.body)).toEqual([]);
    const nov: InvoiceDetail = (await owner.agent.get(`/api/v1/invoices/${gen.body.items[0].invoice_id}`)).body;
    const lines = nov.items.map((i) => [i.charge_kind, i.label, i.amount_vnd]);
    expect(lines.find((l) => l[0] === 'RENT')).toEqual(['RENT', expect.stringContaining('01/11–30/11/2026'), '3000000']);
    const meterLines = lines.filter((l) => l[0] === 'METER');
    expect(meterLines.map((l) => l[2]).sort()).toEqual(['240000', '480000']);
    expect(meterLines.every((l) => String(l[1]).includes('tháng 10/2026'))).toBe(true); // ghi rõ là tiêu thụ tháng 10
    expect(nov.total_vnd).toBe('3720000');
  });

  it('phòng đang thuê chưa có đồng hồ: báo cần thiết lập (không coi là xong), thiết lập ngay từ bảng chỉ số rồi chốt', async () => {
    await setPrices();
    const r2 = await room('E102', null);
    const tenancyId = await moveIn(r2.id, []); // nhận phòng mà không nhập chỉ số
    await publishDraft(tenancyId);
    await at('2026-10-31');
    let s = await sheet('2026-10');
    let row = s.rows.find((r) => r.room_code === 'E102')!;
    expect(row.status).toBe('NEEDS_SETUP');
    expect(row.meters.map((m) => [m.type, m.meter_id, m.needs_setup])).toEqual([
      ['ELECTRICITY', null, true],
      ['WATER', null, true],
    ]);
    expect(row.setup_date).toBe('2026-10-01'); // đầu tháng tiêu thụ (= ngày nhận phòng)
    expect(s.totals.rooms).toMatchObject({ total: 1, done: 0, needs_setup: 1 });
    expect(s.totals.expected).toBe(0); // không có gì để chốt — giao diện không được báo “đã xong”

    // Quản lý thiết lập chỉ số nền ngay (quyền sửa phòng); vai trò cũ Nhân viên không có quyền này
    const staff = await login(t, 'staffA');
    expect((await post(`/api/v1/rooms/${r2.id}/meters`, { type: 'ELECTRICITY', installed_on: row.setup_date, initial_reading: '500' }, staff)).status).toBe(403);
    const manager = await login(t, 'managerA');
    for (const [type, v] of [
      ['ELECTRICITY', '500'],
      ['WATER', '50'],
    ]) {
      const r = await post(`/api/v1/rooms/${r2.id}/meters`, { type, installed_on: row.setup_date, initial_reading: v }, manager);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    s = await sheet('2026-10');
    row = s.rows.find((r) => r.room_code === 'E102')!;
    expect(row.status).toBe('TODO');
    expect(row.meters.map((m) => m.previous?.value)).toEqual(['500', '50']);

    // Chốt một đồng hồ → PARTIAL; đủ → DONE; thông báo tháng 11 tính đúng tiêu thụ từ chỉ số nền
    const elec = row.meters.find((m) => m.type === 'ELECTRICITY')!;
    expect((await post('/api/v1/meter-readings', { period: s.period, read_on: '2026-10-31', items: [{ meter_id: elec.meter_id, value: '550' }] })).status).toBe(200);
    expect((await sheet('2026-10')).rows.find((r) => r.room_code === 'E102')!.status).toBe('PARTIAL');
    const water = row.meters.find((m) => m.type === 'WATER')!;
    expect((await post('/api/v1/meter-readings', { period: s.period, read_on: '2026-10-31', items: [{ meter_id: water.meter_id, value: '55' }] })).status).toBe(200);
    expect((await sheet('2026-10')).totals.rooms).toMatchObject({ done: 1, needs_setup: 0 });

    await at('2026-11-01');
    const gen = await post('/api/v1/billing/generate', { period: '2026-11', tenancy_ids: [tenancyId] });
    expect(gen.body.items[0].errors, JSON.stringify(gen.body)).toEqual([]);
    const nov: InvoiceDetail = (await owner.agent.get(`/api/v1/invoices/${gen.body.items[0].invoice_id}`)).body;
    expect(nov.items.filter((i) => i.charge_kind === 'METER').map((i) => i.amount_vnd).sort()).toEqual(['100000', '200000']); // 50 kWh × 4.000, 5 m³ × 20.000
  });

  it('vẫn nhận tham số tháng phát hành cũ (period) để tương thích', async () => {
    const r = await owner.agent.get(`/api/v1/meter-readings/sheet?building_id=${A}&period=2026-11`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ period: '2026-11', consumption_month: '2026-10' });
    expect((await owner.agent.get(`/api/v1/meter-readings/sheet?building_id=${A}`)).status).toBe(400);
  });
});
