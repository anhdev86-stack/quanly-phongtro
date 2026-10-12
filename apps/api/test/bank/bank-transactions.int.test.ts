import type { BankTransactionDto, InvoiceDetail, PaymentDto } from '@ql-tro/shared';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BankTransactionsService } from '../../src/modules/bank/bank-transactions.service.js';
import { SharingService } from '../../src/modules/payments/sharing.service.js';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

const KEY = 'test-bank-webhook-key-0123456789';
const ACC = '0011223344';
let seq = 0;
const idem = () => `bank-${Date.now()}-${++seq}`;
let txnSeq = 1000;

describe('D-047 — giao dịch ngân hàng tự động (mock)', () => {
  let t: TestApp;
  let owner: Session;

  const post = (url: string, body: unknown, s: Session = owner, key: string | null = idem()) => {
    const r = s.agent.post(url).set(CSRF_HEADER, s.csrf);
    if (key) r.set('Idempotency-Key', key);
    return r.send(body as object);
  };
  const invoice = async (id: string): Promise<InvoiceDetail> => (await owner.agent.get(`/api/v1/invoices/${id}`)).body;
  const txns = async (s: Session = owner): Promise<BankTransactionDto[]> => (await s.agent.get('/api/v1/bank-transactions?page_size=100')).body.items;
  const payments = async (invoiceId: string): Promise<PaymentDto[]> => (await owner.agent.get(`/api/v1/payments?invoice_id=${invoiceId}`)).body.items;

  /** Payload đúng định dạng webhook SePay. */
  const payload = (amount: number, content: string, extra: Record<string, unknown> = {}) => ({
    id: ++txnSeq,
    gateway: 'Vietcombank',
    transactionDate: '2026-10-20 09:15:00',
    accountNumber: ACC,
    subAccount: null,
    code: null,
    content,
    transferType: 'in',
    transferAmount: amount,
    accumulated: 0,
    referenceCode: `FT${txnSeq}`,
    description: 'KHACH chuyen tien',
    ...extra,
  });
  const webhook = (body: unknown, key: string | null = KEY, provider = 'mock') => {
    const r = request(t.server).post(`/api/v1/bank-webhooks/${provider}`);
    if (key) r.set('Authorization', `Apikey ${key}`);
    return r.send(body as object);
  };

  async function setup(building: 'A' | 'B' = 'A') {
    await owner.agent.put('/api/v1/settings/payment-account').set(CSRF_HEADER, owner.csrf).send({ bank_bin: '970436', account_number: ACC, account_name: 'NHA TRO TEST' });
    const room = await createRoom(t, { building });
    const res = await post('/api/v1/tenancies/move-in', {
      room_id: room.id,
      start_date: '2026-10-20',
      monthly_rent_vnd: '3100000',
      deposit_required_vnd: '0',
      primary: { new_tenant: { full_name: `Khách ${building}`, phone: '0912345678' } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tenancyId = res.body.id as string;
    const draft = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${tenancyId}`)).body.items[0];
    const d = await invoice(draft.id);
    const pub = await post(`/api/v1/invoices/${d.id}/publish`, { expected_version: d.version, source_hash: d.source_hash }, owner, null);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const inv = await invoice(d.id);
    // 3.100.000 × 12/31 ngày (20–31/10)
    expect(inv.total_vnd).toBe('1200000');
    return { tenancyId, invoiceId: inv.id, code: inv.number!.replace(/-/g, ''), room: room.code };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    t.app.get(SharingService).resetThrottle();
    t.clock.set('2026-10-20T03:00:00.000Z');
    owner = await login(t, 'owner');
  });
  afterAll(() => t.close());

  it('đủ tiền: webhook → phiếu thu tự động, hết nợ; gửi lại cùng webhook không ghi trùng; QR hiện môi trường thử nghiệm', async () => {
    const { invoiceId, code, room } = await setup();
    const qr = (await owner.agent.get(`/api/v1/invoices/${invoiceId}/vietqr`)).body;
    expect(qr).toMatchObject({ content: `${code} ${room}`, amount_vnd: '1200000', test_mode: true });

    const body = payload(1200000, `MBVCB.99.${code} ${room}.CT tu 0123`);
    const r1 = await webhook(body);
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ success: true });
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '0', payment_status: 'PAID' });
    const [p] = await payments(invoiceId);
    expect(p).toMatchObject({ amount_vnd: '1200000', method: 'BANK_TRANSFER', source: 'BANK_AUTO', created_by_name: 'Tự động (ngân hàng)', received_by_name: 'Chủ trọ Demo', reference: body.referenceCode });
    const [tx] = await txns();
    expect(tx).toMatchObject({ status: 'MATCHED', payment_code: code, allocated_vnd: '1200000', unallocated_vnd: '0', source: 'WEBHOOK', invoice: { id: invoiceId } });

    // Nhà cung cấp gửi lại (retry) 3 lần → vẫn 1 giao dịch, 1 phiếu thu
    for (let i = 0; i < 3; i++) expect((await webhook(body)).body).toEqual({ success: true });
    expect(await txns()).toHaveLength(1);
    expect(await payments(invoiceId)).toHaveLength(1);

    // Nhật ký: phiếu thu do hệ thống ghi (actor null), nguồn BANK_WEBHOOK
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'payment.create', entityId: p!.id } });
    expect(audit?.actorId).toBeNull();
    expect(audit?.after).toMatchObject({ source: 'BANK_AUTO', source_channel: 'BANK_WEBHOOK', bank_transaction_id: tx!.id });

    // Đã trả đủ → không còn QR
    expect((await owner.agent.get(`/api/v1/invoices/${invoiceId}/vietqr`)).status).toBe(422);
  });

  it('thiếu tiền rồi trả nhiều lần: ghi đúng số thực nhận, giữ phần còn nợ', async () => {
    const { invoiceId, code } = await setup();
    await webhook(payload(500000, code));
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '700000', payment_status: 'PARTIAL' });
    await webhook(payload(700000, `${code} lan 2`));
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '0', payment_status: 'PAID' });
    expect((await txns()).map((x) => x.status)).toEqual(['MATCHED', 'MATCHED']);
    expect(await payments(invoiceId)).toHaveLength(2);
  });

  it('thừa tiền: ghi đủ số còn nợ, phần dư chờ đối chiếu; không phân bổ vượt; “Không áp dụng” phần dư có lý do', async () => {
    const { invoiceId, code } = await setup();
    await webhook(payload(1500000, code));
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '0' });
    let [tx] = await txns();
    expect(tx).toMatchObject({ status: 'PENDING_REVIEW', allocated_vnd: '1200000', unallocated_vnd: '300000' });
    expect(tx!.reason).toContain('Trả thừa');
    // Phần dư không thể ghi vào thông báo đã trả đủ (quy tắc thu tiền hiện có)
    const over = await post(`/api/v1/bank-transactions/${tx!.id}/allocate`, { invoice_id: invoiceId, amount_vnd: '300000' });
    expect(over.status).toBe(422);
    expect((await post(`/api/v1/bank-transactions/${tx!.id}/dismiss`, { reason: 'Đã trả lại khách 300.000 tiền mặt' })).status).toBe(200);
    [tx] = await txns();
    expect(tx).toMatchObject({ status: 'MATCHED', dismissed_vnd: '300000', unallocated_vnd: '0', resolution_note: 'Đã trả lại khách 300.000 tiền mặt' });
    // Đã đối chiếu xong → không xử lý lại
    expect((await post(`/api/v1/bank-transactions/${tx!.id}/dismiss`, { reason: 'lần hai' })).status).toBe(422);
  });

  it('thiếu mã / sai mã / nhiều mã → chờ đối chiếu (không đoán theo số tiền); đối chiếu tay tạo phiếu thu BANK_RECONCILE', async () => {
    const { invoiceId, code } = await setup();
    await webhook(payload(1200000, 'NGUYEN VAN A chuyen tien phong'));
    await webhook(payload(1200000, 'TB2026099999 A101'));
    await webhook(payload(1200000, `${code} TB2026099999`));
    const list = await txns();
    expect(list.map((x) => x.status)).toEqual(['PENDING_REVIEW', 'PENDING_REVIEW', 'PENDING_REVIEW']);
    expect(list.map((x) => x.reason)).toEqual(expect.arrayContaining([expect.stringContaining('Không tìm thấy mã'), expect.stringContaining('không khớp'), expect.stringContaining('nhiều mã')]));
    expect(await payments(invoiceId)).toHaveLength(0);

    const noCode = list.find((x) => x.reason?.includes('Không tìm thấy mã'))!;
    const opts = (await owner.agent.get(`/api/v1/bank-transactions/${noCode.id}/options`)).body;
    expect(opts.open_invoices.map((i: { id: string }) => i.id)).toContain(invoiceId);
    const r = await post(`/api/v1/bank-transactions/${noCode.id}/allocate`, { invoice_id: invoiceId, amount_vnd: '1200000' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'MATCHED', unallocated_vnd: '0', resolved_by_name: 'Chủ trọ Demo' });
    const [p] = await payments(invoiceId);
    expect(p).toMatchObject({ source: 'BANK_RECONCILE', created_by_name: 'Chủ trọ Demo', amount_vnd: '1200000' });
    // Giao dịch đã liên kết → không xử lý lại
    expect((await post(`/api/v1/bank-transactions/${noCode.id}/allocate`, { invoice_id: invoiceId, amount_vnd: '1' })).status).toBe(422);
  });

  it('tiền ra, sai tài khoản → không coi là khách thanh toán', async () => {
    const { invoiceId, code } = await setup();
    await webhook(payload(1200000, code, { transferType: 'out' }));
    await webhook(payload(1200000, code, { accountNumber: '9999999999' }));
    const list = await txns();
    expect(list.find((x) => x.direction === 'OUT')).toMatchObject({ status: 'NOT_APPLICABLE' });
    expect(list.find((x) => x.account_number === '9999999999')).toMatchObject({ status: 'PENDING_REVIEW' });
    expect(await payments(invoiceId)).toHaveLength(0);
    // Tiền ra không thể ghi nhận tay là khách trả
    const out = list.find((x) => x.direction === 'OUT')!;
    expect((await post(`/api/v1/bank-transactions/${out.id}/allocate`, { invoice_id: invoiceId, amount_vnd: '1000' })).status).toBe(422);
  });

  it('webhook giả / xác thực sai / payload sai / sai nhà cung cấp → từ chối, không lưu gì', async () => {
    const { code } = await setup();
    expect((await webhook(payload(1200000, code), null)).status).toBe(401);
    expect((await webhook(payload(1200000, code), 'khoa-sai-0123456789')).status).toBe(401);
    expect((await request(t.server).post('/api/v1/bank-webhooks/mock').set('Authorization', `Bearer ${KEY}`).send(payload(1, code))).status).toBe(401);
    expect((await webhook({ ...payload(1200000, code), transferAmount: 'abc' })).status).toBe(400);
    expect((await webhook(payload(1200000, code), KEY, 'sepay')).status).toBe(404);
    expect(await t.prisma.bankTransaction.count()).toBe(0);
  });

  it('webhook trùng gửi đồng thời → một giao dịch, một phiếu thu; hai giao dịch khác nhau đồng thời không phân bổ vượt', async () => {
    const { invoiceId, code } = await setup();
    const same = payload(1200000, code);
    const rs = await Promise.all(Array.from({ length: 5 }, () => webhook(same)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await t.prisma.bankTransaction.count()).toBe(1);
    expect(await payments(invoiceId)).toHaveLength(1);

    const b = await setup();
    await Promise.all([webhook(payload(800000, b.code)), webhook(payload(800000, `${b.code} x`))]);
    const inv = await invoice(b.invoiceId);
    expect(inv).toMatchObject({ settled_vnd: '1200000', remaining_vnd: '0' });
    const mine = (await txns()).filter((x) => x.invoice?.id === b.invoiceId);
    expect(mine.map((x) => x.allocated_vnd).sort()).toEqual(['400000', '800000']);
    expect(mine.find((x) => x.allocated_vnd === '400000')).toMatchObject({ status: 'PENDING_REVIEW', unallocated_vnd: '400000' });
  });

  it('gửi lại sau lỗi: giao dịch ERROR được “Xử lý lại” đúng một lần', async () => {
    const { invoiceId, code } = await setup();
    // Mô phỏng lần xử lý trước bị lỗi giữa chừng (đã lưu nhưng chưa đối chiếu)
    await t.prisma.bankTransaction.create({
      data: {
        workspaceId: (await t.prisma.workspace.findFirstOrThrow()).id,
        provider: 'mock',
        environment: 'MOCK',
        providerTransactionId: '777',
        accountNumber: ACC,
        direction: 'IN',
        amountVnd: 1200000n,
        content: code,
        occurredAt: new Date('2026-10-20T02:00:00Z'),
        source: 'WEBHOOK',
        rawPayload: {},
        status: 'ERROR',
        reason: 'Lỗi khi đối chiếu tự động — bấm “Xử lý lại”.',
      },
    });
    // Nhà cung cấp gửi lại cùng giao dịch: đã có (ERROR) → không ghi trùng, không tự xử lý lại
    await webhook({ ...payload(1200000, code), id: 777 });
    expect(await payments(invoiceId)).toHaveLength(0);
    const [tx] = await txns();
    const r = await post(`/api/v1/bank-transactions/${tx!.id}/retry`, {}, owner, null);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'MATCHED' });
    expect((await post(`/api/v1/bank-transactions/${tx!.id}/retry`, {}, owner, null)).status).toBe(422);
    expect(await payments(invoiceId)).toHaveLength(1);
  });

  it('QR cũ / thông báo đã trả đủ: giao dịch mới vẫn được lưu và vào chờ đối chiếu', async () => {
    const { invoiceId, code } = await setup();
    await webhook(payload(1200000, code));
    await webhook(payload(1200000, code));
    const list = await txns();
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.status === 'PENDING_REVIEW')!.reason).toContain('đã thanh toán đủ');
    expect(await payments(invoiceId)).toHaveLength(1);
  });

  it('ghi nhận chuyển khoản tay trước webhook: cùng mã tham chiếu → chỉ liên kết; khác → chờ đối chiếu, xác nhận thì liên kết, không cộng tiền lần hai', async () => {
    const { tenancyId, invoiceId, code } = await setup();
    const manual = await post('/api/v1/payments', { tenancy_id: tenancyId, amount_vnd: '600000', method: 'QR', paid_at: '2026-10-20', reference: 'FT-ABC-1', allocations: [{ invoice_id: invoiceId, amount_vnd: '600000' }] });
    expect(manual.status).toBe(201);
    await webhook(payload(600000, code, { referenceCode: 'FTABC1' }));
    let [tx] = await txns();
    expect(tx).toMatchObject({ status: 'MATCHED', payments: [{ payment_id: manual.body.id, link: 'LINKED_EXISTING' }] });
    expect(await payments(invoiceId)).toHaveLength(1);
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '600000' });

    const manual2 = await post('/api/v1/payments', { tenancy_id: tenancyId, amount_vnd: '600000', method: 'BANK_TRANSFER', paid_at: '2026-10-20', allocations: [{ invoice_id: invoiceId, amount_vnd: '600000' }] });
    expect(manual2.status).toBe(201);
    await webhook(payload(600000, `${code} con lai`));
    tx = (await txns()).find((x) => x.status === 'PENDING_REVIEW');
    expect(tx!.reason).toContain(manual2.body.number);
    const opts = (await owner.agent.get(`/api/v1/bank-transactions/${tx!.id}/options`)).body;
    expect(opts.unlinked_payments.map((p: { id: string }) => p.id)).toEqual([manual2.body.id]);
    const link = await post(`/api/v1/bank-transactions/${tx!.id}/link-payment`, { payment_id: manual2.body.id });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    expect(link.body).toMatchObject({ status: 'MATCHED', payments: [{ link: 'LINKED_EXISTING' }] });
    expect(await payments(invoiceId)).toHaveLength(2);
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '0' });
    // Phiếu thu đã liên kết không thể gắn vào giao dịch khác
    await webhook(payload(600000, 'khong ma'));
    const other = (await txns()).find((x) => x.status === 'PENDING_REVIEW')!;
    expect((await post(`/api/v1/bank-transactions/${other.id}/link-payment`, { payment_id: manual2.body.id })).status).toBe(422);
  });

  it('đảo phiếu thu tự động → giao dịch quay về chờ đối chiếu; ghi nhận lại được', async () => {
    const { invoiceId, code } = await setup();
    await webhook(payload(1200000, code));
    const [p] = await payments(invoiceId);
    expect((await post(`/api/v1/payments/${p!.id}/reverse`, { reason: 'Ghi nhầm thông báo' })).status).toBe(200);
    const [tx] = await txns();
    expect(tx).toMatchObject({ status: 'PENDING_REVIEW', allocated_vnd: '0', unallocated_vnd: '1200000' });
    expect(tx!.reason).toContain('đã bị đảo');
    expect((await post(`/api/v1/bank-transactions/${tx!.id}/allocate`, { invoice_id: invoiceId, amount_vnd: '1200000' })).status).toBe(200);
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '0' });
  });

  it('webhook bị mất → đồng bộ lấy bù (cùng luồng chống trùng, lưu mốc); công cụ giả lập gửi webhook thật qua HTTP, khóa sai bị từ chối', async () => {
    const { invoiceId, code } = await setup();
    const lost1 = await post('/api/v1/bank-transactions/mock/simulate', { amount_vnd: '500000', content: code, delivery: 'LOST' }, owner, null);
    expect(lost1.status, JSON.stringify(lost1.body)).toBe(201);
    expect(lost1.body).toMatchObject({ delivery: 'LOST', webhook_status: null, transaction: null });
    await post('/api/v1/bank-transactions/mock/simulate', { amount_vnd: '700000', content: `${code} 2`, delivery: 'LOST' }, owner, null);
    expect(await t.prisma.bankTransaction.count()).toBe(0);

    const s1 = await post('/api/v1/bank-transactions/sync', {}, owner, null);
    expect(s1.status, JSON.stringify(s1.body)).toBe(200);
    expect(s1.body).toMatchObject({ fetched: 2, created: 2, duplicates: 0 });
    expect(await invoice(invoiceId)).toMatchObject({ remaining_vnd: '0' });
    expect((await txns()).every((x) => x.source === 'SYNC' && x.status === 'MATCHED')).toBe(true);
    // Chạy lại: mốc đã lưu → không lấy lại
    expect((await post('/api/v1/bank-transactions/sync', {}, owner, null)).body).toMatchObject({ fetched: 0, created: 0 });
    // Xóa mốc (giả lập job lỗi trước khi lưu mốc) → lấy lại nhưng không ghi trùng
    await t.prisma.bankSyncState.updateMany({ data: { lastProviderId: null } });
    expect((await post('/api/v1/bank-transactions/sync', {}, owner, null)).body).toMatchObject({ fetched: 2, created: 0, duplicates: 2 });
    expect(await payments(invoiceId)).toHaveLength(2);

    // Gửi webhook thật qua HTTP tới chính endpoint
    await new Promise<void>((resolve) => t.app.getHttpServer().listen(0, resolve));
    const port = (t.app.getHttpServer().address() as AddressInfo).port;
    t.app.get(BankTransactionsService).mockWebhookUrlOverride = `http://127.0.0.1:${port}/api/v1/bank-webhooks/mock`;
    try {
      const b = await setup('B');
      const bad = await post('/api/v1/bank-transactions/mock/simulate', { amount_vnd: '1200000', content: b.code, delivery: 'BAD_SIGNATURE' }, owner, null);
      expect(bad.body).toMatchObject({ webhook_status: 401, transaction: null });
      const ok = await post('/api/v1/bank-transactions/mock/simulate', { amount_vnd: '1200000', content: b.code }, owner, null);
      expect(ok.body).toMatchObject({ webhook_status: 200, transaction: { status: 'MATCHED' } });
      const again = await post(`/api/v1/bank-transactions/mock/${ok.body.mock_id}/resend`, {}, owner, null);
      expect(again.body).toMatchObject({ webhook_status: 200, transaction: { id: ok.body.transaction.id } });
      expect(await payments(b.invoiceId)).toHaveLength(1);
      // Giao dịch khóa sai vẫn nằm trong ngân hàng giả → đồng bộ lấy bù, chờ đối chiếu vì thông báo đã trả đủ
      const s = await post('/api/v1/bank-transactions/sync', {}, owner, null);
      expect(s.body).toMatchObject({ created: 1 });
    } finally {
      t.app.get(BankTransactionsService).mockWebhookUrlOverride = null;
    }
  });

  it('phân quyền: quản lý mặc định không thấy; được cấp quyền xem chỉ thấy giao dịch khớp tòa được giao; không đối chiếu/giả lập', async () => {
    const a = await setup('A');
    const b = await setup('B');
    await webhook(payload(1200000, a.code));
    await webhook(payload(1200000, b.code));
    await webhook(payload(5000, 'khong co ma'));

    const mgr = await login(t, 'managerA');
    expect((await mgr.agent.get('/api/v1/bank-transactions')).status).toBe(403);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: 'manager.a@example.test' } });
    const perm = await t.prisma.permission.findUniqueOrThrow({ where: { code: 'bank_transactions.view' } });
    const ownerUser = await t.prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } });
    await t.prisma.userPermissionOverride.create({ data: { userId: user.id, permissionId: perm.id, granted: true, createdBy: ownerUser.id } });
    const mgr2 = await login(t, 'managerA');
    const seen = await txns(mgr2);
    expect(seen.map((x) => x.invoice?.id)).toEqual([a.invoiceId]);
    const hidden = (await txns()).find((x) => x.invoice?.id === b.invoiceId)!;
    expect((await mgr2.agent.get(`/api/v1/bank-transactions/${hidden.id}`)).status).toBe(404);
    expect((await post(`/api/v1/bank-transactions/${seen[0]!.id}/dismiss`, { reason: 'thử quyền' }, mgr2)).status).toBe(403);
    expect((await post('/api/v1/bank-transactions/mock/simulate', { amount_vnd: '1', content: 'x' }, mgr2, null)).status).toBe(403);
    expect((await post('/api/v1/bank-transactions/sync', {}, mgr2, null)).status).toBe(403);
  });
});

