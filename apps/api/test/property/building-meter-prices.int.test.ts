import type { Building, InvoiceDetail, MeterPrices } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

const A = SEED_IDS.buildings.A;
let keySeq = 0;
const key = () => `bmp-${Date.now()}-${++keySeq}`;

/** D-043: giá điện nước nhập ngay khi tạo tòa (không bắt buộc) và đổi trong “Sửa tòa” — vẫn là phiên bản giá, có kỳ áp dụng và lý do. */
describe('Giá điện nước trong form tạo/sửa tòa', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const send = (method: 'post' | 'patch', url: string, body: unknown, k?: string) => {
    const r = owner.agent[method](url).set(CSRF_HEADER, owner.csrf);
    if (k) r.set('Idempotency-Key', k);
    return r.send(body as object);
  };
  const prices = async (id: string): Promise<MeterPrices> => (await owner.agent.get(`/api/v1/buildings/${id}/meter-prices`)).body;
  const current = (p: MeterPrices) => Object.fromEntries(p.items.map((i) => [i.meter_type, i.current ? [i.current.unit_price, i.current.effective_from] : null]));
  const version = async (id: string) => ((await owner.agent.get(`/api/v1/buildings/${id}`)).body as Building).version;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    await at('2026-10-07');
  });
  afterAll(() => t.close());

  it('tạo tòa kèm giá (không bắt buộc) → áp dụng từ kỳ hiện tại; sửa lại ngay cùng kỳ → ghi đè, không báo trùng', async () => {
    // Không nhập giá: vẫn tạo được, tòa chưa có giá
    const plain = await send('post', '/api/v1/buildings', { code: 'K0', name: 'Không giá' });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect(current(await prices(plain.body.id))).toEqual({ ELECTRICITY: null, WATER: null });

    // Nhập giá điện, bỏ trống nước
    const r = await send('post', '/api/v1/buildings', { code: 'K1', name: 'Có giá', meter_prices: { ELECTRICITY: '3500', WATER: null } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id as string;
    expect(current(await prices(id))).toEqual({ ELECTRICITY: ['3500', '2026-10-01'], WATER: null });

    // Sửa tòa: đổi tên + sửa giá điện nhập nhầm (cùng kỳ 10/2026, chưa dùng tính tiền) + thêm giá nước
    const u = await send('patch', `/api/v1/buildings/${id}`, {
      name: 'Có giá (sửa)',
      expected_version: await version(id),
      meter_prices: { ELECTRICITY: '3600', WATER: '15000', effective_from: '2026-10-01', reason: 'Nhập nhầm giá điện' },
    });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(u.body.name).toBe('Có giá (sửa)');
    const p = await prices(id);
    expect(current(p)).toEqual({ ELECTRICITY: ['3600', '2026-10-01'], WATER: ['15000', '2026-10-01'] });
    expect(p.items.find((i) => i.meter_type === 'ELECTRICITY')!.history).toHaveLength(1); // ghi đè, không thêm phiên bản trùng ngày
    const logs = await t.prisma.auditLog.findMany({ where: { action: 'meter_price.change', entityId: id }, orderBy: { occurredAt: 'asc' } });
    expect(logs.map((l) => [l.reason, (l.after as { replaced_same_day?: boolean }).replaced_same_day ?? false])).toEqual([
      ['Giá ban đầu khi tạo tòa', false],
      ['Nhập nhầm giá điện', true],
      ['Nhập nhầm giá điện', false],
    ]);

    // Đổi giá kỳ sau: thêm phiên bản mới, giá kỳ hiện tại giữ nguyên
    const v2 = await send('patch', `/api/v1/buildings/${id}`, {
      expected_version: await version(id),
      meter_prices: { ELECTRICITY: '4000', effective_from: '2026-11-01', reason: 'Điện lực tăng giá' },
    });
    expect(v2.status, JSON.stringify(v2.body)).toBe(200);
    const e = (await prices(id)).items.find((i) => i.meter_type === 'ELECTRICITY')!;
    expect([e.current?.unit_price, e.upcoming.map((x) => [x.unit_price, x.effective_from])]).toEqual(['3600', [['4000', '2026-11-01']]]);
  });

  it('kiểm tra dữ liệu: đổi giá phải có lý do, ngày 1, ít nhất một giá; kỳ đã chốt chỉ số cần xác nhận; kỳ đã phát hành thì chặn', async () => {
    const id = (await send('post', '/api/v1/buildings', { code: 'K2', name: 'Kiểm tra' })).body.id as string;
    const bad = async (meter_prices: unknown) => {
      const r = await send('patch', `/api/v1/buildings/${id}`, { expected_version: await version(id), meter_prices });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      return Object.keys(r.body.field_errors ?? {});
    };
    expect(await bad({ ELECTRICITY: '1', effective_from: '2026-11-01' })).toContain('meter_prices.reason');
    expect(await bad({ ELECTRICITY: '1', effective_from: '2026-11-05', reason: 'Sai ngày' })).toContain('meter_prices.effective_from');
    expect(await bad({ ELECTRICITY: null, WATER: null, effective_from: '2026-11-01', reason: 'Không có giá' })).toContain('meter_prices.ELECTRICITY');

    // Tòa A: giá từ 10/2026 → phòng → nhận phòng 01/10 → thông báo tháng 10 → chốt tháng 10 → thông báo tháng 11 đã phát hành
    const setA = await send('patch', `/api/v1/buildings/${A}`, {
      expected_version: await version(A),
      meter_prices: { ELECTRICITY: '4000', WATER: '20000', effective_from: '2026-10-01', reason: 'Giá đầu' },
    });
    expect(setA.status, JSON.stringify(setA.body)).toBe(200);
    const room = (await send('post', '/api/v1/rooms', { building_id: A, code: 'P1', default_rent_vnd: '3000000', max_occupants: 2, initial_readings: { ELECTRICITY: '100', WATER: '10' } })).body;
    const mi = await send(
      'post',
      '/api/v1/tenancies/move-in',
      {
        room_id: room.id,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: '0',
        primary: { new_tenant: { full_name: 'Khách P1' } },
        meter_readings: [
          { type: 'ELECTRICITY', value: '100' },
          { type: 'WATER', value: '10' },
        ],
      },
      key(),
    );
    expect(mi.status, JSON.stringify(mi.body)).toBe(201);
    const publish = async (invoiceId: string) => {
      const d: InvoiceDetail = (await owner.agent.get(`/api/v1/invoices/${invoiceId}`)).body;
      expect((await send('post', `/api/v1/invoices/${invoiceId}/publish`, { expected_version: d.version, source_hash: d.source_hash })).status).toBe(200);
    };
    await publish((await owner.agent.get(`/api/v1/invoices?tenancy_id=${mi.body.id}&lifecycle=DRAFT`)).body.items[0].id);
    await at('2026-10-31');
    const sheet = (await owner.agent.get(`/api/v1/meter-readings/sheet?building_id=${A}&consumption_month=2026-10`)).body;
    const row = sheet.rows.find((x: { room_code: string }) => x.room_code === 'P1');
    const items = row.meters.map((m: { meter_id: string; type: string }) => ({ meter_id: m.meter_id, value: m.type === 'ELECTRICITY' ? '150' : '15' }));
    expect((await send('post', '/api/v1/meter-readings', { period: '2026-11', read_on: '2026-10-31', items })).status).toBe(200);

    // Kỳ 11/2026 đã có chỉ số chốt: chưa xác nhận → lỗi gắn đúng ô của form tòa
    const unconfirmed = await send('patch', `/api/v1/buildings/${A}`, {
      expected_version: await version(A),
      meter_prices: { ELECTRICITY: '4200', effective_from: '2026-11-01', reason: 'Tăng giá' },
    });
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.field_errors['meter_prices.confirm_existing_readings']).toBeDefined();
    expect((await send('patch', `/api/v1/buildings/${A}`, { name: 'Không đổi', expected_version: await version(A) })).body.name).toBe('Không đổi'); // tên tòa không bị rollback cùng lỗi trước

    await at('2026-11-01');
    const gen = await send('post', '/api/v1/billing/generate', { period: '2026-11', tenancy_ids: [mi.body.id] });
    await publish(gen.body.items[0].invoice_id);

    // Giá từ 10/2026 đã dùng trên thông báo tháng 11 đã phát hành: không ghi đè cùng ngày
    const used = await send('patch', `/api/v1/buildings/${A}`, {
      expected_version: await version(A),
      meter_prices: { ELECTRICITY: '9999', effective_from: '2026-10-01', reason: 'Sửa giá cũ', confirm_existing_readings: true },
    });
    expect(used.status, JSON.stringify(used.body)).toBe(409);
    expect(current(await prices(A)).ELECTRICITY).toEqual(['4000', '2026-10-01']);
  });
});
