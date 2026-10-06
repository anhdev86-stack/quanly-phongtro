import type { InvoiceDetail, SettlementDto, SettlementPreview } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { createRoom, ownerId, serviceId } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const key = () => `st-${Date.now()}-${++keySeq}`;
const A = SEED_IDS.buildings.A;

describe('Phase 7 — trả phòng và quyết toán', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const post = (url: string, body: unknown, idem: string | null = null, s: Session = owner) => {
    const r = s.agent.post(url).set(CSRF_HEADER, s.csrf);
    if (idem) r.set('Idempotency-Key', idem);
    return r.send(body as object);
  };
  const invoice = async (id: string): Promise<InvoiceDetail> => (await owner.agent.get(`/api/v1/invoices/${id}`)).body;
  const settlement = async (id: string): Promise<SettlementDto> => (await owner.agent.get(`/api/v1/settlements/${id}`)).body;

  async function prices(extra: { code: string; price: string }[] = []) {
    const by = await ownerId(t);
    const data: { serviceId: string; buildingId: string | null; unitPrice: string }[] = [
      { serviceId: await serviceId(t, 'ELEC'), buildingId: A, unitPrice: '4000' },
      { serviceId: await serviceId(t, 'WATER'), buildingId: A, unitPrice: '20000' },
    ];
    for (const e of extra) data.push({ serviceId: (await t.prisma.service.findFirstOrThrow({ where: { code: e.code } })).id, buildingId: null, unitPrice: e.price });
    await t.prisma.servicePriceHistory.createMany({ data: data.map((d) => ({ ...d, workspaceId: SEED_IDS.workspace, effectiveFrom: new Date('2026-01-01'), createdBy: by })) });
  }

  async function moveIn(start: string, deposit: string, extra: Record<string, unknown> = {}) {
    const room = await createRoom(t);
    const res = await post(
      '/api/v1/tenancies/move-in',
      {
        room_id: room.id,
        start_date: start,
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: deposit,
        ...(deposit !== '0' ? { deposit_received: { amount_vnd: deposit, method: 'CASH', paid_at: start } } : {}),
        primary: { new_tenant: { full_name: 'Khách Trả Phòng' } },
        meter_readings: [
          { type: 'ELECTRICITY', value: '1000' },
          { type: 'WATER', value: '100' },
        ],
        ...extra,
      },
      key(),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { roomId: room.id, tenancyId: res.body.id as string };
  }

  async function publishDraft(tenancyId: string) {
    const list = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${tenancyId}&lifecycle=DRAFT`)).body;
    const d = await invoice(list.items[0].id);
    const r = await post(`/api/v1/invoices/${d.id}/publish`, { expected_version: d.version, source_hash: d.source_hash });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.invoice as InvoiceDetail;
  }

  async function readings(roomId: string, period: string, readOn: string, elec: string, water?: string) {
    const meters = await t.prisma.meter.findMany({ where: { roomId, retiredOn: null } });
    const items = meters.filter((m) => m.type === 'ELECTRICITY' || water).map((m) => ({ meter_id: m.id, value: m.type === 'ELECTRICITY' ? elec : water! }));
    const r = await post('/api/v1/meter-readings', { period, read_on: readOn, items });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }

  async function monthly(tenancyId: string, period: string) {
    const g = await post('/api/v1/billing/generate', { period, tenancy_ids: [tenancyId] });
    const item = g.body.items[0];
    expect(item.errors, JSON.stringify(item.errors)).toEqual([]);
    return item.invoice_id as string;
  }

  async function publish(id: string) {
    const d = await invoice(id);
    const r = await post(`/api/v1/invoices/${id}/publish`, { expected_version: d.version, source_hash: d.source_hash });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.invoice as InvoiceDetail;
  }

  const pay = (tenancyId: string, invoiceId: string, amount: string, paidAt: string) =>
    post('/api/v1/payments', { tenancy_id: tenancyId, amount_vnd: amount, method: 'CASH', paid_at: paidAt, allocations: [{ invoice_id: invoiceId, amount_vnd: amount }] }, key());

  async function finals(roomId: string, elec: string, water?: string) {
    const meters = await t.prisma.meter.findMany({ where: { roomId, retiredOn: null } });
    return meters.filter((m) => m.type === 'ELECTRICITY' || water).map((m) => ({ meter_id: m.id, value: m.type === 'ELECTRICITY' ? elec : water! }));
  }

  async function startSettlement(tenancyId: string, body: Record<string, unknown>) {
    const r = await post(`/api/v1/tenancies/${tenancyId}/move-out-settlements`, {
      destination_room_status: 'READY',
      inventory_note: 'Đủ tài sản theo biên bản nhận phòng',
      handover_by: 'Chủ trọ',
      ...body,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as SettlementDto;
  }

  async function approveAndComplete(id: string) {
    const pv: SettlementPreview = (await post(`/api/v1/settlements/${id}/preview`, {})).body;
    expect(pv.blocking).toEqual([]);
    const s = await settlement(id);
    const ap = await post(`/api/v1/settlements/${id}/approve`, { expected_version: s.version, input_hash: pv.input_hash });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const k = key();
    const done = await post(`/api/v1/settlements/${id}/complete`, { expected_version: ap.body.version }, k);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return { pv, done: done.body as SettlementDto, key: k, version: ap.body.version as number };
  }

  /** Ví dụ 1/2 dùng chung: thuê từ 01/10, tháng 10 và 11 đã phát hành (điện nước tháng 10: 100 kWh + nước). */
  async function scenario(deposit: string, novWater: string) {
    await prices();
    const r = await moveIn('2026-10-01', deposit);
    const oct = await publishDraft(r.tenancyId);
    await at('2026-10-31');
    await readings(r.roomId, '2026-11', '2026-10-31', '1100', novWater);
    await at('2026-11-01');
    const nov = await publish(await monthly(r.tenancyId, '2026-11'));
    return { ...r, oct, nov };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    await at('2026-10-01');
  });
  afterAll(() => t.close());

  it('Ví dụ 1 (T23, T27, T25): đủ cọc, đã trả tháng 11 → credit 1.000.000 cấn 820.000, hoàn 180.000 + cọc 3.000.000 ghi riêng', async () => {
    const { roomId, tenancyId, oct, nov } = await scenario('3000000', '106');
    expect(nov.total_vnd).toBe('3520000');
    await pay(tenancyId, oct.id, oct.total_vnd, '2026-10-01');
    await pay(tenancyId, nov.id, '3520000', '2026-11-01');
    await at('2026-11-20');
    const tn = (await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body;
    expect((await post(`/api/v1/tenancies/${tenancyId}/move-out-notices`, { notice_date: '2026-11-20', planned_last_charge_date: '2026-11-20', expected_version: tn.version })).status).toBe(201);
    const s = await startSettlement(tenancyId, {
      last_charge_date: '2026-11-20',
      final_readings: await finals(roomId, '1200', '112'),
      charges: [{ kind: 'DAMAGE', amount_vnd: '300000', reason: 'Vỡ kính cửa sổ' }],
    });
    expect((await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body.status).toBe('MOVE_OUT_PROCESSING');
    const pv: SettlementPreview = (await post(`/api/v1/settlements/${s.id}/preview`, {})).body;
    expect(pv).toMatchObject({
      final_debit_vnd: '820000',
      final_credit_vnd: '1000000',
      debt_vnd: '820000',
      credit_vnd: '1000000',
      credit_applied_vnd: '820000',
      deposit_available_vnd: '3000000',
      deposit_applied_vnd: '0',
      customer_receivable_vnd: '0',
      credit_refund_payable_vnd: '180000',
      deposit_refund_payable_vnd: '3000000',
    });
    expect(pv.warnings.some((w) => w.includes('Báo trước 1 ngày'))).toBe(true);
    const { done } = await approveAndComplete(s.id);
    expect(done).toMatchObject({ status: 'COMPLETED', current: { financial_status: 'REFUND_PAYABLE', credit_refund_payable_vnd: '180000', deposit_refund_payable_vnd: '3000000', receivable_vnd: '0' } });
    const fin = await invoice(done.final_invoice_id!);
    expect(fin).toMatchObject({ type: 'FINAL', total_vnd: '820000', remaining_vnd: '0', payment_status: 'PAID' });
    expect((await invoice(done.credit_invoice_id!)).total_vnd).toBe('1000000');
    expect((await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body).toMatchObject({ status: 'ENDED', last_charge_date: '2026-11-20' });
    expect((await owner.agent.get(`/api/v1/rooms/${roomId}`)).body.display_status).toBe('AVAILABLE');
    // T25: chưa chi thì nghĩa vụ hoàn vẫn còn, không có REFUND giả
    expect(await t.prisma.depositTransaction.count({ where: { tenancyId, type: 'REFUND' } })).toBe(0);
    await at('2026-11-21');
    expect((await post(`/api/v1/settlements/${s.id}/credit-refunds`, { amount_vnd: '180000', paid_at: '2026-11-21', method: 'CASH' }, key())).status).toBe(201);
    const after = (await post(`/api/v1/settlements/${s.id}/deposit-refunds`, { amount_vnd: '3000000', paid_at: '2026-11-21', method: 'BANK_TRANSFER', reference: 'CK hoàn cọc' }, key())).body;
    expect(after.current).toMatchObject({ financial_status: 'BALANCED', deposit_refund_payable_vnd: '0', credit_refund_payable_vnd: '0' });
    expect(after.transactions.map((x: { kind: string }) => x.kind).sort()).toEqual(['CREDIT_APPLICATION', 'CREDIT_REFUND', 'DEPOSIT_REFUND']);
  });

  it('Ví dụ 2 (T24, T51, T52): thiếu cọc → khách còn nợ 2.320.000; đảo áp cọc/đảo phiếu thu sau quyết toán ghi sự kiện, snapshot không đổi', async () => {
    const { roomId, tenancyId, oct, nov } = await scenario('2000000', '105');
    expect(nov.total_vnd).toBe('3500000');
    const p = (await pay(tenancyId, oct.id, '2000000', '2026-10-05')).body;
    await at('2026-11-20');
    const s = await startSettlement(tenancyId, {
      last_charge_date: '2026-11-20',
      final_readings: await finals(roomId, '1200', '111'),
      charges: [{ kind: 'DAMAGE', amount_vnd: '300000', reason: 'Hư bồn rửa' }],
    });
    const { pv, done } = await approveAndComplete(s.id);
    expect(pv).toMatchObject({ debt_vnd: '5320000', credit_applied_vnd: '1000000', deposit_applied_vnd: '2000000', customer_receivable_vnd: '2320000', deposit_refund_payable_vnd: '0' });
    expect(done.current).toMatchObject({ financial_status: 'RECEIVABLE', receivable_vnd: '2320000' });
    expect((await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body.status).toBe('ENDED');
    const debts = (await owner.agent.get('/api/v1/debts')).body;
    expect(debts.items).toEqual([expect.objectContaining({ tenancy_id: tenancyId, tenancy_status: 'ENDED', debt_vnd: '2320000' })]);

    // T51: đảo áp cọc → nợ tăng lại đúng 2.000.000, cọc quay lại; không đảo hai lần
    const applied = await t.prisma.depositTransaction.findFirstOrThrow({ where: { tenancyId, type: 'APPLIED_TO_INVOICE' } });
    expect((await post(`/api/v1/deposit-transactions/${applied.id}/reverse`, { reason: 'Áp nhầm' }, key())).status).toBe(201);
    expect((await settlement(s.id)).current.receivable_vnd).toBe('4320000');
    expect((await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body.deposit.held_vnd).toBe('2000000');
    expect([409, 422]).toContain((await post(`/api/v1/deposit-transactions/${applied.id}/reverse`, { reason: 'Lần hai' }, key())).status);

    // T52: đảo phiếu thu cũ sau COMPLETED → nợ quay lại thông báo gốc, không tạo chứng từ mới
    const before = await t.prisma.invoice.count({ where: { tenancyId } });
    expect((await post(`/api/v1/payments/${p.id}/reverse`, { reason: 'Séc bị trả lại' }, key())).status).toBe(200);
    expect((await invoice(oct.id)).remaining_vnd).toBe('2000000');
    expect(await t.prisma.invoice.count({ where: { tenancyId } })).toBe(before);
    const now = await settlement(s.id);
    expect(now.current.receivable_vnd).toBe('6320000');
    expect(now.events.map((e) => e.kind)).toEqual(['DEPOSIT_TX_REVERSED', 'PAYMENT_REVERSED']);
    expect(now.approved_snapshot).toMatchObject({ customer_receivable_vnd: '2320000', debt_vnd: '5320000' });
    // Thu nợ sau quyết toán
    expect((await post(`/api/v1/settlements/${s.id}/receipts`, { amount_vnd: '6320000', paid_at: '2026-11-20', method: 'CASH' }, key())).status).toBe(201);
    expect((await settlement(s.id)).current.financial_status).toBe('REFUND_PAYABLE');
  });

  it('Ví dụ 3 (T53): tháng hiện tại chưa phát hành → FINAL bù mọi khoản (3.436.667), hủy nháp tháng 11, cọc áp hết, khách nợ 436.667', async () => {
    const by = await ownerId(t);
    const wifi = await t.prisma.service.create({ data: { workspaceId: SEED_IDS.workspace, code: 'WIFI', name: 'Wifi', type: 'FIXED_ROOM', unit: 'phòng/tháng', chargeTiming: 'ARREARS' } });
    await t.prisma.servicePriceHistory.createMany({
      data: [
        { workspaceId: SEED_IDS.workspace, serviceId: await serviceId(t, 'ELEC'), buildingId: A, effectiveFrom: new Date('2026-01-01'), unitPrice: '5000', createdBy: by },
        { workspaceId: SEED_IDS.workspace, serviceId: await serviceId(t, 'TRASH'), buildingId: null, effectiveFrom: new Date('2026-01-01'), unitPrice: '30000', createdBy: by },
        { workspaceId: SEED_IDS.workspace, serviceId: wifi.id, buildingId: null, effectiveFrom: new Date('2026-01-01'), unitPrice: '100000', createdBy: by },
      ],
    });
    // Dời ví dụ sang 02–04/2027 (tháng 4 cũng 30 ngày): đồng hồ giả không lùi trước giờ thật của máy chạy test.
    await at('2027-02-01');
    const { roomId, tenancyId } = await moveIn('2027-02-01', '3000000', {
      meter_readings: [{ type: 'ELECTRICITY', value: '1000' }],
      services: [
        { service_id: await serviceId(t, 'TRASH'), quantity: '1' },
        { service_id: wifi.id, quantity: '1' },
      ],
    });
    const feb = await publishDraft(tenancyId);
    expect(feb.total_vnd).toBe('3030000');
    await pay(tenancyId, feb.id, feb.total_vnd, '2027-02-01');
    await at('2027-02-28');
    await readings(roomId, '2027-03', '2027-02-28', '1050');
    await at('2027-03-01');
    const mar = await publish(await monthly(tenancyId, '2027-03'));
    expect(mar.total_vnd).toBe(String(3000000 + 30000 + 100000 + 250000));
    await pay(tenancyId, mar.id, mar.total_vnd, '2027-03-01');
    await at('2027-03-31');
    await readings(roomId, '2027-04', '2027-03-31', '1150');
    await at('2027-04-01');
    const aprDraft = await monthly(tenancyId, '2027-04');
    await at('2027-04-20');
    const s = await startSettlement(tenancyId, { last_charge_date: '2027-04-20', final_readings: await finals(roomId, '1240'), charges: [{ kind: 'DAMAGE', amount_vnd: '300000', reason: 'Hỏng khóa cửa' }] });
    const pv: SettlementPreview = (await post(`/api/v1/settlements/${s.id}/preview`, {})).body;
    expect(pv.final_lines.map((l) => [l.label, l.amount_vnd])).toEqual([
      ['Tiền phòng 01/04–20/04/2027', '2000000'],
      ['Rác, vệ sinh 01/04–20/04/2027 (1 phòng/tháng)', '20000'],
      ['Phí kỳ trước chưa lập — Wifi 01/03–31/03/2027 (1 phòng/tháng)', '100000'],
      ['Wifi 01/04–20/04/2027 (1 phòng/tháng)', '66667'],
      ['Điện 28/02–31/03/2027: 1050 → 1150 = 100 kWh', '500000'],
      ['Điện 31/03–20/04/2027: 1150 → 1240 = 90 kWh', '450000'],
      ['Hư hỏng: Hỏng khóa cửa', '300000'],
    ]);
    expect(pv).toMatchObject({ final_debit_vnd: '3436667', final_credit_vnd: '0', deposit_applied_vnd: '3000000', customer_receivable_vnd: '436667', deposit_refund_payable_vnd: '0', credit_refund_payable_vnd: '0' });
    expect(pv.drafts_to_cancel.map((d) => d.id)).toEqual([aprDraft]);
    const { done } = await approveAndComplete(s.id);
    expect((await invoice(aprDraft)).lifecycle).toBe('CANCELLED');
    expect(done.current).toMatchObject({ financial_status: 'RECEIVABLE', receivable_vnd: '436667' });
    expect(done.credit_invoice_id).toBeNull();
    // Không tính phí sau ngày cuối; không nhân đôi
    const pv2 = (await post('/api/v1/billing/preview', { period: '2027-05', tenancy_ids: [tenancyId] })).body;
    expect(pv2.items).toEqual([]);
  });

  it('T28/T26/T33: thu tiền sau khi duyệt → hoàn tất 409 STALE; duyệt lại rồi hoàn tất; gọi lại cùng key trả kết quả cũ, không áp cọc hai lần', async () => {
    const { roomId, tenancyId, nov } = await scenario('2000000', '105');
    await at('2026-11-20');
    const s = await startSettlement(tenancyId, { last_charge_date: '2026-11-20', final_readings: await finals(roomId, '1200', '111') });
    const pv: SettlementPreview = (await post(`/api/v1/settlements/${s.id}/preview`, {})).body;
    const ap = (await post(`/api/v1/settlements/${s.id}/approve`, { expected_version: s.version, input_hash: pv.input_hash })).body;
    await pay(tenancyId, nov.id, '500000', '2026-11-20');
    const stale = await post(`/api/v1/settlements/${s.id}/complete`, { expected_version: ap.version }, key());
    expect([stale.status, stale.body.code]).toEqual([409, 'STALE']);
    // Sửa (đưa về nháp), xem trước, duyệt lại
    const cur = await settlement(s.id);
    const put = await owner.agent
      .put(`/api/v1/settlements/${s.id}`)
      .set(CSRF_HEADER, owner.csrf)
      .send({ last_charge_date: '2026-11-20', destination_room_status: 'READY', inventory_note: 'Đủ', final_readings: await finals(roomId, '1200', '111'), expected_version: cur.version });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const { done, key: k, version } = await approveAndComplete(s.id);
    const again = await post(`/api/v1/settlements/${s.id}/complete`, { expected_version: version }, k);
    expect(again.status).toBe(200);
    expect(again.body.final_invoice_id).toBe(done.final_invoice_id);
    expect(await t.prisma.depositTransaction.count({ where: { tenancyId, type: 'APPLIED_TO_INVOICE' } })).toBe(1);
    expect(await t.prisma.invoice.count({ where: { tenancyId, type: 'FINAL' } })).toBe(1);
    expect((await post(`/api/v1/settlements/${s.id}/complete`, { expected_version: version }, key())).status).toBe(422);
  });

  it('T44/T20: hợp đồng gia hạn đã ký chưa bắt đầu chặn duyệt đến khi hủy có lý do; trả trước hạn có cảnh báo, không tự tịch thu cọc', async () => {
    await prices();
    const { roomId, tenancyId } = await moveIn('2026-10-01', '3000000', { contract: { term_start: '2026-10-01', term_end: '2027-03-31', signed: true } });
    const renew = await post(`/api/v1/tenancies/${tenancyId}/contracts/renew`, { term_start: '2027-04-01', term_end: '2027-09-30', signed: true, signed_at: '2026-10-01' });
    await at('2026-10-20');
    const s = await startSettlement(tenancyId, { last_charge_date: '2026-10-20', final_readings: await finals(roomId, '1050', '103') });
    const pv: SettlementPreview = (await post(`/api/v1/settlements/${s.id}/preview`, {})).body;
    expect(pv.blocking.map((b) => b.code)).toEqual(['UNSTARTED_CONTRACT']);
    expect(pv.unstarted_contracts.map((c) => c.id)).toEqual([renew.body.id]);
    expect(pv.warnings.some((w) => w.includes('Trả trước hạn hợp đồng'))).toBe(true);
    expect((await post(`/api/v1/settlements/${s.id}/approve`, { expected_version: s.version, input_hash: pv.input_hash })).status).toBe(422);
    expect((await post(`/api/v1/contracts/${renew.body.id}/cancel`, { reason: 'Khách trả phòng', expected_version: renew.body.version })).status).toBe(200);
    const { done, pv: pv2 } = await approveAndComplete(s.id);
    expect(pv2.deposit_applied_vnd).toBe(pv2.deposit_max_vnd);
    expect(done.status).toBe('COMPLETED');
    // Không có khấu trừ cọc tự động
    expect(await t.prisma.depositTransaction.count({ where: { tenancyId, type: 'DEDUCTION' } })).toBe(0);
    const contract = await t.prisma.contract.findFirstOrThrow({ where: { tenancyId, termStart: new Date('2026-10-01') } });
    expect(contract.terminatedOn?.toISOString().slice(0, 10)).toBe('2026-10-21');
  });

  it('T21/T22/T55: báo trả rồi hủy → vẫn đang thuê, tính phí không dừng; giữ phòng sau ngày trả hợp lệ, hủy báo trả → “xung đột lịch”', async () => {
    await prices();
    const { roomId, tenancyId } = await moveIn('2026-10-01', '0');
    await publishDraft(tenancyId);
    await at('2026-10-10');
    const tn = (await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body;
    const n = await post(`/api/v1/tenancies/${tenancyId}/move-out-notices`, { notice_date: '2026-10-10', planned_last_charge_date: '2026-10-31', expected_version: tn.version });
    expect(n.status).toBe(201);
    expect((await owner.agent.get(`/api/v1/rooms/${roomId}`)).body.display_status).toBe('OCCUPIED');
    // Giữ chỗ trong thời gian khách cũ còn ở bị chặn; sau ngày trả thì được
    const base = { room_id: roomId, contact_name: 'Khách mới', expected_move_in: '2026-11-02', hold_until: '2026-11-05' };
    expect((await post('/api/v1/reservations', { ...base, hold_from: '2026-10-31' })).status).toBe(422);
    const res = await post('/api/v1/reservations', { ...base, hold_from: '2026-11-01' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await owner.agent.get(`/api/v1/reservations/${res.body.id}`)).body.schedule_conflict).toBe(false);
    expect((await post(`/api/v1/move-out-notices/${n.body[0].id}/cancel`, { reason: 'Khách ở tiếp' })).status).toBe(200);
    expect((await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body.status).toBe('ACTIVE');
    expect((await owner.agent.get(`/api/v1/reservations/${res.body.id}`)).body).toMatchObject({ status: 'ACTIVE', schedule_conflict: true });
    // T22: quá ngày dự kiến mà chưa bàn giao vẫn sinh phí tháng sau
    await at('2026-10-31');
    await readings(roomId, '2026-11', '2026-10-31', '1100', '105');
    await at('2026-11-01');
    expect((await post('/api/v1/billing/generate', { period: '2026-11', tenancy_ids: [tenancyId] })).body.items[0].status).toBe('CREATED');
  });

  it('T11/T30/T31: nhận và trả cùng ngày tính 1 ngày; phòng bảo trì chặn nhận khách; khách mới không nhận nợ/cọc/tiêu thụ cũ', async () => {
    await prices();
    await at('2026-11-20');
    const { roomId, tenancyId } = await moveIn('2026-11-20', '1000000');
    // Nhận và trả trong ngày: chỉ số cuối trùng ngày chỉ số nhận phòng nên dùng lý do miễn.
    const s = await startSettlement(tenancyId, { last_charge_date: '2026-11-20', destination_room_status: 'MAINTENANCE', final_reading_waiver: 'Nhận và trả trong cùng ngày, chỉ số không đổi' });
    const pv: SettlementPreview = (await post(`/api/v1/settlements/${s.id}/preview`, {})).body;
    expect(pv.final_lines.find((l) => l.charge_kind === 'RENT')).toMatchObject({ label: 'Tiền phòng 20/11–20/11/2026', amount_vnd: '100000' });
    await approveAndComplete(s.id);
    expect((await owner.agent.get(`/api/v1/rooms/${roomId}`)).body.display_status).toBe('MAINTENANCE');
    const room = (await owner.agent.get(`/api/v1/rooms/${roomId}`)).body;
    const blocked = await post('/api/v1/tenancies/move-in', { room_id: roomId, start_date: '2026-11-21', monthly_rent_vnd: '1', deposit_required_vnd: '0', primary: { new_tenant: { full_name: 'Khách mới' } } }, key());
    expect(blocked.status).toBe(422);
    expect((await post(`/api/v1/rooms/${roomId}/set-operational-status`, { status: 'READY', expected_version: room.version })).status).toBe(200);
    const sameDay = await post('/api/v1/tenancies/move-in', { room_id: roomId, start_date: '2026-11-20', monthly_rent_vnd: '1', deposit_required_vnd: '0', primary: { new_tenant: { full_name: 'Khách mới' } } }, key());
    expect(sameDay.status).toBe(422);
    await at('2026-11-21');
    const next = await post('/api/v1/tenancies/move-in', { room_id: roomId, start_date: '2026-11-21', monthly_rent_vnd: '3000000', deposit_required_vnd: '0', primary: { new_tenant: { full_name: 'Khách mới' } } }, key());
    expect(next.status).toBe(201);
    const nt = (await owner.agent.get(`/api/v1/tenancies/${next.body.id}`)).body;
    expect(nt.deposit).toMatchObject({ held_vnd: '0' });
    expect((await owner.agent.get(`/api/v1/tenancies/${next.body.id}/statement`)).body).toMatchObject({ debt_vnd: expect.any(String), credit_available_vnd: '0' });
    const sheet = (await owner.agent.get(`/api/v1/meter-readings/sheet?building_id=${A}&period=2026-12`)).body;
    const m = sheet.rows.find((r: { tenancy_id: string }) => r.tenancy_id === next.body.id).meters.find((x: { type: string }) => x.type === 'ELECTRICITY');
    expect(m.previous).toMatchObject({ value: '1000', kind: 'INITIAL' });
  });

  it('T32: lỗi database giữa lúc hoàn tất → rollback toàn bộ, không trạng thái nửa vời', async () => {
    await prices();
    const { roomId, tenancyId } = await moveIn('2026-10-01', '3000000');
    await publishDraft(tenancyId);
    await at('2026-10-20');
    const s = await startSettlement(tenancyId, { last_charge_date: '2026-10-20', destination_room_status: 'MAINTENANCE', final_readings: await finals(roomId, '1050', '103') });
    const pv: SettlementPreview = (await post(`/api/v1/settlements/${s.id}/preview`, {})).body;
    const ap = (await post(`/api/v1/settlements/${s.id}/approve`, { expected_version: s.version, input_hash: pv.input_hash })).body;
    // Bước đổi trạng thái phòng (cuối transaction) sẽ lỗi.
    await t.prisma.$executeRawUnsafe(`ALTER TABLE rooms ADD CONSTRAINT tmp_fail_maintenance CHECK (operational_status <> 'MAINTENANCE') NOT VALID`);
    try {
      const r = await post(`/api/v1/settlements/${s.id}/complete`, { expected_version: ap.version }, key());
      // Vi phạm CHECK được ánh xạ thành 422 (lớp bảo vệ cuối), transaction rollback.
      expect([r.status, r.body.code]).toEqual([422, 'BUSINESS_RULE_VIOLATION']);
    } finally {
      await t.prisma.$executeRawUnsafe('ALTER TABLE rooms DROP CONSTRAINT tmp_fail_maintenance');
    }
    expect((await settlement(s.id)).status).toBe('APPROVED');
    expect((await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body.status).toBe('MOVE_OUT_PROCESSING');
    expect(await t.prisma.invoice.count({ where: { tenancyId, type: { in: ['FINAL', 'CREDIT_ADJUSTMENT'] } } })).toBe(0);
    expect(await t.prisma.depositTransaction.count({ where: { tenancyId, type: 'APPLIED_TO_INVOICE' } })).toBe(0);
    expect(await t.prisma.creditApplication.count({ where: { tenancyId } })).toBe(0);
  });
});
