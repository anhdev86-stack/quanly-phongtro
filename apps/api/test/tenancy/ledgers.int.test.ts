import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createReservation, createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const key = () => `ledger-${Date.now()}-${++keySeq}`;

describe('Phase 2 — sổ cọc và tiền giữ chỗ (T43, T56)', () => {
  let t: TestApp;
  let owner: Session;
  let roomId: string;

  const post = (s: Session, url: string, body: unknown) => s.agent.post(url).set(CSRF_HEADER, s.csrf).set('Idempotency-Key', key()).send(body as object);
  const held = async (tenancyId: string) => (await owner.agent.get(`/api/v1/tenancies/${tenancyId}/deposit-transactions`)).body.summary.held_vnd;

  async function moveInWithHolding(holdAmount: string, depositAmount: string) {
    const r = await createReservation(t, roomId, { holdFrom: '2026-10-01', holdUntil: '2026-10-08' });
    await post(owner, `/api/v1/reservations/${r.id}/holding-transactions`, { type: 'RECEIVED', amount_vnd: holdAmount, method: 'CASH', paid_at: '2026-10-01' });
    const res = await post(owner, '/api/v1/tenancies/move-in', {
      room_id: roomId,
      start_date: '2026-10-06',
      monthly_rent_vnd: '3000000',
      reservation_id: r.id,
      primary: { new_tenant: { full_name: 'Phạm Minh' } },
      deposit_received: { amount_vnd: depositAmount, method: 'CASH', paid_at: '2026-10-06' },
    });
    expect(res.status).toBe(201);
    const ledger = (await owner.agent.get(`/api/v1/tenancies/${res.body.id}/deposit-transactions`)).body;
    return { reservationId: r.id, tenancyId: res.body.id as string, ledger };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    owner = await login(t, 'owner');
    roomId = (await createRoom(t)).id;
  });
  afterAll(() => t.close());

  it('nhận thêm cọc, hoàn cọc không vượt số đang giữ, đảo RECEIVED đúng số dư, không đảo hai lần', async () => {
    const { tenancyId } = await moveInWithHolding('500000', '2000000');
    expect(await held(tenancyId)).toBe('2500000');
    expect((await post(owner, `/api/v1/tenancies/${tenancyId}/deposit-transactions`, { type: 'TOP_UP', amount_vnd: '500000', method: 'CASH', paid_at: '2026-10-07' })).status).toBe(201);
    expect(await held(tenancyId)).toBe('3000000');

    const tooMuch = await post(owner, `/api/v1/tenancies/${tenancyId}/deposit-transactions`, { type: 'REFUND', amount_vnd: '3000001', method: 'CASH', paid_at: '2026-10-07', reason: 'Hoàn bớt cọc' });
    expect(tooMuch.status).toBe(422);
    expect(await held(tenancyId)).toBe('3000000');

    const ledger = (await owner.agent.get(`/api/v1/tenancies/${tenancyId}/deposit-transactions`)).body;
    const topUp = ledger.transactions.find((x: { type: string }) => x.type === 'TOP_UP');
    expect((await post(owner, `/api/v1/deposit-transactions/${topUp.id}/reverse`, { reason: 'Ghi nhầm' })).status).toBe(201);
    expect(await held(tenancyId)).toBe('2500000');
    expect((await post(owner, `/api/v1/deposit-transactions/${topUp.id}/reverse`, { reason: 'Ghi nhầm lần hai' })).status).toBe(409);
  });

  it('STAFF không hoàn cọc, không đảo được; khấu trừ cần quyền duyệt quyết toán', async () => {
    const { tenancyId, ledger } = await moveInWithHolding('100000', '1000000');
    const staff = await login(t, 'staffA');
    expect((await post(staff, `/api/v1/tenancies/${tenancyId}/deposit-transactions`, { type: 'REFUND', amount_vnd: '1', method: 'CASH', paid_at: '2026-10-07', reason: 'thử' })).status).toBe(403);
    expect((await post(staff, `/api/v1/deposit-transactions/${ledger.transactions[0].id}/reverse`, { reason: 'thử' })).status).toBe(403);
    expect((await post(owner, `/api/v1/tenancies/${tenancyId}/deposit-transactions`, { type: 'DEDUCTION', amount_vnd: '100000', paid_at: '2026-10-07', reason: 'Hỏng khóa' })).status).toBe(201);
  });

  it('T56: đảo việc chuyển giữ chỗ → cọc đảo cả cặp trong một transaction', async () => {
    const { tenancyId, reservationId, ledger } = await moveInWithHolding('1000000', '2000000');
    const conv = ledger.transactions.find((x: { type: string }) => x.type === 'CONVERTED_FROM_HOLDING');
    const res = await post(owner, `/api/v1/deposit-transactions/${conv.id}/reverse`, { reason: 'Nhận phòng nhầm lượt giữ chỗ' });
    expect(res.status).toBe(201);
    expect(await held(tenancyId)).toBe('2000000');
    const holding = (await owner.agent.get(`/api/v1/reservations/${reservationId}/holding-transactions`)).body;
    expect(holding.balance_vnd).toBe('1000000');
    expect(holding.transactions.filter((x: { type: string }) => x.type === 'REVERSAL')).toHaveLength(1);

    // Đảo lại từ phía giữ chỗ: đã đảo rồi → 409, không tạo thêm REVERSAL ở sổ nào
    const holdingConv = holding.transactions.find((x: { type: string }) => x.type === 'CONVERTED_TO_DEPOSIT');
    expect((await post(owner, `/api/v1/holding-transactions/${holdingConv.id}/reverse`, { reason: 'Đảo lần hai' })).status).toBe(409);
    expect(await t.prisma.depositTransaction.count({ where: { type: 'REVERSAL' } })).toBe(1);
    expect(await t.prisma.holdingTransaction.count({ where: { type: 'REVERSAL' } })).toBe(1);
  });

  it('T56: không đảo được khi cọc nhận từ giữ chỗ đã được hoàn; rollback cả hai sổ', async () => {
    // Cọc = 1.000.000 (từ giữ chỗ) + 1đ thực nhận; hoàn 1.000.000 → phần từ giữ chỗ đã bị dùng
    const { tenancyId, reservationId, ledger } = await moveInWithHolding('1000000', '1');
    expect((await post(owner, `/api/v1/tenancies/${tenancyId}/deposit-transactions`, { type: 'REFUND', amount_vnd: '1000000', method: 'CASH', paid_at: '2026-10-07', reason: 'Hoàn cọc' })).status).toBe(201);
    const conv = ledger.transactions.find((x: { type: string }) => x.type === 'CONVERTED_FROM_HOLDING');
    const res = await post(owner, `/api/v1/deposit-transactions/${conv.id}/reverse`, { reason: 'Muốn đảo' });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('đảo các giao dịch đó trước');
    expect(await t.prisma.depositTransaction.count({ where: { type: 'REVERSAL' } })).toBe(0);
    expect(await t.prisma.holdingTransaction.count({ where: { type: 'REVERSAL' } })).toBe(0);
    expect((await owner.agent.get(`/api/v1/reservations/${reservationId}/holding-transactions`)).body.balance_vnd).toBe('0');
  });

  it('T43: hủy giữ phòng không tự mất tiền; hoàn/giữ lại cần quyền và lý do', async () => {
    const r = await createReservation(t, roomId, { holdFrom: '2026-10-07', holdUntil: '2026-10-09' });
    await post(owner, `/api/v1/reservations/${r.id}/holding-transactions`, { type: 'RECEIVED', amount_vnd: '800000', method: 'CASH', paid_at: '2026-10-06' });
    await owner.agent.post(`/api/v1/reservations/${r.id}/cancel`).set(CSRF_HEADER, owner.csrf).send({ reason: 'Khách không đến', expected_version: 1 });
    const after = await owner.agent.get(`/api/v1/reservations/${r.id}`);
    expect(after.body).toMatchObject({ status: 'CANCELLED', holding_balance_vnd: '800000' });

    const staff = await login(t, 'staffA');
    expect((await post(staff, `/api/v1/reservations/${r.id}/holding-transactions`, { type: 'FORFEIT', amount_vnd: '800000', paid_at: '2026-10-08', reason: 'Theo thỏa thuận' })).status).toBe(403);
    expect((await post(owner, `/api/v1/reservations/${r.id}/holding-transactions`, { type: 'FORFEIT', amount_vnd: '800000', paid_at: '2026-10-08' })).status).toBe(400);
    expect((await post(owner, `/api/v1/reservations/${r.id}/holding-transactions`, { type: 'FORFEIT', amount_vnd: '500000', paid_at: '2026-10-08', reason: 'Giữ một phần theo thỏa thuận' })).status).toBe(201);
    expect((await post(owner, `/api/v1/reservations/${r.id}/holding-transactions`, { type: 'REFUND', amount_vnd: '300001', method: 'CASH', paid_at: '2026-10-08', reason: 'Hoàn phần còn lại' })).status).toBe(422);
    expect((await post(owner, `/api/v1/reservations/${r.id}/holding-transactions`, { type: 'REFUND', amount_vnd: '300000', method: 'CASH', paid_at: '2026-10-08', reason: 'Hoàn phần còn lại' })).status).toBe(201);
    expect((await owner.agent.get(`/api/v1/reservations/${r.id}`)).body.holding_balance_vnd).toBe('0');
    // Không nhận thêm tiền giữ chỗ cho lượt đã hủy
    expect((await post(owner, `/api/v1/reservations/${r.id}/holding-transactions`, { type: 'RECEIVED', amount_vnd: '1', method: 'CASH', paid_at: '2026-10-08' })).status).toBe(422);
  });
});
