import type { CashFlowReport, ExpenseDto, InvoiceDetail, OccupancyReport, OperatingReport, RevenueBreakdown, RevenueReport } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { createReservation, createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const key = () => `p12-${Date.now()}-${++keySeq}`;

describe('Phase 12 — chi phí và báo cáo tài chính mở rộng (T38 đầy đủ)', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const post = (url: string, body: unknown, s: Session = owner, idem = true) => {
    const r = s.agent.post(url).set(CSRF_HEADER, s.csrf);
    if (idem) r.set('Idempotency-Key', key());
    return r.send(body as object);
  };
  const get = (url: string, s: Session = owner) => s.agent.get(url);
  const expense = (body: Record<string, unknown>, s: Session = owner) =>
    post('/api/v1/expenses', { category: 'REPAIR', amount_vnd: '300000', spent_on: '2026-10-05', method: 'CASH', ...body }, s);

  /** Fixture tháng 10/2026: thuê tòa A (cọc 1.000.000, thu 2.000.000 / 3.000.000), giữ chỗ tòa B 500.000 bị giữ lại, chi phí. */
  async function fixture() {
    const roomA = await createRoom(t, { building: 'A' });
    const roomB = await createRoom(t, { building: 'B' });
    const mi = await post('/api/v1/tenancies/move-in', {
      room_id: roomA.id,
      start_date: '2026-10-01',
      monthly_rent_vnd: '3000000',
      deposit_required_vnd: '1000000',
      deposit_received: { amount_vnd: '1000000', method: 'CASH', paid_at: '2026-10-01' },
      primary: { new_tenant: { full_name: 'Khách Tài Chính' } },
    });
    expect(mi.status, JSON.stringify(mi.body)).toBe(201);
    const tenancyId = mi.body.id as string;
    const draftId = (await get(`/api/v1/invoices?tenancy_id=${tenancyId}&lifecycle=DRAFT`)).body.items[0].id as string;
    const d: InvoiceDetail = (await get(`/api/v1/invoices/${draftId}`)).body;
    expect((await post(`/api/v1/invoices/${draftId}/publish`, { expected_version: d.version, source_hash: d.source_hash }, owner, false)).status).toBe(200);
    await at('2026-10-10');
    const pay = await post('/api/v1/payments', { tenancy_id: tenancyId, amount_vnd: '2000000', method: 'CASH', paid_at: '2026-10-10', allocations: [{ invoice_id: draftId, amount_vnd: '2000000' }] });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);

    const res = await createReservation(t, roomB.id, { holdFrom: '2026-11-01', holdUntil: '2026-11-05' });
    expect((await post(`/api/v1/reservations/${res.id}/holding-transactions`, { type: 'RECEIVED', amount_vnd: '500000', paid_at: '2026-10-02', method: 'CASH' })).status).toBe(201);
    await at('2026-10-15');
    const f = await post(`/api/v1/reservations/${res.id}/holding-transactions`, { type: 'FORFEIT', amount_vnd: '500000', paid_at: '2026-10-15', reason: 'Khách hủy, giữ lại theo thỏa thuận' });
    expect(f.status, JSON.stringify(f.body)).toBe(201);

    const e1 = await expense({ building_id: SEED_IDS.buildings.A, amount_vnd: '300000', note: 'Sửa vòi nước' });
    expect(e1.status, JSON.stringify(e1.body)).toBe(201);
    expect((await expense({ category: 'TAX_FEE', amount_vnd: '200000', spent_on: '2026-10-06' })).status).toBe(201); // chi chung
    const wrong = await expense({ building_id: SEED_IDS.buildings.A, amount_vnd: '100000', spent_on: '2026-10-07' });
    expect((await post(`/api/v1/expenses/${wrong.body.id}/reverse`, { reason: 'Nhập nhầm số tiền' })).status).toBe(200);
    await at('2026-11-01');
    return { tenancyId, roomA, roomB };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    await at('2026-10-01');
  });
  afterAll(() => t.close());

  it('chi phí: ghi khi đã chi, đảo có lý do (không xóa), phạm vi tòa, quyền theo vai trò', async () => {
    const room = await createRoom(t, { building: 'A' });
    expect((await expense({ spent_on: '2026-10-02' })).status).toBe(400); // tương lai
    expect((await expense({ building_id: SEED_IDS.buildings.B, room_id: room.id })).status).toBe(400); // phòng khác tòa
    expect((await expense({ building_id: SEED_IDS.buildings.A, amount_vnd: '0', spent_on: '2026-10-01' })).status).toBe(400);
    const ok = await expense({ room_id: room.id, spent_on: '2026-10-01' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const e: ExpenseDto = ok.body;
    expect(e).toMatchObject({ number: 'PC-2610-0001', building_code: 'A', room_code: room.code, status: 'POSTED', amount_vnd: '300000' });

    const acc = await login(t, 'accountantB');
    const mgr = await login(t, 'managerA');
    // Kế toán tòa B: không ghi cho tòa A (404), không ghi chi chung (400), không đảo (403), không thấy chi tòa A
    expect((await expense({ building_id: SEED_IDS.buildings.A, spent_on: '2026-10-01' }, acc)).status).toBe(404);
    expect((await expense({ spent_on: '2026-10-01' }, acc)).status).toBe(400);
    expect((await expense({ building_id: SEED_IDS.buildings.B, spent_on: '2026-10-01' }, acc)).status).toBe(201);
    expect((await post(`/api/v1/expenses/${e.id}/reverse`, { reason: 'Thử đảo' }, acc)).status).toBe(403);
    expect((await get('/api/v1/expenses', acc)).body.items.map((x: ExpenseDto) => x.building_code)).toEqual(['B']);
    // Quản lý xem được trong tòa A, không ghi
    expect((await get('/api/v1/expenses', mgr)).body.items.map((x: ExpenseDto) => x.number)).toEqual([e.number]);
    expect((await expense({ building_id: SEED_IDS.buildings.A, spent_on: '2026-10-01' }, mgr)).status).toBe(403);
    // Nhân viên không thấy chi phí
    expect((await get('/api/v1/expenses', await login(t, 'staffA'))).status).toBe(403);

    // Đảo: cần lý do; đảo lần hai bị chặn; vẫn còn trong danh sách với trạng thái đã đảo; có audit
    expect((await post(`/api/v1/expenses/${e.id}/reverse`, {})).status).toBe(400);
    const rev = await post(`/api/v1/expenses/${e.id}/reverse`, { reason: 'Nhập trùng khoản chi' });
    expect(rev.status).toBe(200);
    expect(rev.body).toMatchObject({ status: 'REVERSED', reverse_reason: 'Nhập trùng khoản chi' });
    expect((await post(`/api/v1/expenses/${e.id}/reverse`, { reason: 'Đảo lần nữa' })).status).toBe(422);
    const list = (await get('/api/v1/expenses')).body;
    expect(list.items.find((x: ExpenseDto) => x.id === e.id).status).toBe('REVERSED');
    expect(list.total_vnd).toBe('300000'); // chỉ khoản tòa B còn hiệu lực
    expect(await t.prisma.auditLog.count({ where: { action: { in: ['expense.create', 'expense.reverse'] } } })).toBeGreaterThanOrEqual(3);
  });

  it('T38: doanh thu theo khoản thu khớp doanh thu thuần; dòng tiền tách cọc/giữ chỗ/chi phí; giữ chỗ bị giữ lại là thu nhập khác; cọc không thành doanh thu', async () => {
    await fixture();
    const q = '?from=2026-10&to=2026-10';
    const monthly: RevenueReport = (await get(`/api/v1/reports/revenue-monthly${q}`)).body;
    const byCharge: RevenueBreakdown = (await get(`/api/v1/reports/revenue-breakdown${q}&group_by=charge`)).body;
    expect(byCharge.rows.map((r) => [r.label, r.total_vnd])).toEqual([['Tiền phòng', '3000000']]);
    expect(byCharge.totals.total_vnd).toBe(monthly.rows[0]!.net_vnd);
    const byBuilding: RevenueBreakdown = (await get(`/api/v1/reports/revenue-breakdown${q}&group_by=building`)).body;
    expect(byBuilding.rows.map((r) => [r.label.slice(0, 1), r.total_vnd])).toEqual([['A', '3000000']]);
    const byRoom: RevenueBreakdown = (await get(`/api/v1/reports/revenue-breakdown${q}&group_by=room`)).body;
    expect(byRoom.totals.total_vnd).toBe('3000000');

    const cash: CashFlowReport = (await get(`/api/v1/reports/cash-flow${q}`)).body;
    expect(cash.rows[0]).toMatchObject({
      rent_collections_vnd: '2000000',
      deposits_in_vnd: '1000000',
      holding_in_vnd: '500000',
      cash_in_vnd: '3500000',
      expenses_vnd: '500000', // 300.000 + 200.000; khoản đã đảo không tính
      cash_out_vnd: '500000',
      net_cash_vnd: '3000000',
    });

    const op: OperatingReport = (await get(`/api/v1/reports/operating${q}`)).body;
    expect(op.rows[0]).toEqual({ period: '2026-10', net_revenue_vnd: '3000000', other_income_vnd: '500000', expenses_vnd: '500000', operating_income_vnd: '3000000' });
    expect(op.expenses_by_category.map((c) => [c.category, c.amount_vnd])).toEqual([
      ['REPAIR', '300000'],
      ['TAX_FEE', '200000'],
    ]);

    // Lấp đầy tháng 10: 2 phòng × 31 ngày, 1 phòng thuê cả tháng
    const occ: OccupancyReport = (await get(`/api/v1/reports/occupancy${q}`)).body;
    expect(occ.rows[0]).toEqual({ period: '2026-10', room_days: 62, occupied_days: 31, rate_pct: '50.0' });

    // Phạm vi tòa: kế toán tòa B chỉ thấy tiền giữ chỗ tòa B; chi chung và tòa A không tính
    const acc = await login(t, 'accountantB');
    const accCash: CashFlowReport = (await get(`/api/v1/reports/cash-flow${q}`, acc)).body;
    expect(accCash.rows[0]).toMatchObject({ rent_collections_vnd: '0', deposits_in_vnd: '0', holding_in_vnd: '500000', expenses_vnd: '0' });
    const accOp: OperatingReport = (await get(`/api/v1/reports/operating${q}`, acc)).body;
    expect(accOp.rows[0]).toMatchObject({ net_revenue_vnd: '0', other_income_vnd: '500000', expenses_vnd: '0' });
    expect((await get(`/api/v1/reports/cash-flow${q}`, await login(t, 'managerA'))).status).toBe(403);

    // CSV cùng số liệu
    const csv = await get(`/api/v1/reports/cash-flow/export${q}`).buffer(true).parse((res, cb) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (data += c));
      res.on('end', () => cb(null, data));
    });
    const lines = (csv.body as string).trim().split('\r\n');
    expect(lines[1]).toBe('10/2026,2000000,1000000,500000,3500000,0,0,0,500000,500000,3000000');
    const opCsv = await get(`/api/v1/reports/operating/export${q}`).buffer(true).parse((res, cb) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (data += c));
      res.on('end', () => cb(null, data));
    });
    expect((opCsv.body as string).trim().split('\r\n')[1]).toBe('10/2026,3000000,500000,500000,3000000');
  });
});
