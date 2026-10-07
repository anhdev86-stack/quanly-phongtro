import type { AuditLogDto, InvoiceDetail, UserDto } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS, SEED_USERS } from '../../prisma/seed/foundation.js';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

const ZERO = '01920000-0000-7000-8000-00000000ffff';
type Who = 'owner' | 'staffA' | 'managerA' | 'accountantB';
const WHO: Who[] = ['owner', 'staffA', 'managerA', 'accountantB'];

let keySeq = 0;
const key = () => `p10-${Date.now()}-${++keySeq}`;

describe('Phase 10 — vai trò MANAGER/ACCOUNTANT, quyền theo người dùng, nhật ký', () => {
  let t: TestApp;
  const s = {} as Record<Who, Session>;

  const send = (who: Who, method: 'post' | 'put' | 'get', url: string, body?: unknown, idem = false) => {
    const r = s[who].agent[method](url);
    if (method !== 'get') r.set(CSRF_HEADER, s[who].csrf);
    if (idem) r.set('Idempotency-Key', key());
    return method === 'get' ? r : r.send((body ?? {}) as object);
  };
  const userId = async (who: Who) => (await t.prisma.user.findUniqueOrThrow({ where: { email: SEED_USERS[who].email } })).id;
  const userDto = async (who: Who): Promise<UserDto> => (await send('owner', 'get', `/api/v1/users/${await userId(who)}`)).body;

  /** Nhận phòng (tòa A/B) và phát hành thông báo đầu tiên bằng chủ trọ. */
  async function moveIn(building: 'A' | 'B') {
    const room = await createRoom(t, { building });
    const res = await send(
      'owner',
      'post',
      '/api/v1/tenancies/move-in',
      { room_id: room.id, start_date: '2026-10-01', monthly_rent_vnd: '3000000', deposit_required_vnd: '0', primary: { new_tenant: { full_name: `Khách ${building}` } } },
      true,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const draft = (await send('owner', 'get', `/api/v1/invoices?tenancy_id=${res.body.id}&lifecycle=DRAFT`)).body.items[0].id as string;
    const d: InvoiceDetail = (await send('owner', 'get', `/api/v1/invoices/${draft}`)).body;
    const p = await send('owner', 'post', `/api/v1/invoices/${draft}/publish`, { expected_version: d.version, source_hash: d.source_hash });
    expect(p.status).toBe(200);
    return { roomId: room.id, tenancyId: res.body.id as string, invoice: p.body.invoice as InvoiceDetail };
  }

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(t);
    t.clock.set('2026-10-01T03:00:00.000Z');
    for (const w of WHO) s[w] = await login(t, w);
  });
  afterAll(() => t.close());

  it('ma trận quyền mục 11.2 (V1.1): backend chặn đúng theo vai trò', async () => {
    // [mô tả, method, url, ai được phép]
    const matrix: [string, 'post' | 'put' | 'get', string, Who[]][] = [
      ['thêm tòa', 'post', '/api/v1/buildings', ['owner']],
      ['thêm phòng', 'post', '/api/v1/rooms', ['owner', 'managerA']],
      ['nhận phòng', 'post', '/api/v1/tenancies/move-in', ['owner', 'managerA']],
      ['tạo hợp đồng', 'post', `/api/v1/tenancies/${ZERO}/contracts`, ['owner', 'managerA']],
      ['nhập chỉ số', 'get', '/api/v1/meter-readings/sheet', ['owner', 'staffA', 'managerA']],
      ['đặt giá điện nước', 'post', `/api/v1/buildings/${ZERO}/meter-prices`, ['owner']],
      ['tạo nháp thông báo', 'post', '/api/v1/billing/generate', ['owner', 'managerA', 'accountantB']],
      ['phát hành thông báo', 'post', `/api/v1/invoices/${ZERO}/publish`, ['owner', 'accountantB']],
      ['ghi nhận thu', 'post', '/api/v1/payments', ['owner', 'staffA', 'managerA', 'accountantB']],
      ['đảo phiếu thu', 'post', `/api/v1/payments/${ZERO}/reverse`, ['owner']],
      ['báo trả phòng', 'post', `/api/v1/tenancies/${ZERO}/move-out-notices`, ['owner', 'managerA', 'accountantB']],
      ['duyệt quyết toán', 'post', `/api/v1/settlements/${ZERO}/approve`, ['owner']],
      ['báo cáo doanh thu', 'get', '/api/v1/reports/revenue-monthly', ['owner', 'accountantB']],
      ['cấu hình nhắc', 'put', '/api/v1/settings/reminders', ['owner', 'accountantB']],
      ['người dùng', 'get', '/api/v1/users', ['owner']],
      ['nhật ký', 'get', '/api/v1/audit-logs', ['owner', 'managerA', 'accountantB']],
    ];
    const wrong: string[] = [];
    for (const [label, method, url, allowed] of matrix) {
      for (const who of WHO) {
        const status = (await send(who, method, url, {})).status;
        const ok = allowed.includes(who) ? status !== 403 : status === 403;
        if (!ok) wrong.push(`${label} / ${who}: ${status}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('T34 cho vai trò mới: đối tượng tòa khác trả 404; danh sách, dashboard, CSV chỉ trong tòa được giao', async () => {
    const a = await moveIn('A');
    const b = await moveIn('B');
    // Quản lý tòa A
    expect((await send('managerA', 'get', `/api/v1/rooms/${b.roomId}`)).status).toBe(404);
    expect((await send('managerA', 'get', `/api/v1/tenancies/${b.tenancyId}`)).status).toBe(404);
    expect((await send('managerA', 'get', `/api/v1/rooms/${a.roomId}`)).status).toBe(200);
    expect((await send('managerA', 'post', `/api/v1/invoices/${b.invoice.id}/share-links`, {})).status).toBe(404);
    // Kế toán tòa B
    expect((await send('accountantB', 'get', `/api/v1/invoices/${a.invoice.id}`)).status).toBe(404);
    expect((await send('accountantB', 'post', '/api/v1/payments', { tenancy_id: a.tenancyId, amount_vnd: '1000', method: 'CASH', paid_at: '2026-10-01', allocations: [{ invoice_id: a.invoice.id, amount_vnd: '1000' }] }, true)).status).toBe(404);
    const pay = await send('accountantB', 'post', '/api/v1/payments', { tenancy_id: b.tenancyId, amount_vnd: '1000000', method: 'CASH', paid_at: '2026-10-01', allocations: [{ invoice_id: b.invoice.id, amount_vnd: '1000000' }] }, true);
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    const debts = (await send('accountantB', 'get', '/api/v1/debts')).body.items.map((d: { tenancy_id: string }) => d.tenancy_id);
    expect(debts).toEqual([b.tenancyId]);
    const dash = (await send('accountantB', 'get', '/api/v1/dashboard')).body;
    expect(dash.money.debt_vnd).toBe('2000000');
    const csv = await send('accountantB', 'get', '/api/v1/reports/debts/export');
    expect(csv.status).toBe(200);
    expect(csv.text).not.toContain(`Khách A`);
    // Lọc tòa ngoài phạm vi: không lộ số liệu (phạm vi tòa luôn được ghép AND)
    const rev = await send('accountantB', 'get', `/api/v1/reports/revenue-monthly?from=2026-10&to=2026-10&building_id=${SEED_IDS.buildings.A}`);
    expect(rev.body.totals.invoiced_vnd).toBe('0');
  });

  it('quyền riêng: cấp thêm/thu hồi có hiệu lực ngay; không tự cấp cho mình; không cấp quyền chỉ chủ trọ có', async () => {
    const acc = await userDto('accountantB');
    expect(acc.effective_permissions).toContain('payments.record');
    expect(acc.effective_permissions).not.toContain('finance.reverse');
    expect((await send('accountantB', 'post', `/api/v1/payments/${ZERO}/reverse`, {})).status).toBe(403);

    const put = (who: Who, target: string, overrides: unknown, version: number) =>
      send(who, 'put', `/api/v1/users/${target}/permission-overrides`, { overrides, expected_version: version });
    const r = await put('owner', acc.id, [{ permission: 'finance.reverse', granted: true }, { permission: 'payments.record', granted: false }], acc.version);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.permission_overrides).toEqual([
      { permission: 'finance.reverse', granted: true },
      { permission: 'payments.record', granted: false },
    ]);
    // Có hiệu lực ngay (quyền đọc lại từ DB mỗi request), không cần đăng nhập lại
    expect((await send('accountantB', 'post', `/api/v1/payments/${ZERO}/reverse`, {})).status).not.toBe(403);
    expect((await send('accountantB', 'post', '/api/v1/payments', {})).status).toBe(403);
    expect((await send('accountantB', 'get', '/api/v1/auth/me')).body.permissions).toContain('finance.reverse');

    // Sai version → 409
    expect((await put('owner', acc.id, [], acc.version)).status).toBe(409);
    // Không cấp quyền chỉ chủ trọ có
    const now = await userDto('accountantB');
    for (const p of ['users.manage', 'workspace.all_buildings', 'audit.view']) {
      expect((await put('owner', acc.id, [{ permission: p, granted: true }], now.version)).status).toBe(422);
    }
    // Quyền không tồn tại → 400
    expect((await put('owner', acc.id, [{ permission: 'khong.ton.tai', granted: true }], now.version)).status).toBe(400);
    // Không tự sửa quyền/vai trò của mình; không áp quyền riêng cho chủ trọ
    const owner = await userDto('owner');
    expect((await put('owner', owner.id, [], owner.version)).status).toBe(422);
    expect((await send('owner', 'put', `/api/v1/users/${owner.id}/roles`, { role: 'MANAGER', expected_version: owner.version })).status).toBe(422);
    // Người không có users.manage không gọi được
    expect((await put('managerA', (await userDto('managerA')).id, [{ permission: 'reports.view', granted: true }], 1)).status).toBe(403);

    // Đổi vai trò: kế toán → quản lý; quyền riêng vẫn giữ
    const role = await send('owner', 'put', `/api/v1/users/${acc.id}/roles`, { role: 'MANAGER', expected_version: now.version });
    expect(role.status, JSON.stringify(role.body)).toBe(200);
    expect(role.body.roles).toEqual(['MANAGER']);
    expect(role.body.effective_permissions).toContain('tenancies.move_in');
    expect(role.body.effective_permissions).toContain('finance.reverse');
    // Có audit
    const logs = await t.prisma.auditLog.findMany({ where: { action: { in: ['user.set_permission_overrides', 'user.update'] }, entityId: acc.id } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    // Danh sách vai trò
    const roles = (await send('owner', 'get', '/api/v1/roles')).body.map((x: { code: string; assignable: boolean }) => [x.code, x.assignable]);
    expect(roles).toEqual([['OWNER', true], ['MANAGER', true], ['STAFF', false], ['ACCOUNTANT', false]]);
    // Vai trò cũ không gán được qua API (D-041)
    expect((await send('owner', 'put', `/api/v1/users/${acc.id}/roles`, { role: 'ACCOUNTANT', expected_version: role.body.version })).status).toBe(400);
  });

  it('nhật ký: chủ trọ xem toàn bộ; quản lý chỉ vận hành, kế toán chỉ tài chính, đều trong tòa được giao; nhân viên không xem', async () => {
    const a = await moveIn('A');
    const b = await moveIn('B');
    await send('owner', 'post', '/api/v1/rooms', { building_id: SEED_IDS.buildings.B, code: 'B-NK', default_rent_vnd: '2000000', max_occupants: 2 });
    await send('owner', 'put', `/api/v1/users/${await userId('staffA')}/permission-overrides`, { overrides: [], expected_version: (await userDto('staffA')).version });

    const list = async (who: Who, q = ''): Promise<AuditLogDto[]> => {
      const r = await send(who, 'get', `/api/v1/audit-logs?page_size=100${q}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.items;
    };
    const ownerLogs = await list('owner');
    expect(new Set(ownerLogs.map((l) => l.category))).toEqual(new Set(['OPERATIONS', 'FINANCE', 'SYSTEM']));
    expect(ownerLogs.find((l) => l.action === 'tenancy.move_in' && l.entity_id === a.tenancyId)).toMatchObject({ building_code: 'A', actor_name: SEED_USERS.owner.displayName });

    const mgr = await list('managerA');
    expect(mgr.length).toBeGreaterThan(0);
    expect(mgr.every((l) => l.category === 'OPERATIONS' && l.building_code === 'A')).toBe(true);
    expect(mgr.some((l) => l.entity_id === b.tenancyId)).toBe(false);

    const acc = await list('accountantB');
    expect(acc.length).toBeGreaterThan(0);
    expect(acc.every((l) => l.category === 'FINANCE' && l.building_code === 'B')).toBe(true);
    expect(acc.some((l) => l.action === 'invoice.publish' && l.entity_id === b.invoice.id)).toBe(true);
    // Lọc theo nhóm không được phép → rỗng; tòa ngoài phạm vi → 404
    expect(await list('accountantB', '&category=SYSTEM')).toEqual([]);
    expect((await send('managerA', 'get', `/api/v1/audit-logs?building_id=${SEED_IDS.buildings.B}`)).status).toBe(404);
    expect((await send('staffA', 'get', '/api/v1/audit-logs')).status).toBe(403);

    // Lọc theo đối tượng và khoảng ngày
    const byEntity = await list('owner', `&entity_type=invoice&entity_id=${b.invoice.id}`);
    expect(byEntity.map((l) => l.action)).toContain('invoice.publish');
    // Thời điểm nhật ký là giờ thật lúc ghi (không theo đồng hồ nghiệp vụ)
    expect(await list('owner', '&to=2020-01-01')).toEqual([]);
    expect((await list('owner', `&from=${new Date().toISOString().slice(0, 10)}`)).length).toBeGreaterThan(0);
    // Quyền riêng: cho nhân viên xem nhật ký tài chính
    await send('owner', 'put', `/api/v1/users/${await userId('staffA')}/permission-overrides`, {
      overrides: [{ permission: 'audit.view_finance', granted: true }],
      expected_version: (await userDto('staffA')).version,
    });
    const staff = await list('staffA');
    expect(staff.every((l) => l.category === 'FINANCE' && l.building_code === 'A')).toBe(true);
  });
});
