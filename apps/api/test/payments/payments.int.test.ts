import type { InvoiceDetail } from '@ql-tro/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { parseTlv } from '../../src/domain/payments/vietqr.js';
import { SharingService } from '../../src/modules/payments/sharing.service.js';
import { createRoom, ownerId, serviceId } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const key = () => `pay-${Date.now()}-${++keySeq}`;

describe('Phase 6 — thu tiền, credit, công nợ, VietQR', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const post = (url: string, body: unknown, s: Session = owner, idem: string | null = key()) => {
    const r = s.agent.post(url).set(CSRF_HEADER, s.csrf);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body as object);
  };
  const invoice = async (id: string): Promise<InvoiceDetail> => (await owner.agent.get(`/api/v1/invoices/${id}`)).body;

  async function setup() {
    const by = await ownerId(t);
    await t.prisma.servicePriceHistory.create({
      data: { workspaceId: SEED_IDS.workspace, serviceId: await serviceId(t, 'INTERNET'), buildingId: null, effectiveFrom: new Date('2026-01-01'), unitPrice: '100000', createdBy: by },
    });
    const room = await createRoom(t);
    const res = await post('/api/v1/tenancies/move-in', {
      room_id: room.id,
      start_date: '2026-10-20',
      monthly_rent_vnd: '3000000',
      deposit_required_vnd: '0',
      primary: { new_tenant: { full_name: 'Khách Thu Tiền', phone: '0912345678', identity_number: '079123456789' } },
      services: [{ service_id: await serviceId(t, 'INTERNET'), quantity: '1' }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tenancyId = res.body.id as string;
    const draft = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${tenancyId}`)).body.items[0];
    const d = await invoice(draft.id);
    await post(`/api/v1/invoices/${d.id}/publish`, { expected_version: d.version, source_hash: d.source_hash }, owner, null);
    return { tenancyId, roomId: room.id, invoiceId: d.id };
  }

  const pay = (tenancyId: string, invoiceId: string, amount: string, extra: Record<string, unknown> = {}, s: Session = owner, idem = key()) =>
    post('/api/v1/payments', { tenancy_id: tenancyId, amount_vnd: amount, method: 'CASH', paid_at: '2026-10-20', allocations: [{ invoice_id: invoiceId, amount_vnd: amount }], ...extra }, s, idem);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    t.app.get(SharingService).resetThrottle();
    await at('2026-10-20');
  });
  afterAll(() => t.close());

  it('T17: thu từng phần — remaining và PARTIAL/PAID đúng; quá hạn không làm mất PARTIAL', async () => {
    const { tenancyId, invoiceId } = await setup();
    expect(await invoice(invoiceId)).toMatchObject({ total_vnd: '1200000', remaining_vnd: '1200000', payment_status: 'UNPAID', overdue: false });
    const p1 = await pay(tenancyId, invoiceId, '500000', { method: 'QR', reference: 'FT2610XYZ' });
    expect(p1.status).toBe(201);
    expect(p1.body).toMatchObject({ number: 'PT-202610-0001', amount_vnd: '500000', status: 'POSTED', allocations: [{ invoice_id: invoiceId, amount_vnd: '500000' }] });
    await at('2026-10-25');
    expect(await invoice(invoiceId)).toMatchObject({ settled_vnd: '500000', remaining_vnd: '700000', payment_status: 'PARTIAL', overdue: true });
    expect((await owner.agent.get('/api/v1/invoices?payment_status=OVERDUE')).body.total).toBe(1);
    expect((await pay(tenancyId, invoiceId, '700001')).status).toBe(422);
    expect((await pay(tenancyId, invoiceId, '700000')).status).toBe(201);
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '0', payment_status: 'PAID', overdue: false });
    expect((await pay(tenancyId, invoiceId, '1')).status).toBe(422);
  });

  it('T18: hai phiếu thu đồng thời vượt remaining → chỉ phần hợp lệ được ghi; nợ không âm', async () => {
    const { tenancyId, invoiceId } = await setup();
    const results = await Promise.all([pay(tenancyId, invoiceId, '800000'), pay(tenancyId, invoiceId, '800000')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await invoice(invoiceId)).toMatchObject({ settled_vnd: '800000', remaining_vnd: '400000' });
  });

  it('idempotency: cùng key cùng payload trả kết quả cũ; khác payload 409; thiếu key 400', async () => {
    const { tenancyId, invoiceId } = await setup();
    const k = key();
    const a = await pay(tenancyId, invoiceId, '100000', {}, owner, k);
    const b = await pay(tenancyId, invoiceId, '100000', {}, owner, k);
    expect(b.body.id).toBe(a.body.id);
    expect(await t.prisma.payment.count()).toBe(1);
    expect((await pay(tenancyId, invoiceId, '200000', {}, owner, k)).status).toBe(409);
    expect((await post('/api/v1/payments', { tenancy_id: tenancyId, amount_vnd: '1', method: 'CASH', paid_at: '2026-10-20', allocations: [{ invoice_id: invoiceId, amount_vnd: '1' }] }, owner, null)).status).toBe(400);
  });

  it('T37 (payment) / T19: đảo phiếu thu → nợ quay lại; không đảo hai lần; thông báo đã có thu không hủy được', async () => {
    const { tenancyId, invoiceId } = await setup();
    const p = (await pay(tenancyId, invoiceId, '1200000')).body;
    const inv = await invoice(invoiceId);
    expect((await post(`/api/v1/invoices/${invoiceId}/cancel`, { reason: 'Hủy thử', expected_version: inv.version }, owner, null)).status).toBe(422);
    const staff = await login(t, 'staffA');
    expect((await post(`/api/v1/payments/${p.id}/reverse`, { reason: 'Ghi nhầm' }, staff)).status).toBe(403);
    const r = await post(`/api/v1/payments/${p.id}/reverse`, { reason: 'Ghi nhầm số tiền' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'REVERSED', reversal_reason: 'Ghi nhầm số tiền' });
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '1200000', payment_status: 'UNPAID' });
    expect((await post(`/api/v1/payments/${p.id}/reverse`, { reason: 'Đảo lại' })).status).toBe(422);
    expect(await t.prisma.auditLog.count({ where: { action: 'payment.reverse', entityId: p.id } })).toBe(1);
  });

  it('T29 / T37 (credit): credit cấn trừ nợ khác trước (đến hạn sớm nhất), phần dư hoàn riêng; đảo đúng số dư', async () => {
    const { tenancyId, roomId, invoiceId } = await setup();
    await pay(tenancyId, invoiceId, '1200000');
    // Tháng 11 đã phát hành, chưa thu
    await at('2026-10-31');
    const meter = await t.prisma.meter.findFirst({ where: { roomId } });
    expect(meter).toBeNull();
    await at('2026-11-01');
    const gen = await post('/api/v1/billing/generate', { period: '2026-11', tenancy_ids: [tenancyId] }, owner, null);
    const nov = await invoice(gen.body.items[0].invoice_id);
    await post(`/api/v1/invoices/${nov.id}/publish`, { expected_version: nov.version, source_hash: nov.source_hash }, owner, null);
    expect((await invoice(nov.id)).total_vnd).toBe('3100000');
    // Giảm giá tháng 10 thành 0 sau khi đã thu đủ → credit 1.161.290 qua "điều chỉnh ngay"
    await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-10-21', monthly_rent_vnd: '0', reason: 'Miễn tiền phòng', confirm_mid_month: true }, owner, null);
    await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-11-01', monthly_rent_vnd: '3000000', reason: 'Khôi phục' }, owner, null);
    const adj = await post(`/api/v1/invoices/${invoiceId}/adjustments`, { confirm: true, reason: 'Miễn tiền phòng tháng đầu' }, owner, null);
    expect(adj.status, JSON.stringify(adj.body)).toBe(200);
    const credit = adj.body.credit_invoice;
    // E(10/2026) = 3.000.000 × 1/31 = 96.774 → credit 1.161.290 − 96.774 = 1.064.516
    expect(credit).toMatchObject({ total_vnd: '1064516', remaining_vnd: '1064516' });

    const applied = await post('/api/v1/credit-applications', { credit_invoice_id: credit.id });
    expect(applied.status).toBe(201);
    expect(await invoice(nov.id)).toMatchObject({ remaining_vnd: String(3100000 - 1064516), payment_status: 'PARTIAL' });
    expect((await invoice(credit.id)).remaining_vnd).toBe('0');
    // Không hoàn được khi credit đã dùng hết; đảo cấn trừ thì credit quay lại và hoàn được
    expect((await post('/api/v1/credit-refunds', { credit_invoice_id: credit.id, amount_vnd: '1', paid_at: '2026-11-01', method: 'CASH' })).status).toBe(422);
    const appId = applied.body.ids[0];
    expect((await post(`/api/v1/credit-applications/${appId}/reverse`, { reason: 'Khách muốn nhận tiền' })).status).toBe(200);
    expect((await post(`/api/v1/credit-applications/${appId}/reverse`, { reason: 'Lần hai' })).status).toBe(422);
    const refund = await post('/api/v1/credit-refunds', { credit_invoice_id: credit.id, amount_vnd: '1064516', paid_at: '2026-11-01', method: 'BANK_TRANSFER', reference: 'CK hoàn' });
    expect(refund.status).toBe(201);
    expect((await invoice(credit.id)).remaining_vnd).toBe('0');
    expect((await invoice(nov.id)).remaining_vnd).toBe('3100000');
    // Không ghi vào sổ cọc
    expect(await t.prisma.depositTransaction.count({ where: { tenancyId } })).toBe(0);

    // Sao kê: số dư cuối = còn nợ − credit còn lại
    const st = (await owner.agent.get(`/api/v1/tenancies/${tenancyId}/statement`)).body;
    expect(st).toMatchObject({ debt_vnd: '3100000', credit_available_vnd: '0', balance_vnd: '3100000' });
    expect(st.entries.at(-1).balance_vnd).toBe('3100000');
    const debts = (await owner.agent.get('/api/v1/debts')).body;
    expect(debts.items).toEqual([expect.objectContaining({ tenancy_id: tenancyId, debt_vnd: '3100000', open_invoices: 1 })]);
  });

  it('T57/T58: VietQR đúng tài khoản và số tiền còn lại; không tạo cho nháp/đã trả đủ; QR không đổi remaining', async () => {
    const { tenancyId, invoiceId } = await setup();
    expect((await owner.agent.get(`/api/v1/invoices/${invoiceId}/vietqr`)).status).toBe(422); // chưa có tài khoản
    const acc = await owner.agent.put('/api/v1/settings/payment-account').set(CSRF_HEADER, owner.csrf).send({ bank_bin: '970436', account_number: '0123456789', account_name: 'Nguyễn Văn Demo' });
    expect(acc.status).toBe(200);
    expect(acc.body).toMatchObject({ bank_name: 'Vietcombank', account_name: 'NGUYEN VAN DEMO' });
    await pay(tenancyId, invoiceId, '200000');
    const qr = (await owner.agent.get(`/api/v1/invoices/${invoiceId}/vietqr`)).body;
    const inv = await invoice(invoiceId);
    expect(qr).toMatchObject({ amount_vnd: '1000000', account_number: '0123456789', content: `${inv.number!.replace(/-/g, '')} ${inv.room_code}` });
    const top = parseTlv(qr.payload);
    expect(top['54']).toBe('1000000');
    expect(parseTlv(parseTlv(top['38']!)['01']!)).toEqual({ '00': '970436', '01': '0123456789' });
    expect(qr.content.length).toBeLessThanOrEqual(25);
    expect((await invoice(invoiceId)).remaining_vnd).toBe('1000000');
    expect(await t.prisma.payment.count()).toBe(1);
    await pay(tenancyId, invoiceId, '1000000');
    expect((await owner.agent.get(`/api/v1/invoices/${invoiceId}/vietqr`)).status).toBe(422);
  });

  it('T59: link xem thông báo — chỉ lưu hash; sai/hết hạn/thu hồi cùng một lỗi; không lộ dữ liệu cá nhân; QR ẩn khi hết nợ', async () => {
    const { tenancyId, invoiceId } = await setup();
    await owner.agent.put('/api/v1/settings/payment-account').set(CSRF_HEADER, owner.csrf).send({ bank_bin: '970436', account_number: '0123456789', account_name: 'NGUYEN VAN DEMO' });
    const staff = await login(t, 'staffA');
    const link = await post(`/api/v1/invoices/${invoiceId}/share-links`, {}, staff, null);
    expect(link.status).toBe(201);
    const token: string = link.body.token;
    expect(token.length).toBeGreaterThanOrEqual(40);
    const stored = await t.prisma.shareLink.findFirstOrThrow();
    expect(stored.tokenHash).not.toContain(token);
    expect(JSON.stringify(stored)).not.toContain(token);

    const anon = request.agent(t.server);
    const view = await anon.get(`/api/v1/public/invoices/${token}`);
    expect(view.status).toBe(200);
    expect(view.headers['cache-control']).toBe('no-store');
    expect(view.headers['x-robots-tag']).toContain('noindex');
    expect(view.body).toMatchObject({ room_code: expect.any(String), remaining_vnd: '1200000', qr: expect.objectContaining({ amount_vnd: '1200000' }) });
    const text = JSON.stringify(view.body);
    for (const secret of ['0912345678', '079123456789', 'Khách Thu Tiền']) expect(text).not.toContain(secret);

    const wrong = await anon.get(`/api/v1/public/invoices/${token.slice(0, -2)}xx`);
    await pay(tenancyId, invoiceId, '1200000');
    expect((await anon.get(`/api/v1/public/invoices/${token}`)).body).toMatchObject({ remaining_vnd: '0', qr: null });
    await post(`/api/v1/share-links/${link.body.id}/revoke`, {}, owner, null);
    const revoked = await anon.get(`/api/v1/public/invoices/${token}`);
    const second = await post(`/api/v1/invoices/${invoiceId}/share-links`, {}, owner, null);
    await at('2026-12-20'); // > 60 ngày
    const expired = await anon.get(`/api/v1/public/invoices/${second.body.token}`);
    for (const r of [wrong, revoked, expired]) expect([r.status, r.body.message]).toEqual([404, 'Link không còn hiệu lực.']);
  });

  it('T59 (giới hạn truy cập theo IP)', async () => {
    const anon = request.agent(t.server);
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await anon.get('/api/v1/public/invoices/khong-ton-tai-token-abcdefghijk')).status;
    expect(last).toBe(429);
  });

  it('phạm vi: nhân viên ghi thu tòa được giao; tòa khác 404; không cấn trừ/hoàn credit', async () => {
    const { tenancyId, invoiceId } = await setup();
    const staffA = await login(t, 'staffA');
    expect((await pay(tenancyId, invoiceId, '100000', {}, staffA)).status).toBe(201);
    const staffBC = await login(t, 'staffBC');
    expect((await pay(tenancyId, invoiceId, '100000', {}, staffBC)).status).toBe(404);
    expect((await post('/api/v1/credit-refunds', { credit_invoice_id: invoiceId, amount_vnd: '1', paid_at: '2026-10-20', method: 'CASH' }, staffA)).status).toBe(403);
    expect((await staffBC.agent.get(`/api/v1/tenancies/${tenancyId}/statement`)).status).toBe(404);
  });
});
