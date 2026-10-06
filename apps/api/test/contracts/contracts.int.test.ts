import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contractStatus } from '../../src/domain/contracts/contract-status.js';
import { addDays } from '../../src/domain/dates/date-only.js';
import { RENTAL_MODE, type RentalModeProvider } from '../../src/modules/tenancies/tenancies.service.js';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;

describe('Phase 3 — hợp đồng và giá (T04–T09, T50)', () => {
  let t: TestApp;
  let owner: Session;
  let tenancyId: string;
  let roomId: string;

  const post = (url: string, body: unknown, s: Session = owner) => s.agent.post(url).set(CSRF_HEADER, s.csrf).send(body as object);
  const tenancy = async () => (await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body;
  const contracts = async () => (await owner.agent.get(`/api/v1/tenancies/${tenancyId}/contracts`)).body.items as { id: string; status: string; version: number; code: string; previous_contract_id: string | null; term_start: string; term_end: string }[];
  const at = (date: string) => t.clock.set(`${date}T03:00:00.000Z`);

  async function moveIn(contract: Record<string, unknown> | null) {
    const res = await owner.agent
      .post('/api/v1/tenancies/move-in')
      .set(CSRF_HEADER, owner.csrf)
      .set('Idempotency-Key', `ct-${Date.now()}-${++keySeq}`)
      .send({
        room_id: roomId,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: '3000000',
        deposit_received: { amount_vnd: '3000000', method: 'CASH', paid_at: '2026-10-01' },
        primary: { new_tenant: { full_name: 'Khách Hợp Đồng' } },
        contract,
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    at('2026-10-01');
    owner = await login(t, 'owner');
    roomId = (await createRoom(t)).id;
  });
  afterAll(() => t.close());

  it('nhận phòng kèm hợp đồng đã ký → FIXED_TERM, hợp đồng ACTIVE', async () => {
    tenancyId = await moveIn({ term_start: '2026-10-01', term_end: '2027-03-31', signed: true, notice_days: 30 });
    expect((await tenancy()).rental_mode).toBe('FIXED_TERM');
    const [c] = await contracts();
    expect(c).toMatchObject({ status: 'ACTIVE', term_start: '2026-10-01', term_end: '2027-03-31' });
  });

  it('T04: hết hạn hợp đồng không kết thúc thuê — phòng vẫn OCCUPIED, cọc giữ nguyên, thuê theo tháng', async () => {
    tenancyId = await moveIn({ term_start: '2026-10-01', term_end: '2026-12-31', signed: true });
    at('2027-01-01');
    owner = await login(t, 'owner');
    const d = await tenancy();
    expect(d).toMatchObject({ status: 'ACTIVE', rental_mode: 'MONTH_TO_MONTH', deposit_held_vnd: '3000000' });
    expect((await contracts())[0]!.status).toBe('EXPIRED');
    expect((await owner.agent.get(`/api/v1/rooms/${roomId}`)).body.display_status).toBe('OCCUPIED');
    expect(await t.prisma.depositTransaction.count({ where: { tenancyId } })).toBe(1);
  });

  it('T05: hàm thuần và hàm SQL cho cùng trạng thái ở mọi mốc ngày', async () => {
    const cases: { lifecycle: 'DRAFT' | 'SIGNED' | 'CANCELLED'; terminated: string | null }[] = [
      { lifecycle: 'SIGNED', terminated: null },
      { lifecycle: 'SIGNED', terminated: '2026-12-10' },
      { lifecycle: 'DRAFT', terminated: null },
      { lifecycle: 'CANCELLED', terminated: null },
    ];
    for (const c of cases) {
      for (let d = '2026-09-28'; d <= '2027-04-03'; d = addDays(d, 9)) {
        const rows = await t.prisma.$queryRawUnsafe<{ s: string }[]>(
          `SELECT contract_effective_status($1::"ContractLifecycle", $2::date, '2026-10-01'::date, '2027-03-31'::date, $3::date) AS s`,
          c.lifecycle,
          c.terminated,
          d,
        );
        expect(rows[0]!.s, `${c.lifecycle} ${c.terminated} @${d}`).toBe(
          contractStatus({ lifecycle: c.lifecycle, termStart: '2026-10-01', termEnd: '2027-03-31', terminatedOn: c.terminated }, d),
        );
      }
    }
  });

  it('T06: gia hạn giữ tenancy_id, kỳ cũ giữ nguyên, không nhận lại cọc; giá mới có source_contract_id', async () => {
    tenancyId = await moveIn({ term_start: '2026-10-01', term_end: '2027-03-31', signed: true });
    const before = await contracts();
    const res = await post(`/api/v1/tenancies/${tenancyId}/contracts/renew`, {
      term_start: '2027-04-01',
      term_end: '2027-09-30',
      monthly_rent_vnd: '3300000',
      deposit_required_vnd: '3300000',
      signed: true,
      signed_at: '2026-10-01',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tenancy_id: tenancyId, status: 'SCHEDULED', previous_contract_id: before[0]!.id });
    const after = await contracts();
    expect(after.find((c) => c.id === before[0]!.id)).toMatchObject({ term_start: '2026-10-01', term_end: '2027-03-31', status: 'ACTIVE' });
    expect(await t.prisma.depositTransaction.count({ where: { tenancyId } })).toBe(1);
    const prices = (await owner.agent.get(`/api/v1/tenancies/${tenancyId}/rent-prices`)).body;
    expect(prices).toEqual(
      expect.arrayContaining([expect.objectContaining({ effective_from: '2027-04-01', monthly_rent_vnd: '3300000', source_contract_id: res.body.id })]),
    );
    // Mức cọc yêu cầu đổi khi kỳ mới bắt đầu; hiện tại vẫn là mức cũ (còn thiếu 0)
    expect((await tenancy()).deposit).toMatchObject({ required_vnd: '3000000', shortfall_vnd: '0' });
    at('2027-04-01');
    owner = await login(t, 'owner');
    expect((await tenancy()).deposit).toMatchObject({ required_vnd: '3300000', shortfall_vnd: '300000' });
    expect((await tenancy()).current_rent_vnd).toBe('3300000');
  });

  it('T07: kỳ tương lai hiển thị SCHEDULED; kỳ đã ký chồng ngày bị chặn', async () => {
    tenancyId = await moveIn({ term_start: '2026-10-01', term_end: '2027-03-31', signed: true });
    const overlap = await post(`/api/v1/tenancies/${tenancyId}/contracts`, { term_start: '2027-03-31', term_end: '2027-06-30', signed: true, signed_at: '2026-10-01' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.message).toContain('Trùng thời gian');
    // Nháp chồng ngày thì được; ký nháp đó thì bị chặn
    const draft = await post(`/api/v1/tenancies/${tenancyId}/contracts`, { term_start: '2027-03-01', term_end: '2027-06-30' });
    expect(draft.body.status).toBe('DRAFT');
    expect((await post(`/api/v1/contracts/${draft.body.id}/sign`, { signed_at: '2026-10-02', expected_version: draft.body.version })).status).toBe(409);
  });

  it('T08: thuê theo tháng một thời gian rồi ký kỳ mới — khoảng trống vẫn MONTH_TO_MONTH, kỳ cũ không đổi', async () => {
    tenancyId = await moveIn({ term_start: '2026-10-01', term_end: '2026-12-31', signed: true });
    at('2027-02-10');
    owner = await login(t, 'owner');
    const res = await post(`/api/v1/tenancies/${tenancyId}/contracts`, { term_start: '2027-03-01', term_end: '2027-08-31', signed: true, signed_at: '2027-02-10' });
    expect(res.status).toBe(201);
    const modes = await t.app.get<RentalModeProvider>(RENTAL_MODE).rentalModes(t.prisma, [tenancyId], '2027-02-15');
    expect(modes.get(tenancyId)).toBe('MONTH_TO_MONTH');
    const all = await contracts();
    expect(all.find((c) => c.term_end === '2026-12-31')!.status).toBe('EXPIRED');
    at('2027-03-01');
    owner = await login(t, 'owner');
    expect((await tenancy()).rental_mode).toBe('FIXED_TERM');
  });

  it('T09: đổi giá từ tháng sau; giữa tháng phải xác nhận; giảm giá một tháng tự khôi phục (D-022)', async () => {
    tenancyId = await moveIn(null);
    const mid = await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-11-15', monthly_rent_vnd: '3200000', reason: 'Tăng giá' });
    expect(mid.status).toBe(422);
    expect(mid.body.field_errors.confirm_mid_month).toBeDefined();
    const ok = await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-11-01', monthly_rent_vnd: '3200000', reason: 'Tăng giá từ tháng 11' });
    expect(ok.status).toBe(201);
    const discount = await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-12-01', monthly_rent_vnd: '2700000', reason: 'Giảm giá tháng 12', only_month: true });
    expect(discount.status).toBe(201);
    const active = discount.body.filter((p: { status: string }) => p.status === 'ACTIVE').map((p: { effective_from: string; monthly_rent_vnd: string }) => [p.effective_from, p.monthly_rent_vnd]);
    expect(active).toEqual([
      ['2026-10-01', '3000000'],
      ['2026-11-01', '3200000'],
      ['2026-12-01', '2700000'],
      ['2027-01-01', '3200000'],
    ]);
    const dup = await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-11-01', monthly_rent_vnd: '1', reason: 'Trùng ngày' });
    expect(dup.status).toBe(409);
  });

  it('T50: hủy kỳ gia hạn đã ký chưa bắt đầu → giá phụ thuộc VOIDED, giá độc lập giữ nguyên, cọc yêu cầu quay về, có audit', async () => {
    tenancyId = await moveIn({ term_start: '2026-10-01', term_end: '2027-03-31', signed: true });
    const renew = await post(`/api/v1/tenancies/${tenancyId}/contracts/renew`, {
      term_start: '2027-04-01',
      term_end: '2027-09-30',
      monthly_rent_vnd: '3500000',
      deposit_required_vnd: '3500000',
      signed: true,
      signed_at: '2026-10-05',
    });
    // Thay đổi giá độc lập (không từ hợp đồng)
    await post(`/api/v1/tenancies/${tenancyId}/rent-prices`, { effective_from: '2026-12-01', monthly_rent_vnd: '3100000', reason: 'Thỏa thuận riêng' });

    const staff = await login(t, 'staffA');
    expect((await post(`/api/v1/contracts/${renew.body.id}/cancel`, { reason: 'Khách đổi ý', expected_version: renew.body.version }, staff)).status).toBe(403);

    const res = await post(`/api/v1/contracts/${renew.body.id}/cancel`, { reason: 'Khách không gia hạn nữa', expected_version: renew.body.version });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.voided_rent_price_ids).toHaveLength(1);
    const prices = (await owner.agent.get(`/api/v1/tenancies/${tenancyId}/rent-prices`)).body;
    expect(prices.find((p: { effective_from: string }) => p.effective_from === '2027-04-01')).toMatchObject({ status: 'VOIDED' });
    expect(prices.find((p: { effective_from: string }) => p.effective_from === '2026-12-01')).toMatchObject({ status: 'ACTIVE', monthly_rent_vnd: '3100000' });
    at('2027-04-10');
    owner = await login(t, 'owner');
    expect((await tenancy()).deposit.required_vnd).toBe('3000000');
    expect((await tenancy()).current_rent_vnd).toBe('3100000');
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'contract.cancel_signed' } });
    expect(JSON.stringify(log.after)).toContain(res.body.voided_rent_price_ids[0]);
  });

  it('không hủy được hợp đồng đang hiệu lực; hủy nháp chỉ cần lý do', async () => {
    tenancyId = await moveIn({ term_start: '2026-10-01', term_end: '2027-03-31', signed: true });
    const [active] = await contracts();
    expect((await post(`/api/v1/contracts/${active!.id}/cancel`, { reason: 'Thử hủy', expected_version: active!.version })).status).toBe(422);
    const draft = await post(`/api/v1/tenancies/${tenancyId}/contracts`, { term_start: '2027-04-01', term_end: '2027-06-30' });
    const cancelled = await post(`/api/v1/contracts/${draft.body.id}/cancel`, { reason: 'Không dùng', expected_version: draft.body.version });
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancellation_reason: 'Không dùng' });
  });

  it('danh sách sắp hết hạn: chỉ hợp đồng đang hiệu lực, chưa gia hạn, trong số ngày yêu cầu', async () => {
    tenancyId = await moveIn({ term_start: '2026-10-01', term_end: '2026-10-20', signed: true });
    let list = (await owner.agent.get('/api/v1/contracts?expiring_within_days=30')).body;
    expect(list.items.map((c: { tenancy_id: string; days_to_expiry: number }) => [c.tenancy_id, c.days_to_expiry])).toEqual([[tenancyId, 19]]);
    await post(`/api/v1/tenancies/${tenancyId}/contracts/renew`, { term_start: '2026-10-21', term_end: '2027-04-20', signed: true, signed_at: '2026-10-01' });
    list = (await owner.agent.get('/api/v1/contracts?expiring_within_days=30')).body;
    expect(list.total).toBe(0);
  });
});
