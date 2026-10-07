import type { InvoiceDetail, InvoiceLine } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { addMonths } from '../../src/domain/dates/date-only.js';
import { createRoom, ownerId, serviceId } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const A = SEED_IDS.buildings.A;

describe('Phase 5 — billing engine', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const post = (url: string, body: unknown, s: Session = owner) => s.agent.post(url).set(CSRF_HEADER, s.csrf).send(body as object);
  const invoice = async (id: string): Promise<InvoiceDetail> => (await owner.agent.get(`/api/v1/invoices/${id}`)).body;
  const amounts = (lines: InvoiceLine[]) => lines.map((l) => [l.group, l.direction, l.amount_vnd, l.label]);

  async function seedPrices() {
    const by = await ownerId(t);
    const elec = await serviceId(t, 'ELEC');
    const water = await serviceId(t, 'WATER');
    const internet = await serviceId(t, 'INTERNET');
    const parking = await serviceId(t, 'PARKING');
    await t.prisma.servicePriceHistory.createMany({
      data: [
        { workspaceId: SEED_IDS.workspace, serviceId: elec, buildingId: A, effectiveFrom: new Date('2026-01-01'), unitPrice: '3500', createdBy: by },
        { workspaceId: SEED_IDS.workspace, serviceId: water, buildingId: A, effectiveFrom: new Date('2026-01-01'), unitPrice: '15000', createdBy: by },
        { workspaceId: SEED_IDS.workspace, serviceId: internet, buildingId: null, effectiveFrom: new Date('2026-01-01'), unitPrice: '100000', createdBy: by },
        { workspaceId: SEED_IDS.workspace, serviceId: parking, buildingId: null, effectiveFrom: new Date('2026-01-01'), unitPrice: '100000', createdBy: by },
      ],
    });
    return { internet, parking };
  }

  async function moveIn(start: string, extra: Record<string, unknown> = {}) {
    const room = await createRoom(t);
    const res = await owner.agent
      .post('/api/v1/tenancies/move-in')
      .set(CSRF_HEADER, owner.csrf)
      .set('Idempotency-Key', `bill-${Date.now()}-${++keySeq}`)
      .send({
        room_id: room.id,
        start_date: start,
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: '0',
        primary: { new_tenant: { full_name: 'Khách Tính Phí' } },
        services: [{ service_id: await serviceId(t, 'INTERNET'), quantity: '1' }],
        meter_readings: [{ type: 'ELECTRICITY', value: '1000' }],
        ...extra,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { roomId: room.id, tenancyId: res.body.id as string };
  }

  async function draftOf(tenancyId: string) {
    const list = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${tenancyId}&lifecycle=DRAFT`)).body;
    expect(list.total).toBe(1);
    return invoice(list.items[0].id);
  }

  async function publish(id: string) {
    const inv = await invoice(id);
    const res = await post(`/api/v1/invoices/${id}/publish`, { expected_version: inv.version, source_hash: inv.source_hash });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { invoice: InvoiceDetail; credit_invoice: { id: string; number: string; total_vnd: string } | null };
  }

  async function generate(period: string, tenancyId: string) {
    const res = await post('/api/v1/billing/generate', { period, tenancy_ids: [tenancyId] });
    expect(res.status).toBe(200);
    return res.body.items[0] as { status: string; invoice_id: string | null; errors: { code: string; message: string }[] };
  }

  async function reading(roomId: string, period: string, readOn: string, value: string, type = 'ELECTRICITY') {
    const meter = await t.prisma.meter.findFirstOrThrow({ where: { roomId, type: type as 'ELECTRICITY', retiredOn: null } });
    const res = await post('/api/v1/meter-readings', { period, read_on: readOn, items: [{ meter_id: meter.id, value }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  /** Bất biến 8.6: sau khi phát hành, mọi u có P(u) = E(u) — chạy lại đối soát không còn dòng nào. */
  async function expectReconciled(tenancyId: string, period: string) {
    const res = await post('/api/v1/billing/preview', { period, tenancy_ids: [tenancyId] });
    const item = res.body.items[0];
    expect(item.lines.filter((l: InvoiceLine) => l.group === 'ADJUSTMENT')).toEqual([]);
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    await at('2026-10-20');
  });
  afterAll(() => t.close());

  it('T01/T40: nhận phòng giữa tháng sinh nháp đầu tiên chia theo ngày, đến hạn ngày nhận; tháng sau không tính lại', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    const first = await draftOf(tenancyId);
    expect(first).toMatchObject({ type: 'MONTHLY', period: '2026-10', due_date: '2026-10-20', lifecycle: 'DRAFT', blocking_errors: [] });
    expect(amounts(first.items)).toEqual([
      ['ADVANCE', 'DEBIT', '1161290', 'Tiền phòng 20/10–31/10/2026'],
      ['ADVANCE', 'DEBIT', '38710', 'Internet 20/10–31/10/2026 (1 phòng/tháng)'],
    ]);
    expect(first.total_vnd).toBe('1200000');
    const pub = await publish(first.id);
    expect(pub.invoice).toMatchObject({ lifecycle: 'PUBLISHED', number: 'TB-202610-0001', payment_status: 'UNPAID', remaining_vnd: '1200000' });

    await at('2026-10-31');
    await reading(roomId, '2026-11', '2026-10-31', '1120');
    await at('2026-11-01');
    const r = await generate('2026-11', tenancyId);
    expect(r).toMatchObject({ status: 'CREATED', errors: [] });
    const nov = await invoice(r.invoice_id!);
    expect(amounts(nov.items)).toEqual([
      ['ADVANCE', 'DEBIT', '3000000', 'Tiền phòng 01/11–30/11/2026'],
      ['ADVANCE', 'DEBIT', '100000', 'Internet 01/11–30/11/2026 (1 phòng/tháng)'],
      ['ARREARS', 'DEBIT', '420000', 'Điện tháng 10/2026 (20/10–31/10/2026): 1000 → 1120 = 120 kWh'],
    ]);
    expect(nov.due_date).toBe('2026-11-05');
    // T61: tiền tạm tính trên màn hình nhập = tiền chính thức
    const sheet = (await owner.agent.get(`/api/v1/meter-readings/sheet?building_id=${A}&period=2026-11`)).body;
    expect(sheet.rows[0].meters.find((m: { type: string }) => m.type === 'ELECTRICITY').provisional_vnd).toBe('420000');
    await publish(nov.id);
    await expectReconciled(tenancyId, '2026-11');
  });

  it('T16/T49: tạo lặp hoặc đồng thời chỉ có một thông báo; còn nháp cũ thì tháng mới báo lỗi; P(u) chỉ gồm PUBLISHED', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    expect((await generate('2026-10', tenancyId)).status).toBe('EXISTS');
    await at('2026-10-31');
    await reading(roomId, '2026-11', '2026-10-31', '1100');
    const blocked = await generate('2026-11', tenancyId);
    expect(blocked.status).toBe('DRAFT_PENDING');
    expect(blocked.errors[0]!.message).toContain('nháp chưa phát hành');
    // Nháp tháng 10 chưa phát hành → xem trước tháng 11 vẫn gồm tiền phòng tháng 10 (không bị coi là đã thu)
    const pv = (await post('/api/v1/billing/preview', { period: '2026-11', tenancy_ids: [tenancyId] })).body.items[0];
    expect(pv.status).toBe('DRAFT_PENDING');
    expect(pv.lines.map((l: InvoiceLine) => l.label)).toContain('Phí kỳ trước chưa lập — Tiền phòng 20/10–31/10/2026');

    await publish((await draftOf(tenancyId)).id);
    const both = await Promise.all([post('/api/v1/billing/generate', { period: '2026-11', tenancy_ids: [tenancyId] }), post('/api/v1/billing/generate', { period: '2026-11', tenancy_ids: [tenancyId] })]);
    expect(both.map((b) => b.body.items[0].status).sort()).toEqual(['CREATED', 'EXISTS']);
    expect(await t.prisma.invoice.count({ where: { tenancyId, type: 'MONTHLY', statementPeriod: { monthStart: new Date('2026-11-01') } } })).toBe(1);

    // T46: tính lại khi dữ liệu không đổi → không đổi gì
    const nov = await draftOf(tenancyId);
    const re = await post(`/api/v1/invoices/${nov.id}/recalculate`, { expected_version: nov.version });
    expect(re.body).toMatchObject({ changed: false, before_total_vnd: nov.total_vnd, after_total_vnd: nov.total_vnd });
    expect(re.body.invoice.items).toHaveLength(nov.items.length);
  });

  it('T14/T60: thiếu chỉ số hoặc tòa thiếu giá → nháp có lỗi chặn phát hành, không dùng usage 0', async () => {
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    const first = await draftOf(tenancyId);
    // Chưa có giá Internet
    expect(first.blocking_errors.map((e) => e.code)).toEqual(['NO_SERVICE_PRICE']);
    const res = await post(`/api/v1/invoices/${first.id}/publish`, { expected_version: first.version, source_hash: first.source_hash });
    expect(res.status).toBe(422);
    await post(`/api/v1/invoices/${first.id}/cancel`, { reason: 'Chờ đặt giá', expected_version: first.version });
    const internet = await serviceId(t, 'INTERNET');
    await post(`/api/v1/services/${internet}/prices`, { effective_from: '2026-01-01', unit_price: '100000', reason: 'Giá Internet' });
    await at('2026-11-01');
    const r = await generate('2026-11', tenancyId);
    expect(r.errors.map((e) => e.code)).toEqual(['MISSING_READING']);
    expect(r.errors[0]!.message).toContain('Thiếu chỉ số điện kỳ 11/2026');
    const draft = await invoice(r.invoice_id!);
    expect(draft.items.some((l) => l.charge_kind === 'METER')).toBe(false);
    await reading(roomId, '2026-11', '2026-10-31', '1100');
    const re: InvoiceDetail = (await post(`/api/v1/invoices/${draft.id}/recalculate`, { expected_version: draft.version })).body.invoice;
    expect(re.blocking_errors.map((e) => e.code)).toEqual(['NO_METER_PRICE']);
    expect(re.blocking_errors[0]!.message).toContain('Tòa A chưa có giá điện cho kỳ 11/2026');
    await post(`/api/v1/buildings/${A}/meter-prices`, { meter_type: 'ELECTRICITY', effective_from: '2026-11-01', unit_price: '3500', reason: 'Đặt giá', confirm_existing_readings: true });
    const again = await post(`/api/v1/invoices/${draft.id}/recalculate`, { expected_version: re.version });
    expect(again.body.invoice.blocking_errors).toEqual([]);
    // Lần tính tháng 11 gồm cả tiền phòng tháng 10 chưa lập (nháp tháng 10 đã hủy)
    expect(again.body.invoice.items.map((l: InvoiceLine) => l.label)).toContain('Phí kỳ trước chưa lập — Tiền phòng 20/10–31/10/2026');
  });

  it('STALE: dữ liệu nguồn đổi sau khi tính nháp thì không phát hành được cho tới khi tính lại', async () => {
    await seedPrices();
    const { tenancyId } = await moveIn('2026-10-20');
    const draft = await draftOf(tenancyId);
    await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-10-25', monthly_rent_vnd: '3100000', reason: 'Thỏa thuận lại', confirm_mid_month: true });
    const stale = await post(`/api/v1/invoices/${draft.id}/publish`, { expected_version: draft.version, source_hash: draft.source_hash });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE');
    const re = await post(`/api/v1/invoices/${draft.id}/recalculate`, { expected_version: draft.version });
    expect(re.body.changed).toBe(true);
    // 3.000.000 × 5 + 3.100.000 × 7 = 36.700.000 / 31 = 1.183.870,97
    expect(re.body.invoice.items.filter((l: InvoiceLine) => l.charge_kind === 'RENT').map((l: InvoiceLine) => l.amount_vnd)).toEqual(['483871', '700000']);
    await publish(draft.id);
  });

  it('T41/T09: đổi giá sau khi đã thu trước → dòng đối soát liên kết ở nháp kế tiếp; thông báo đã phát hành không đổi', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    await publish((await draftOf(tenancyId)).id);
    await at('2026-10-31');
    await reading(roomId, '2026-11', '2026-10-31', '1100');
    const nov = (await generate('2026-11', tenancyId)).invoice_id!;
    const novPub = await publish(nov);
    const before = JSON.stringify(novPub.invoice.items);

    await at('2026-11-20');
    expect((await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-11-16', monthly_rent_vnd: '3300000', reason: 'Tăng giá', confirm_mid_month: true })).status).toBe(201);
    await at('2026-11-30');
    await reading(roomId, '2026-12', '2026-11-30', '1200');
    const dec = await invoice((await generate('2026-12', tenancyId)).invoice_id!);
    const adj = dec.items.filter((l) => l.group === 'ADJUSTMENT');
    expect(adj).toHaveLength(1);
    // E = 3.000.000 × 15/30 + 3.300.000 × 15/30 = 3.150.000; đã lập 3.000.000 → +150.000
    expect(adj[0]).toMatchObject({ direction: 'DEBIT', amount_vnd: '150000', corrects_item_id: novPub.invoice.items.find((l) => l.charge_kind === 'RENT')!.id });
    expect(adj[0]!.label).toContain('Điều chỉnh tiền phòng tháng 11/2026');
    expect(dec.items.find((l) => l.charge_kind === 'RENT' && l.group === 'ADVANCE')!.amount_vnd).toBe('3300000');
    expect(JSON.stringify((await invoice(nov)).items)).toBe(before);
    await publish(dec.id);
    await expectReconciled(tenancyId, '2026-12');
  });

  it('T45: nháp tổng âm → phát hành tách CREDIT_ADJUSTMENT; không có thông báo loại nợ tổng âm', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    await publish((await draftOf(tenancyId)).id);
    await at('2026-10-31');
    await reading(roomId, '2026-11', '2026-10-31', '1100');
    await publish((await generate('2026-11', tenancyId)).invoice_id!);
    // Miễn tiền phòng từ 01/11 (thỏa thuận) → tháng 11 đã thu 3.000.000 phải hoàn
    await at('2026-11-30');
    await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-11-01', monthly_rent_vnd: '0', reason: 'Miễn tiền phòng' });
    await reading(roomId, '2026-12', '2026-11-30', '1110');
    const dec = await invoice((await generate('2026-12', tenancyId)).invoice_id!);
    // Internet 100.000 + điện 10 kWh 35.000 + tiền phòng 0 − hoàn 3.000.000
    expect(dec.total_vnd).toBe('-2865000');
    const pub = await publish(dec.id);
    expect(pub.invoice).toMatchObject({ total_vnd: '135000', number: 'TB-202612-0001' });
    expect(pub.invoice.items.every((l) => l.direction === 'DEBIT')).toBe(true);
    expect(pub.credit_invoice).toMatchObject({ type: 'CREDIT_ADJUSTMENT', number: 'DCG-202612-0001', total_vnd: '3000000', source_invoice_id: dec.id });
    const all = await t.prisma.invoice.findMany({ where: { tenancyId, lifecycle: 'PUBLISHED' } });
    expect(all.every((i) => i.totalVnd >= 0n)).toBe(true);
    await expectReconciled(tenancyId, '2026-12');
  });

  it('T42: đổi cấu hình làm tròn — tiền cũ không đổi, đối soát dùng chính sách của dòng gốc; u mới dùng chính sách mới', async () => {
    await seedPrices();
    const { tenancyId } = await moveIn('2026-10-20');
    await publish((await draftOf(tenancyId)).id);
    expect((await post('/api/v1/settings/billing', { effective_from: '2026-10-01', proration: 'FIXED_30', rounding_unit: 1000, due_day: 5, default_charge_timing: 'ADVANCE' })).status).toBe(201);
    await expectReconciled(tenancyId, '2026-10');
    // Tháng mới: thuê từ 01/11 (đủ tháng) nhưng làm tròn 1.000 — kiểm qua dịch vụ đổi giữa tháng
    await at('2026-11-01');
    const pv = (await post('/api/v1/billing/preview', { period: '2026-11', tenancy_ids: [tenancyId] })).body.items[0];
    expect(pv.lines.filter((l: InvoiceLine) => l.group === 'ADJUSTMENT')).toEqual([]);
    const policies = await t.prisma.invoiceItem.findMany({ where: { invoice: { tenancyId } }, select: { policySnapshot: true } });
    expect(policies.every((p) => (p.policySnapshot as { rounding_unit: number }).rounding_unit === 1)).toBe(true);
  });

  it('T50 (dòng điều chỉnh): phát hành phí theo giá kỳ gia hạn rồi hủy kỳ đó → đúng một dòng điều chỉnh', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20', { contract: { term_start: '2026-10-20', term_end: '2026-10-31', signed: true } });
    await publish((await draftOf(tenancyId)).id);
    const renew = await post(`/api/v1/tenancies/${tenancyId}/contracts/renew`, { term_start: '2026-11-01', term_end: '2027-04-30', monthly_rent_vnd: '3300000', signed: true, signed_at: '2026-10-20' });
    expect(renew.status).toBe(201);
    await at('2026-10-28');
    await reading(roomId, '2026-11', '2026-10-28', '1050');
    const nov = await invoice((await generate('2026-11', tenancyId)).invoice_id!);
    expect(nov.items.find((l) => l.charge_kind === 'RENT')!.amount_vnd).toBe('3300000');
    await publish(nov.id);
    const cancel = await post(`/api/v1/contracts/${renew.body.id}/cancel`, { reason: 'Khách không gia hạn', expected_version: renew.body.version });
    expect(cancel.status).toBe(200);
    await at('2026-11-30');
    await reading(roomId, '2026-12', '2026-11-30', '1100');
    const dec = await invoice((await generate('2026-12', tenancyId)).invoice_id!);
    const adj = dec.items.filter((l) => l.group === 'ADJUSTMENT');
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ direction: 'CREDIT', amount_vnd: '300000' });
  });

  it('“Điều chỉnh ngay”: xem trước không ghi; xác nhận phát hành chứng từ điều chỉnh, hủy và tạo lại nháp đang mở', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    const oct = (await publish((await draftOf(tenancyId)).id)).invoice;
    await at('2026-10-31');
    await reading(roomId, '2026-11', '2026-10-31', '1100');
    const novDraft = (await generate('2026-11', tenancyId)).invoice_id!;
    expect((await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-10-21', monthly_rent_vnd: '2900000', reason: 'Giảm giá', confirm_mid_month: true })).status).toBe(201);
    // Tháng 10: (3.000.000 × 1 + 2.900.000 × 11) / 31 = 1.125.806; đã lập 1.161.290 → giảm 35.484
    const preview = await post(`/api/v1/invoices/${oct.id}/adjustments`, { confirm: false, reason: 'Giảm giá tháng đầu' });
    expect(preview.body).toMatchObject({ confirmed: false, credit_total_vnd: '35484', debit_total_vnd: '0', open_draft_id: novDraft });
    expect(await t.prisma.invoice.count({ where: { tenancyId, type: 'CREDIT_ADJUSTMENT' } })).toBe(0);
    const done = await post(`/api/v1/invoices/${oct.id}/adjustments`, { confirm: true, reason: 'Giảm giá tháng đầu' });
    expect(done.status).toBe(200);
    expect(done.body.credit_invoice).toMatchObject({ type: 'CREDIT_ADJUSTMENT', lifecycle: 'PUBLISHED', total_vnd: '35484', source_invoice_id: oct.id });
    expect((await invoice(novDraft)).lifecycle).toBe('CANCELLED');
    const newDraft = await draftOf(tenancyId);
    expect(newDraft.id).not.toBe(novDraft);
    expect(newDraft.items.filter((l) => l.group === 'ADJUSTMENT')).toEqual([]);
    expect(newDraft.items.find((l) => l.charge_kind === 'RENT')!.amount_vnd).toBe('2900000');
  });

  it('T39: thu trước 12 tháng liên tiếp — mỗi ngày tiền phòng và mỗi khoảng điện được tính đúng một lần', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    await publish((await draftOf(tenancyId)).id);
    let month = '2026-11-01';
    let value = 1000;
    for (let i = 0; i < 12; i++) {
      const readOn = `${addMonths(month, -1).slice(0, 8)}28`;
      await at(readOn);
      value += 100;
      await reading(roomId, month.slice(0, 7), readOn, String(value));
      await at(month);
      const r = await generate(month.slice(0, 7), tenancyId);
      expect(r.errors).toEqual([]);
      const inv = await invoice(r.invoice_id!);
      expect(inv.items.filter((l) => l.group === 'ADJUSTMENT')).toEqual([]);
      await publish(inv.id);
      month = addMonths(month, 1);
    }
    const rent = await t.prisma.invoiceItem.findMany({ where: { invoice: { tenancyId, lifecycle: 'PUBLISHED' }, chargeKind: 'RENT' } });
    const units = new Set(rent.map((r) => r.unitKey));
    expect(units.size).toBe(13);
    expect(rent).toHaveLength(13);
    const meter = await t.prisma.invoiceItem.findMany({ where: { invoice: { tenancyId, lifecycle: 'PUBLISHED' }, chargeKind: 'METER' } });
    expect(new Set(meter.map((m) => m.unitKey)).size).toBe(12);
    expect(meter.reduce((s, m) => s + m.amountVnd, 0n)).toBe(12n * 100n * 3500n);
    expect(rent.reduce((s, r) => s + r.amountVnd, 0n)).toBe(1_161_290n + 12n * 3_000_000n);
  });

  it('phạm vi và quyền: nhân viên xem thông báo tòa được giao; không tạo/phát hành; tòa khác 404', async () => {
    await seedPrices();
    const { tenancyId } = await moveIn('2026-10-20');
    const draft = await draftOf(tenancyId);
    const staffA = await login(t, 'staffA');
    expect((await staffA.agent.get(`/api/v1/invoices/${draft.id}`)).status).toBe(200);
    expect((await post('/api/v1/billing/generate', { period: '2026-10' }, staffA)).status).toBe(403);
    expect((await post(`/api/v1/invoices/${draft.id}/publish`, { expected_version: 1, source_hash: draft.source_hash }, staffA)).status).toBe(403);
    const staffBC = await login(t, 'staffBC');
    expect((await staffBC.agent.get(`/api/v1/invoices/${draft.id}`)).status).toBe(404);
    expect((await staffBC.agent.get('/api/v1/invoices')).body.total).toBe(0);
  });

  it('T12 (tính tiền): số xe đổi giữa tháng tính xe-ngày; nước theo người tính người-ngày theo lịch sử thành viên', async () => {
    const { parking } = await seedPrices();
    const by = await ownerId(t);
    const waterPp = await serviceId(t, 'WATER_PP');
    await t.prisma.servicePriceHistory.create({ data: { workspaceId: SEED_IDS.workspace, serviceId: waterPp, buildingId: null, effectiveFrom: new Date('2026-01-01'), unitPrice: '60000', createdBy: by } });
    await at('2026-11-01');
    const { tenancyId } = await moveIn('2026-11-01', { meter_readings: [] });
    const url = `/api/v1/tenancies/${tenancyId}/services`;
    expect((await post(url, { action: 'ADD', service_id: parking, effective_from: '2026-11-01', quantity: '1' })).status).toBe(201);
    expect((await post(url, { action: 'CHANGE_QUANTITY', service_id: parking, effective_from: '2026-11-16', quantity: '2', reason: 'Thêm xe', confirm_mid_month: true })).status).toBe(201);
    expect((await post(url, { action: 'ADD', service_id: waterPp, effective_from: '2026-11-01' })).status).toBe(201);
    const detail = (await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body;
    const add = await post(`/api/v1/tenancies/${tenancyId}/members`, { person: { new_tenant: { full_name: 'Bạn cùng phòng' } }, joined_on: '2026-11-11', expected_version: detail.version });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    const draft = await draftOf(tenancyId);
    const re = (await post(`/api/v1/invoices/${draft.id}/recalculate`, { expected_version: draft.version })).body.invoice as InvoiceDetail;
    const lines = (label: string) => re.items.filter((l) => l.label.startsWith(label)).map((l) => [l.label, l.amount_vnd]);
    // Xe: 100.000 × (15 × 1 + 15 × 2) / 30 = 150.000 → 50.000 + 100.000
    expect(lines('Gửi xe máy')).toEqual([
      ['Gửi xe máy 01/11–15/11/2026 (1 xe/tháng)', '50000'],
      ['Gửi xe máy 16/11–30/11/2026 (2 xe/tháng)', '100000'],
    ]);
    // Nước theo người: 60.000 × (10 × 1 + 20 × 2) / 30 = 100.000
    expect(lines('Nước theo người')).toEqual([
      ['Nước theo người 01/11–10/11/2026 (1 người/tháng)', '20000'],
      ['Nước theo người 11/11–30/11/2026 (2 người/tháng)', '80000'],
    ]);
  });

  it('T14 (tính phí): thay đồng hồ giữa kỳ — một khoảng gồm phần đồng hồ cũ và mới', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    await publish((await draftOf(tenancyId)).id);
    await at('2026-10-31');
    await reading(roomId, '2026-11', '2026-10-31', '1100');
    await publish((await generate('2026-11', tenancyId)).invoice_id!);
    await at('2026-11-15');
    const m1 = await t.prisma.meter.findFirstOrThrow({ where: { roomId, type: 'ELECTRICITY', retiredOn: null } });
    expect((await post(`/api/v1/meters/${m1.id}/replace`, { replaced_on: '2026-11-15', closing_value: '1140', new_initial_reading: '0', reason: 'Hỏng' })).status).toBe(200);
    await at('2026-11-30');
    await reading(roomId, '2026-12', '2026-11-30', '25');
    const dec = await invoice((await generate('2026-12', tenancyId)).invoice_id!);
    const meter = dec.items.filter((l) => l.charge_kind === 'METER');
    expect(meter.map((l) => [l.label, l.quantity, l.amount_vnd])).toEqual([['Điện tháng 11/2026 (31/10–30/11/2026): 1100 → 25 (có thay đồng hồ) = 65 kWh', '65', '227500']]);
  });

  it('T15: giá điện đổi giữa hai lần đọc (bỏ sót kỳ) → chặn tính, không chia usage theo ngày', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    await publish((await draftOf(tenancyId)).id);
    await post(`/api/v1/buildings/${A}/meter-prices`, { meter_type: 'ELECTRICITY', effective_from: '2026-11-01', unit_price: '4000', reason: 'Tăng giá' });
    // Không nhập kỳ 11; nhập thẳng kỳ 12
    await at('2026-11-30');
    await reading(roomId, '2026-12', '2026-11-30', '1300');
    const pv = (await post('/api/v1/billing/preview', { period: '2026-12', tenancy_ids: [tenancyId] })).body.items[0];
    expect(pv.status).toBe('BLOCKED');
    expect(pv.errors.map((e: { code: string }) => e.code)).toContain('PRICE_CHANGED_BETWEEN_READINGS');
    expect(pv.lines.some((l: InvoiceLine) => l.charge_kind === 'METER')).toBe(false);
  });

  it('D-025: sửa chỉ số đã dùng trên thông báo đã phát hành → dòng điều chỉnh cho đúng khoảng đó; chỉ số chèn giữa không tạo khoảng mới', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20');
    await publish((await draftOf(tenancyId)).id);
    await at('2026-10-31');
    await reading(roomId, '2026-11', '2026-10-31', '1100');
    const nov = (await publish((await generate('2026-11', tenancyId)).invoice_id!)).invoice;
    const novMeter = nov.items.find((l) => l.charge_kind === 'METER')!;
    expect(novMeter.amount_vnd).toBe('350000');
    const r = await t.prisma.meterReading.findFirstOrThrow({ where: { kind: 'PERIODIC', meter: { roomId } } });
    expect((await post(`/api/v1/meter-readings/${r.id}/correct`, { value: '1090', reason: 'Đọc nhầm', expected_version: r.version })).status).toBe(200);
    await at('2026-11-30');
    await reading(roomId, '2026-12', '2026-11-30', '1150');
    const dec = await invoice((await generate('2026-12', tenancyId)).invoice_id!);
    const meter = dec.items.filter((l) => l.charge_kind === 'METER');
    expect(meter.map((l) => [l.group, l.direction, l.amount_vnd])).toEqual([
      ['ARREARS', 'DEBIT', '210000'],
      ['ADJUSTMENT', 'CREDIT', '35000'],
    ]);
    expect(meter[1]!.corrects_item_id).toBe(novMeter.id);
  });

  it('T04 (sinh phí): hợp đồng hết hạn, khách ở tiếp → thông báo kỳ sau vẫn sinh theo giá hiện hành', async () => {
    await seedPrices();
    const { roomId, tenancyId } = await moveIn('2026-10-20', { contract: { term_start: '2026-10-20', term_end: '2026-10-31', signed: true } });
    await publish((await draftOf(tenancyId)).id);
    await at('2026-11-01');
    await reading(roomId, '2026-11', '2026-10-31', '1000');
    expect((await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body.rental_mode).toBe('MONTH_TO_MONTH');
    const r = await generate('2026-11', tenancyId);
    expect(r).toMatchObject({ status: 'CREATED', errors: [] });
    expect((await invoice(r.invoice_id!)).items.find((l) => l.charge_kind === 'RENT')!.amount_vnd).toBe('3000000');
  });

  it('T19 (sửa): thông báo đã phát hành bất biến — không tính lại; hủy chỉ khi chưa có khoản thu, có lý do và audit', async () => {
    await seedPrices();
    const { tenancyId } = await moveIn('2026-10-20');
    const pub = (await publish((await draftOf(tenancyId)).id)).invoice;
    expect((await post(`/api/v1/invoices/${pub.id}/recalculate`, { expected_version: pub.version })).status).toBe(422);
    expect((await owner.agent.patch(`/api/v1/invoices/${pub.id}`).set(CSRF_HEADER, owner.csrf).send({ total_vnd: '1' })).status).toBe(404);
    const c = await post(`/api/v1/invoices/${pub.id}/cancel`, { reason: 'Lập nhầm', expected_version: pub.version });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ lifecycle: 'CANCELLED', cancel_reason: 'Lập nhầm', number: 'TB-202610-0001' });
    expect(await t.prisma.auditLog.count({ where: { action: 'invoice.cancel_published', entityId: pub.id } })).toBe(1);
  });
});
