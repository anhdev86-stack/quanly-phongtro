import type { ContractAlertDto, ContractRevisionDto, InvoiceDetail, StatementPeriodDto } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const key = () => `p11-${Date.now()}-${++keySeq}`;

describe('Phase 11 — phụ lục hợp đồng, đóng/mở kỳ (T36), cảnh báo hết hạn', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const post = (url: string, body: unknown, s: Session = owner, idem = false) => {
    const r = s.agent.post(url).set(CSRF_HEADER, s.csrf);
    if (idem) r.set('Idempotency-Key', key());
    return r.send(body as object);
  };
  const get = (url: string, s: Session = owner) => s.agent.get(url);

  async function moveIn(contract: Record<string, unknown> | null = null, building: 'A' | 'B' = 'A') {
    const room = await createRoom(t, { building });
    const res = await post(
      '/api/v1/tenancies/move-in',
      {
        room_id: room.id,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: '3000000',
        primary: { new_tenant: { full_name: 'Khách P11' } },
        contract,
      },
      owner,
      true,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }
  const contractsOf = async (tenancyId: string) => (await get(`/api/v1/tenancies/${tenancyId}/contracts`)).body.items as { id: string; version: number; status: string; term_end: string }[];
  const draftOf = async (tenancyId: string) => (await get(`/api/v1/invoices?tenancy_id=${tenancyId}&lifecycle=DRAFT`)).body.items[0]?.id as string | undefined;
  const invoice = async (id: string): Promise<InvoiceDetail> => (await get(`/api/v1/invoices/${id}`)).body;
  async function publish(id: string) {
    const d = await invoice(id);
    const r = await post(`/api/v1/invoices/${id}/publish`, { expected_version: d.version, source_hash: d.source_hash });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.invoice as InvoiceDetail;
  }
  const periods = async (): Promise<StatementPeriodDto[]> => (await get('/api/v1/statement-periods')).body;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    await at('2026-10-01');
  });
  afterAll(() => t.close());

  it('T36: kỳ CLOSED chặn tạo/tính lại/phát hành/hủy và nhập chỉ số; thu tiền vẫn được; mở lại cần quyền và lý do', async () => {
    const tn = await moveIn();
    const draft = (await draftOf(tn))!;
    await at('2026-11-02');
    let oct = (await periods()).find((p) => p.period === '2026-10')!;
    // Còn nháp → không đóng được; tháng hiện tại không đóng được
    expect((await post(`/api/v1/statement-periods/${oct.id}/close`, { expected_version: oct.version })).status).toBe(422);
    const inv = await publish(draft);
    oct = (await periods()).find((p) => p.period === '2026-10')!;
    // Kế toán tòa B có quyền phát hành nhưng không có phạm vi mọi tòa → 403
    const acc = await login(t, 'accountantB');
    expect((await post(`/api/v1/statement-periods/${oct.id}/close`, { expected_version: oct.version }, acc)).status).toBe(403);
    expect((await post(`/api/v1/statement-periods/${oct.id}/close`, { expected_version: 99 })).status).toBe(409);
    const closed = await post(`/api/v1/statement-periods/${oct.id}/close`, { expected_version: oct.version });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', closed_by_name: 'Chủ trọ Demo' });

    // Bị chặn: tạo thông báo tháng 10, hủy thông báo đã phát hành của tháng 10, nhập chỉ số kỳ 10
    // Nhận phòng lùi ngày vào tháng 10 (sẽ tạo thông báo tháng 10) → bị chặn, không tạo gì
    const room = await createRoom(t);
    const late = await post(
      '/api/v1/tenancies/move-in',
      { room_id: room.id, start_date: '2026-10-20', monthly_rent_vnd: '3000000', deposit_required_vnd: '0', primary: { new_tenant: { full_name: 'Khách lùi ngày' } } },
      owner,
      true,
    );
    expect(late.status, JSON.stringify(late.body)).toBe(422);
    expect(late.body.message).toContain('10/2026 đã đóng');
    expect(await t.prisma.tenancy.count({ where: { roomId: room.id } })).toBe(0);
    const d = await invoice(inv.id);
    const cancel = await post(`/api/v1/invoices/${inv.id}/cancel`, { reason: 'Thử hủy', expected_version: d.version });
    expect(cancel.status).toBe(422);
    expect(cancel.body.message).toContain('đã đóng');
    const sheet = await post('/api/v1/meter-readings', { period: '2026-10', read_on: '2026-10-31', items: [] });
    expect([400, 422]).toContain(sheet.status);
    // Không bị chặn: thu tiền vào thông báo tháng 10 (đã đóng)
    const pay = await post('/api/v1/payments', { tenancy_id: tn, amount_vnd: '1000000', method: 'CASH', paid_at: '2026-11-02', allocations: [{ invoice_id: inv.id, amount_vnd: '1000000' }] }, owner, true);
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);

    // Mở lại: kế toán không có period.reopen → 403; thiếu lý do → 400; chủ trọ có lý do → mở, có audit
    const now = (await periods()).find((p) => p.period === '2026-10')!;
    expect((await post(`/api/v1/statement-periods/${now.id}/reopen`, { reason: 'Sửa sai', expected_version: now.version }, acc)).status).toBe(403);
    expect((await post(`/api/v1/statement-periods/${now.id}/reopen`, { expected_version: now.version })).status).toBe(400);
    const reopened = await post(`/api/v1/statement-periods/${now.id}/reopen`, { reason: 'Nhập sai chỉ số điện cần sửa', expected_version: now.version });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(reopened.body).toMatchObject({ status: 'OPEN', reopen_reason: 'Nhập sai chỉ số điện cần sửa' });
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'billing.period_reopen' } });
    expect(audit?.reason).toBe('Nhập sai chỉ số điện cần sửa');
    // Sau khi mở lại, thao tác bình thường trở lại (ở đây: thông báo tháng 10 đã có → EXISTS)
    expect((await post('/api/v1/billing/generate', { period: '2026-10', tenancy_ids: [tn] })).body.items[0].status).toBe('EXISTS');
  });

  it('phụ lục: đổi giá từ ngày hiệu lực (có source_contract_id), gia hạn ngày kết thúc, mức cọc áp từ ngày hiệu lực; chặn sai trạng thái', async () => {
    const tn = await moveIn({ term_start: '2026-10-01', term_end: '2027-03-31', signed: true, notice_days: 30 });
    const [c] = await contractsOf(tn);
    const revise = (body: Record<string, unknown>) => post(`/api/v1/contracts/${c!.id}/revisions`, { expected_version: c!.version, ...body });
    // Phải đổi ít nhất một điều khoản; ngày hiệu lực trong thời hạn
    expect((await revise({ effective_from: '2026-12-01', reason: 'Không đổi gì' })).status).toBe(400);
    expect((await revise({ effective_from: '2027-05-01', monthly_rent_vnd: '3200000', reason: 'Ngoài hạn' })).status).toBe(400);
    // Giữa tháng cần xác nhận
    expect((await revise({ effective_from: '2026-12-15', monthly_rent_vnd: '3200000', reason: 'Tăng giá' })).status).toBe(422);

    const r1 = await revise({ effective_from: '2027-01-01', monthly_rent_vnd: '3200000', deposit_required_vnd: '3200000', term_end: '2027-09-30', reason: 'Gia hạn và tăng giá theo thỏa thuận' });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const rev: ContractRevisionDto = r1.body;
    expect(rev).toMatchObject({ revision_no: 1, effective_from: '2027-01-01', term_end_before: '2027-03-31', term_end_after: '2027-09-30', changes: { monthly_rent_vnd: '3200000' } });
    const after = (await contractsOf(tn))[0]!;
    expect(after).toMatchObject({ term_end: '2027-09-30' });
    // Giá mới có nguồn là hợp đồng
    const prices = (await get(`/api/v1/tenancies/${tn}/rent-prices`)).body as { effective_from: string; monthly_rent_vnd: string; source_contract_id: string | null }[];
    expect(prices.find((p) => p.effective_from === '2027-01-01')).toMatchObject({ monthly_rent_vnd: '3200000', source_contract_id: c!.id });
    // Mức cọc yêu cầu: trước ngày hiệu lực vẫn 3.000.000, từ ngày hiệu lực 3.200.000
    expect((await get(`/api/v1/tenancies/${tn}`)).body.deposit.required_vnd).toBe('3000000');
    await at('2027-01-02');
    expect((await get(`/api/v1/tenancies/${tn}`)).body.deposit.required_vnd).toBe('3200000');
    // Sai version → 409; phụ lục thứ hai đánh số 2
    expect((await revise({ effective_from: '2027-02-01', notice_days: 45, reason: 'Đổi báo trước' })).status).toBe(409);
    const r2 = await post(`/api/v1/contracts/${c!.id}/revisions`, { expected_version: after.version, effective_from: '2027-02-01', notice_days: 45, reason: 'Đổi số ngày báo trước' });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.body.revision_no).toBe(2);
    expect((await get(`/api/v1/contracts/${c!.id}/revisions`)).body.map((x: ContractRevisionDto) => x.revision_no)).toEqual([1, 2]);
    // Ngày kết thúc mới không được trước hôm nay
    const v = (await contractsOf(tn))[0]!.version;
    expect((await post(`/api/v1/contracts/${c!.id}/revisions`, { expected_version: v, effective_from: '2027-01-02', term_end: '2027-01-01', reason: 'Rút ngắn' })).status).toBe(400);
    // Phụ lục không áp cho hợp đồng nháp
    const draft = await post(`/api/v1/tenancies/${tn}/contracts/renew`, { term_start: '2027-10-01', term_end: '2028-03-31' });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect((await post(`/api/v1/contracts/${draft.body.id}/revisions`, { expected_version: draft.body.version, effective_from: '2027-10-01', notice_days: 10, reason: 'Đổi báo trước' })).status).toBe(422);
    // Kéo dài đè lên kỳ đã ký kế tiếp → 409 (EXCLUDE)
    const signedNext = await post(`/api/v1/contracts/${draft.body.id}/sign`, { signed_at: '2027-01-02', expected_version: draft.body.version });
    expect(signedNext.status, JSON.stringify(signedNext.body)).toBe(200);
    const v2 = (await contractsOf(tn)).find((x) => x.id === c!.id)!.version;
    expect((await post(`/api/v1/contracts/${c!.id}/revisions`, { expected_version: v2, effective_from: '2027-02-01', term_end: '2027-12-31', reason: 'Kéo dài' })).status).toBe(409);
  });

  it('phụ lục của hợp đồng chưa bắt đầu bị vô hiệu hóa cùng khi hủy hợp đồng', async () => {
    const tn = await moveIn();
    const c = await post(`/api/v1/tenancies/${tn}/contracts`, { term_start: '2026-12-01', term_end: '2027-05-31', signed: true, signed_at: '2026-10-01' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const rev = await post(`/api/v1/contracts/${c.body.id}/revisions`, { expected_version: c.body.version, effective_from: '2027-01-01', monthly_rent_vnd: '3500000', reason: 'Tăng giá' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    const cur = (await contractsOf(tn))[0]!;
    const cancel = await post(`/api/v1/contracts/${c.body.id}/cancel`, { reason: 'Khách đổi ý', expected_version: cur.version });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.voided_rent_price_ids.length).toBe(1);
    const prices = (await get(`/api/v1/tenancies/${tn}/rent-prices`)).body as { effective_from: string; status: string }[];
    expect(prices.find((p) => p.effective_from === '2027-01-01')!.status).toBe('VOIDED');
  });

  it('cảnh báo hết hạn 30/15/7 ngày: không tạo trùng khi đọc song song; chỉ hiện mốc mới nhất; xác nhận; gia hạn thì hết cảnh báo', async () => {
    const tn = await moveIn({ term_start: '2026-10-01', term_end: '2027-03-31', signed: true });
    const other = await moveIn({ term_start: '2026-10-01', term_end: '2027-12-31', signed: true }, 'B');
    const list = async (q = '', s: Session = owner): Promise<ContractAlertDto[]> => (await get(`/api/v1/contract-alerts?page_size=100${q}`, s)).body.items;

    await at('2027-02-20'); // còn 39 ngày: chưa tới mốc
    expect(await list()).toEqual([]);
    await at('2027-03-05'); // còn 26 ngày → mốc 30
    const many = await Promise.all([list(), list(), list(), list()]);
    expect(many.every((x) => x.length === 1)).toBe(true);
    expect(await t.prisma.contractAlert.count()).toBe(1);
    expect(many[0]![0]).toMatchObject({ milestone_days: 30, days_to_expiry: 26, term_end: '2027-03-31', renewed: false });
    // Nhân viên tòa B không thấy cảnh báo tòa A
    expect(await list('', await login(t, 'staffBC'))).toEqual([]);

    await at('2027-03-20'); // còn 11 ngày → mốc 15; danh sách chỉ hiện mốc mới nhất
    const l2 = await list();
    expect(l2.map((a) => a.milestone_days)).toEqual([15]);
    expect(await t.prisma.contractAlert.count()).toBe(2);
    const ack = await post(`/api/v1/contract-alerts/${l2[0]!.id}/ack`, {});
    expect(ack.status).toBe(200);
    expect(ack.body).toMatchObject({ acknowledged_by_name: 'Chủ trọ Demo' });
    expect(await list()).toEqual([]);
    expect((await list('&include_acknowledged=true')).length).toBe(2);

    await at('2027-03-25'); // còn 6 ngày → mốc 7; gia hạn → không còn cảnh báo
    expect((await list()).map((a) => a.milestone_days)).toEqual([7]);
    const renew = await post(`/api/v1/tenancies/${tn}/contracts/renew`, { term_start: '2027-04-01', term_end: '2027-09-30', signed: true, signed_at: '2027-03-25' });
    expect(renew.status, JSON.stringify(renew.body)).toBe(201);
    expect(await list()).toEqual([]);
    void other;
  });
});