describe('D-047 — chế độ live: công cụ giả lập bị chặn ở backend', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ config: { BANK_INTEGRATION_MODE: 'live', BANK_PROVIDER: 'sepay', SEPAY_API_TOKEN: 'sepay-token-not-real-000000' } });
    await resetDatabase(t);
  });
  afterAll(() => t.close());

  it('giả lập/gửi lại → 403; webhook mock → 404; webhook sepay vẫn xác thực khóa; cấu hình báo live', async () => {
    const owner = await login(t, 'owner');
    const sim = await owner.agent.post('/api/v1/bank-transactions/mock/simulate').set(CSRF_HEADER, owner.csrf).send({ amount_vnd: '1000', content: 'x' });
    expect(sim.status).toBe(403);
    expect((await owner.agent.post('/api/v1/bank-transactions/mock/1/resend').set(CSRF_HEADER, owner.csrf).send({})).status).toBe(403);
    expect((await request(t.server).post('/api/v1/bank-webhooks/mock').set('Authorization', `Apikey ${KEY}`).send({ id: 1 })).status).toBe(404);
    expect((await request(t.server).post('/api/v1/bank-webhooks/sepay').set('Authorization', 'Apikey sai-khoa-0000000000').send({ id: 1 })).status).toBe(401);
    const cfg = (await owner.agent.get('/api/v1/bank-transactions/config')).body;
    expect(cfg).toMatchObject({ mode: 'live', provider: 'sepay', simulator_enabled: false });
  });
});
