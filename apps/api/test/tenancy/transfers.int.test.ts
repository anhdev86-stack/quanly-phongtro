import type { InvoiceDetail, SettlementDto, SettlementPreview, TenancyDetail } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const key = () => `p14-${Date.now()}-${++keySeq}`;

describe('Phase 14 — chuyển phòng (T48)', () => {
  let t: TestApp;
  let owner: Session;

  const at = async (date: string) => {
    t.clock.set(`${date}T03:00:00.000Z`);
    owner = await login(t, 'owner');
  };
  const post = (url: string, body: unknown, k?: string, s: Session = owner) => {
    const r = s.agent.post(url).set(CSRF_HEADER, s.csrf);
    if (k) r.set('Idempotency-Key', k);
    return r.send(body as object);
  };
  const tenancy = async (id: string): Promise<TenancyDetail> => (await owner.agent.get(`/api/v1/tenancies/${id}`)).body;
  const invoice = async (id: string): Promise<InvoiceDetail> => (await owner.agent.get(`/api/v1/invoices/${id}`)).body;

  /** Thuê phòng cũ từ 01/10 (cọc 3.000.000, có người ở cùng), phát hành và trả đủ tháng 10, rồi trả phòng: ngày cuối tính tiền 20/10. */
  async function endedTenancy() {
    await at('2026-10-01');
    const room = await createRoom(t, { building: 'A', maxOccupants: 3 });
    const mi = await post(
      '/api/v1/tenancies/move-in',
      {
        room_id: room.id,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3100000',
        deposit_required_vnd: '3000000',
        deposit_received: { amount_vnd: '3000000', method: 'CASH', paid_at: '2026-10-01' },
        primary: { new_tenant: { full_name: 'Khách Chuyển Phòng' } },
        members: [{ new_tenant: { full_name: 'Người Ở Cùng' } }],
      },
      key(),
    );
    expect(mi.status, JSON.stringify(mi.body)).toBe(201);
    const fromId = mi.body.id as string;
    const draft = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${fromId}&lifecycle=DRAFT`)).body.items[0].id as string;
    const d = await invoice(draft);
    expect((await post(`/api/v1/invoices/${draft}/publish`, { expected_version: d.version, source_hash: d.source_hash })).status).toBe(200);
    expect((await post('/api/v1/payments', { tenancy_id: fromId, amount_vnd: '3100000', method: 'CASH', paid_at: '2026-10-01', allocations: [{ invoice_id: draft, amount_vnd: '3100000' }] }, key())).status).toBe(201);

    await at('2026-10-20');
    const s = await post(`/api/v1/tenancies/${fromId}/move-out-settlements`, { last_charge_date: '2026-10-20', destination_room_status: 'READY', inventory_note: 'Đủ', handover_by: 'Chủ trọ' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const pv: SettlementPreview = (await post(`/api/v1/settlements/${s.body.id}/preview`, {})).body;
    expect(pv.blocking).toEqual([]);
    const cur: SettlementDto = (await owner.agent.get(`/api/v1/settlements/${s.body.id}`)).body;
    const ap = await post(`/api/v1/settlements/${s.body.id}/approve`, { expected_version: cur.version, input_hash: pv.input_hash });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const done = await post(`/api/v1/settlements/${s.body.id}/complete`, { expected_version: ap.body.version }, key());
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    await at('2026-10-21');
    const old = await tenancy(fromId);
    return { fromId, fromRoomId: room.id, old, primaryId: old.members.find((m) => m.role === 'PRIMARY')!.tenant_id, memberId: old.members.find((m) => m.role === 'MEMBER')!.tenant_id };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
  });
  afterAll(() => t.close());

  it('T48: cọc chuyển bằng cặp TRANSFER_OUT/IN, phòng cũ quyết toán đúng tới ngày trước ngày chuyển, credit không chuyển; chặn sai điều kiện', async () => {
    const { fromId, fromRoomId, old, primaryId, memberId } = await endedTenancy();
    expect(old).toMatchObject({ status: 'ENDED', last_charge_date: '2026-10-20' });
    expect(old.deposit.held_vnd).toBe('3000000');
    const creditBefore = (await owner.agent.get(`/api/v1/tenancies/${fromId}/statement`)).body.credit_available_vnd as string;
    expect(BigInt(creditBefore)).toBeGreaterThan(0n); // tiền phòng 21–31/10 đã thu trước

    const newRoom = await createRoom(t, { building: 'A', rent: 3500000n, maxOccupants: 3 });
    const body = (extra: Record<string, unknown> = {}) => ({
      to_room_id: newRoom.id,
      start_date: '2026-10-21',
      primary_tenant_id: primaryId,
      member_tenant_ids: [memberId],
      monthly_rent_vnd: '3500000',
      deposit_required_vnd: '3500000',
      reason: 'Khách muốn phòng rộng hơn',
      ...extra,
    });
    // Sai điều kiện
    expect((await post(`/api/v1/tenancies/${fromId}/transfer`, body({ start_date: '2026-10-22' }), key())).status).toBe(422);
    expect((await post(`/api/v1/tenancies/${fromId}/transfer`, body({ to_room_id: fromRoomId }), key())).status).toBe(400);
    expect((await post(`/api/v1/tenancies/${fromId}/transfer`, body({ primary_tenant_id: (await t.prisma.user.findFirstOrThrow()).id }), key())).status).toBe(400);
    expect((await post(`/api/v1/tenancies/${fromId}/transfer`, body({ deposit_transfer_vnd: '3000001' }), key())).status).toBe(422);
    expect((await post(`/api/v1/tenancies/${fromId}/transfer`, body(), key(), await login(t, 'staffA'))).status).toBe(403);
    // Kế toán không có quyền nhận phòng → 403; cấp riêng quyền nhưng ngoài tòa A → 404
    expect((await post(`/api/v1/tenancies/${fromId}/transfer`, body(), key(), await login(t, 'accountantB'))).status).toBe(403);
    const acc = await t.prisma.user.findUniqueOrThrow({ where: { email: 'accountant.b@example.test' } });
    const perm = await t.prisma.permission.findUniqueOrThrow({ where: { code: 'tenancies.move_in' } });
    await t.prisma.userPermissionOverride.create({ data: { userId: acc.id, permissionId: perm.id, granted: true, createdBy: acc.id } });
    expect((await post(`/api/v1/tenancies/${fromId}/transfer`, body(), key(), await login(t, 'accountantB'))).status).toBe(404);

    const k = key();
    const r = await post(`/api/v1/tenancies/${fromId}/transfer`, body(), k);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.deposit_amount_vnd).toBe('3000000');
    const toId = r.body.id as string;
    // Gửi lại cùng Idempotency-Key: cùng kết quả, không tạo thêm
    const replay = await post(`/api/v1/tenancies/${fromId}/transfer`, body(), k);
    expect(replay.body.id).toBe(toId);
    expect(await t.prisma.roomTransfer.count()).toBe(1);
    // Chuyển lần nữa → 409
    expect((await post(`/api/v1/tenancies/${fromId}/transfer`, body(), key())).status).toBe(409);

    // Cọc: phòng cũ về 0, phòng mới nhận đúng số; cặp giao dịch liên kết hai chiều, cùng số tiền
    const oldAfter = await tenancy(fromId);
    const nt = await tenancy(toId);
    expect(oldAfter.deposit.held_vnd).toBe('0');
    expect(nt.deposit).toMatchObject({ held_vnd: '3000000', required_vnd: '3500000', shortfall_vnd: '500000' });
    const out = await t.prisma.depositTransaction.findFirstOrThrow({ where: { tenancyId: fromId, type: 'TRANSFER_OUT' } });
    const inn = await t.prisma.depositTransaction.findFirstOrThrow({ where: { tenancyId: toId, type: 'TRANSFER_IN' } });
    expect([out.linkedDepositTransactionId, inn.linkedDepositTransactionId, out.amountVnd, inn.amountVnd]).toEqual([inn.id, out.id, 3000000n, 3000000n]);
    // Credit của lần thuê cũ không chuyển sang phòng mới
    expect((await owner.agent.get(`/api/v1/tenancies/${fromId}/statement`)).body.credit_available_vnd).toBe(creditBefore);
    expect((await owner.agent.get(`/api/v1/tenancies/${toId}/statement`)).body.credit_available_vnd).toBe('0');
    // Lần thuê mới: cùng người, từ 21/10; thông báo đầu tiên tính từ 21/10 (không trùng với phòng cũ)
    expect(nt.members.map((m) => [m.tenant_id, m.role]).sort()).toEqual([[memberId, 'MEMBER'], [primaryId, 'PRIMARY']].sort());
    expect(nt.start_date).toBe('2026-10-21');
    const first = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${toId}&lifecycle=DRAFT`)).body.items[0].id as string;
    expect((await invoice(first)).items.find((l) => l.charge_kind === 'RENT')!.label).toContain('21/10–31/10/2026');
    // Liên kết hai chiều trên chi tiết lần thuê
    expect(oldAfter.transferred_to).toMatchObject({ tenancy_id: toId, transfer_date: '2026-10-21', deposit_amount_vnd: '3000000' });
    expect(nt.transferred_from).toMatchObject({ tenancy_id: fromId, room_code: (await t.prisma.room.findUniqueOrThrow({ where: { id: fromRoomId } })).code });
    // Nhật ký hai phía
    expect(await t.prisma.auditLog.count({ where: { action: { in: ['tenancy.transfer_out', 'tenancy.transfer_in'] } } })).toBe(2);
  });

  it('T48: đảo một phía cặp chuyển cọc thì đảo cả cặp; cọc ở phòng mới đã dùng thì chặn đảo', async () => {
    const { fromId, primaryId } = await endedTenancy();
    const newRoom = await createRoom(t, { building: 'A' });
    const r = await post(
      `/api/v1/tenancies/${fromId}/transfer`,
      { to_room_id: newRoom.id, start_date: '2026-10-21', primary_tenant_id: primaryId, monthly_rent_vnd: '3000000', deposit_required_vnd: '3000000', deposit_transfer_vnd: '2000000' },
      key(),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const toId = r.body.id as string;
    expect((await tenancy(fromId)).deposit.held_vnd).toBe('1000000'); // phần còn lại vẫn là khoản phải hoàn ở phòng cũ
    expect((await tenancy(toId)).deposit.held_vnd).toBe('2000000');

    // Phòng mới hoàn 1.500.000 → đảo cặp làm phòng mới âm cọc → bị chặn, không đổi gì
    const refund = await post(`/api/v1/tenancies/${toId}/deposit-transactions`, { type: 'REFUND', amount_vnd: '1500000', paid_at: '2026-10-21', method: 'CASH', reason: 'Hoàn bớt theo thỏa thuận' }, key());
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    const inn = await t.prisma.depositTransaction.findFirstOrThrow({ where: { tenancyId: toId, type: 'TRANSFER_IN' } });
    const blocked = await post(`/api/v1/deposit-transactions/${inn.id}/reverse`, { reason: 'Chuyển nhầm' }, key());
    expect(blocked.status).toBe(422);
    expect(await t.prisma.depositTransaction.count({ where: { type: 'REVERSAL' } })).toBe(0);

    // Đảo khoản hoàn trước, rồi đảo từ phía TRANSFER_OUT: cả hai phía cùng được đảo
    const refundTx = await t.prisma.depositTransaction.findFirstOrThrow({ where: { tenancyId: toId, type: 'REFUND' } });
    expect((await post(`/api/v1/deposit-transactions/${refundTx.id}/reverse`, { reason: 'Hoàn nhầm' }, key())).status).toBe(201);
    const out = await t.prisma.depositTransaction.findFirstOrThrow({ where: { tenancyId: fromId, type: 'TRANSFER_OUT' } });
    expect((await post(`/api/v1/deposit-transactions/${out.id}/reverse`, { reason: 'Chuyển nhầm số tiền' }, key())).status).toBe(201);
    expect((await tenancy(fromId)).deposit.held_vnd).toBe('3000000');
    expect((await tenancy(toId)).deposit.held_vnd).toBe('0');
    const reversals = await t.prisma.depositTransaction.findMany({ where: { type: 'REVERSAL', reversesTransactionId: { in: [out.id, inn.id] } } });
    expect(reversals).toHaveLength(2);
    // Đảo lại lần nữa (phía còn lại) → đã đảo
    expect((await post(`/api/v1/deposit-transactions/${inn.id}/reverse`, { reason: 'Lần nữa' }, key())).status).toBe(409);
  });

  it('chặn chuyển khi phòng cũ chưa quyết toán xong', async () => {
    await at('2026-10-01');
    const room = await createRoom(t, { building: 'A' });
    const mi = await post('/api/v1/tenancies/move-in', { room_id: room.id, start_date: '2026-10-01', monthly_rent_vnd: '3000000', deposit_required_vnd: '0', primary: { new_tenant: { full_name: 'Khách' } } }, key());
    const tn = await tenancy(mi.body.id);
    const other = await createRoom(t, { building: 'A' });
    const r = await post(
      `/api/v1/tenancies/${mi.body.id}/transfer`,
      { to_room_id: other.id, start_date: '2026-10-21', primary_tenant_id: tn.members[0]!.tenant_id, monthly_rent_vnd: '3000000', deposit_required_vnd: '0' },
      key(),
    );
    expect(r.status).toBe(422);
    expect(r.body.message).toContain('trả phòng');
  });
});
