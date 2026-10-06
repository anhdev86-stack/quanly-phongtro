import type { Dashboard, InvoiceDetail, RevenueReport } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const key = () => `rp-${Date.now()}-${++keySeq}`;

describe('Phase 8A — dashboard và báo cáo', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const post = (url: string, body: unknown, idem = false) => {
    const r = owner.agent.post(url).set(CSRF_HEADER, owner.csrf);
    if (idem) r.set('Idempotency-Key', key());
    return r.send(body as object);
  };
  const invoice = async (id: string): Promise<InvoiceDetail> => (await owner.agent.get(`/api/v1/invoices/${id}`)).body;

  async function moveIn(building: 'A' | 'B', deposit: string) {
    const room = await createRoom(t, { building });
    const res = await post(
      '/api/v1/tenancies/move-in',
      {
        room_id: room.id,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: deposit,
        ...(deposit !== '0' ? { deposit_received: { amount_vnd: deposit, method: 'CASH', paid_at: '2026-10-01' } } : {}),
        primary: { new_tenant: { full_name: `Khách ${building}` } },
      },
      true,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { roomId: room.id, tenancyId: res.body.id as string };
  }
  async function publish(id: string) {
    const d = await invoice(id);
    const r = await post(`/api/v1/invoices/${id}/publish`, { expected_version: d.version, source_hash: d.source_hash });
    expect(r.status).toBe(200);
    return r.body.invoice as InvoiceDetail;
  }
  async function firstDraft(tenancyId: string) {
    return (await owner.agent.get(`/api/v1/invoices?tenancy_id=${tenancyId}&lifecycle=DRAFT`)).body.items[0].id as string;
  }
  const pay = (tenancyId: string, invoiceId: string, amount: string, paidAt: string) =>
    post('/api/v1/payments', { tenancy_id: tenancyId, amount_vnd: amount, method: 'BANK_TRANSFER', paid_at: paidAt, allocations: [{ invoice_id: invoiceId, amount_vnd: amount }] }, true);

  /** Fixture: tòa A có thu một phần, thu muộn, credit cấn trừ; tòa B có nợ chưa thu. */
  async function fixture() {
    const x = await moveIn('A', '1000000');
    const y = await moveIn('B', '0');
    const octX = await publish(await firstDraft(x.tenancyId));
    await publish(await firstDraft(y.tenancyId));
    await at('2026-10-10');
    expect((await pay(x.tenancyId, octX.id, '2000000', '2026-10-10')).status).toBe(201);
    await at('2026-11-01');
    const g = await post('/api/v1/billing/generate', { period: '2026-11', tenancy_ids: [x.tenancyId] });
    const novX = await publish(g.body.items[0].invoice_id);
    await at('2026-11-05');
    await pay(x.tenancyId, novX.id, '3000000', '2026-11-03');
    await pay(x.tenancyId, octX.id, '500000', '2026-11-05');
    await at('2026-11-20');
    // Giảm giá từ 16/11 sau khi đã thu → credit 300.000 phát hành tháng 11, cấn vào nợ tháng 10 còn lại
    await post(`/api/v1/tenancies/${x.tenancyId}/rent-prices`, { effective_from: '2026-11-16', monthly_rent_vnd: '2400000', reason: 'Giảm giá', confirm_mid_month: true });
    const adj = await post(`/api/v1/invoices/${novX.id}/adjustments`, { confirm: true, reason: 'Giảm giá nửa cuối tháng 11' });
    expect(adj.body.credit_invoice.total_vnd).toBe('300000');
    expect((await post('/api/v1/credit-applications', { credit_invoice_id: adj.body.credit_invoice.id }, true)).status).toBe(201);
    return { x, y, octX, novX };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    await at('2026-10-01');
  });
  afterAll(() => t.close());

  it('T65: doanh thu theo tháng khớp fixture; Phát sinh = Đã thu + Còn nợ; cọc không vào doanh thu; thực thu theo ngày nhận; đúng phạm vi tòa; CSV khớp', async () => {
    await fixture();
    const staffA = await login(t, 'staffA');
    const A = (await owner.agent.get('/api/v1/buildings')).body.find((b: { code: string }) => b.code === 'A').id as string;
    const r: RevenueReport = (await owner.agent.get(`/api/v1/reports/revenue-monthly?from=2026-10&to=2026-11&building_id=${A}`)).body;
    expect(r.rows).toEqual([
      {
        period: '2026-10',
        invoiced_vnd: '3000000',
        reductions_vnd: '0',
        net_vnd: '3000000',
        paid_cash_vnd: '2500000',
        paid_deposit_vnd: '0',
        paid_credit_vnd: '300000',
        paid_total_vnd: '2800000',
        outstanding_vnd: '200000',
        cash_in_period_vnd: '2000000',
      },
      {
        period: '2026-11',
        invoiced_vnd: '3000000',
        reductions_vnd: '300000',
        net_vnd: '2700000',
        paid_cash_vnd: '3000000',
        paid_deposit_vnd: '0',
        paid_credit_vnd: '0',
        paid_total_vnd: '3000000',
        outstanding_vnd: '0',
        cash_in_period_vnd: '3500000',
      },
    ]);
    for (const row of r.rows) expect(BigInt(row.invoiced_vnd)).toBe(BigInt(row.paid_total_vnd) + BigInt(row.outstanding_vnd));
    // Mọi tòa: thêm 3.000.000 nợ tháng 10 của tòa B
    const all: RevenueReport = (await owner.agent.get('/api/v1/reports/revenue-monthly?from=2026-10&to=2026-11')).body;
    expect(all.rows[0]).toMatchObject({ invoiced_vnd: '6000000', outstanding_vnd: '3200000' });
    // Nhân viên không có quyền báo cáo
    expect((await staffA.agent.get('/api/v1/reports/revenue-monthly')).status).toBe(403);
    expect((await staffA.agent.get('/api/v1/reports/revenue-monthly/export')).status).toBe(403);
    // CSV cùng số liệu
    const csv = await owner.agent.get(`/api/v1/reports/revenue-monthly/export?from=2026-10&to=2026-11&building_id=${A}`).buffer(true).parse((res, cb) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (data += c));
      res.on('end', () => cb(null, data));
    });
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = csv.body as string;
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.trim().split('\r\n');
    expect(lines[1]).toBe('10/2026,3000000,0,3000000,2500000,0,300000,2800000,200000,2000000');
    expect(lines[2]).toBe('11/2026,3000000,300000,2700000,3000000,0,0,3000000,0,3500000');
    expect(lines[3]).toBe('Tổng,6000000,300000,5700000,5500000,0,300000,5800000,200000,5500000');
  });

  it('báo cáo cọc và thu tiền: cọc là nghĩa vụ (không phải doanh thu); trừ cọc/cấn trừ credit trình bày riêng khỏi tiền mặt', async () => {
    const { x } = await fixture();
    const dep = (await owner.agent.get('/api/v1/reports/deposits')).body;
    expect(dep.rows.find((r: { tenancy_id: string }) => r.tenancy_id === x.tenancyId)).toMatchObject({ held_vnd: '1000000', required_vnd: '1000000', refund_payable_vnd: '0' });
    expect(dep.totals.held_vnd).toBe('1000000');
    const col = (await owner.agent.get('/api/v1/reports/collections?from=2026-11-01&to=2026-11-30')).body;
    expect(col.totals).toMatchObject({ cash_vnd: '3500000', credit_applied_vnd: '300000', deposit_applied_vnd: '0', by_method: { BANK_TRANSFER: '3500000' } });
    expect(col.payments).toHaveLength(2);
    const csv = await owner.agent.get('/api/v1/reports/collections/export?from=2026-11-01&to=2026-11-30');
    expect(csv.status).toBe(200);
  });

  it('T34/T38: dashboard theo phạm vi tòa; phòng chia loại trừ lẫn nhau; “sắp trả” là chỉ số phụ; việc cần xử lý', async () => {
    const { x } = await fixture();
    await at('2026-12-02');
    const d: Dashboard = (await owner.agent.get('/api/v1/dashboard?period=2026-12')).body;
    expect(d.rooms.OCCUPIED).toBe(2);
    expect(d.rooms.total).toBe(d.rooms.AVAILABLE + d.rooms.OCCUPIED + d.rooms.RESERVED + d.rooms.MAINTENANCE);
    expect(d.money).toMatchObject({ debt_vnd: '3200000', deposit_held_vnd: '1000000', collected_in_period_vnd: '0' });
    const kinds = d.todo.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['OVERDUE_INVOICES', 'RESIDENCE_UNREGISTERED']));
    expect(d.todo.find((x) => x.kind === 'OVERDUE_INVOICES')).toMatchObject({ count: 2, amount_vnd: '3200000' });

    // Báo trả: vẫn OCCUPIED, chỉ số phụ tăng — không đếm hai lần
    const tn = (await owner.agent.get(`/api/v1/tenancies/${x.tenancyId}`)).body;
    await post(`/api/v1/tenancies/${x.tenancyId}/move-out-notices`, { notice_date: '2026-12-02', planned_last_charge_date: '2026-12-31', expected_version: tn.version });
    const d2: Dashboard = (await owner.agent.get('/api/v1/dashboard?period=2026-12')).body;
    expect(d2.rooms.OCCUPIED).toBe(2);
    expect(d2.secondary.notice_given).toBe(1);

    // Nhân viên tòa A chỉ thấy tòa A
    const staffA = await login(t, 'staffA');
    const ds: Dashboard = (await staffA.agent.get('/api/v1/dashboard?period=2026-12')).body;
    expect(ds.rooms.OCCUPIED).toBe(1);
    expect(ds.money).toMatchObject({ debt_vnd: '200000' });
    const staffBC = await login(t, 'staffBC');
    expect(((await staffBC.agent.get('/api/v1/dashboard?period=2026-12')).body as Dashboard).money).toMatchObject({ debt_vnd: '3000000' });
  });

  it('công nợ và khoản phải hoàn của lần thuê đã kết thúc vẫn hiện trên dashboard và báo cáo', async () => {
    const x = await moveIn('A', '2000000');
    const oct = await publish(await firstDraft(x.tenancyId));
    await pay(x.tenancyId, oct.id, oct.total_vnd, '2026-10-01');
    await at('2026-10-15');
    const s = (
      await post(`/api/v1/tenancies/${x.tenancyId}/move-out-settlements`, { last_charge_date: '2026-10-15', destination_room_status: 'READY', inventory_note: 'Đủ', final_reading_waiver: 'Không có đồng hồ' })
    ).body;
    const pv = (await post(`/api/v1/settlements/${s.id}/preview`, {})).body;
    const ap = (await post(`/api/v1/settlements/${s.id}/approve`, { expected_version: s.version, input_hash: pv.input_hash })).body;
    expect((await post(`/api/v1/settlements/${s.id}/complete`, { expected_version: ap.version }, true)).status).toBe(200);
    // Đã thu cả tháng 10, ở 15 ngày: phí đúng 3.000.000 × 15/31 = 1.451.613 → credit 1.548.387; cọc 2.000.000 phải hoàn
    const d: Dashboard = (await owner.agent.get('/api/v1/dashboard')).body;
    expect(d.money).toMatchObject({ deposit_refund_payable_vnd: '2000000', credit_refund_payable_vnd: '1548387' });
    expect(d.todo.find((x) => x.kind === 'REFUNDS_PAYABLE')).toMatchObject({ count: 2, amount_vnd: '3548387' });
    const dep = (await owner.agent.get('/api/v1/reports/deposits')).body;
    expect(dep.rows).toEqual([expect.objectContaining({ tenancy_status: 'ENDED', refund_payable_vnd: '2000000' })]);
    const debts = (await owner.agent.get('/api/v1/reports/debts')).body;
    expect(debts.items).toEqual([expect.objectContaining({ tenancy_status: 'ENDED', credit_available_vnd: '1548387' })]);
  });
});
