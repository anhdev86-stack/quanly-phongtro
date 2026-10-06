import type { Dashboard, InvoiceDetail, ReminderDto } from '@ql-tro/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduledAt } from '../../src/domain/reminders/schedule.js';
import { ChannelRegistry, type MessageChannel, type SendResult } from '../../src/modules/reminders/channels.js';
import { createRoom } from '../helpers/factories.js';
import { CSRF_HEADER, createTestApp, login, resetDatabase, type Session, type TestApp } from '../helpers/test-app.js';

let keySeq = 0;
const key = () => `rm-${Date.now()}-${++keySeq}`;

/** Adapter giả lập cho T64: trả kết quả theo kịch bản, ghi lại số đã nhận. */
class FakeChannel implements MessageChannel {
  readonly sent: { to: string; text: string }[] = [];
  constructor(
    readonly code: string,
    private readonly result: () => SendResult,
  ) {}
  ready() {
    return true;
  }
  async send(to: string, text: string) {
    this.sent.push({ to, text });
    return this.result();
  }
}

describe('Phase 8B — nhắc đóng tiền', () => {
  let t: TestApp;
  let owner: Session;
  let registry: ChannelRegistry;

  const at = async (instant: Date | string) => {
    t.clock.set(typeof instant === 'string' ? instant : instant.toISOString());
    owner = await login(t, 'owner');
  };
  const send = (method: 'post' | 'put', url: string, body: unknown, idem = false) => {
    const r = owner.agent[method](url).set(CSRF_HEADER, owner.csrf);
    if (idem) r.set('Idempotency-Key', key());
    return r.send(body as object);
  };
  const run = async (s: Session = owner) => {
    const r = await s.agent.post('/api/v1/reminders/run').set(CSRF_HEADER, s.csrf).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as { created: number; sent: number; failed: number; skipped: number; retried: number };
  };
  const list = async (q = ''): Promise<ReminderDto[]> => (await owner.agent.get(`/api/v1/reminders?page_size=100${q}`)).body.items;

  async function enable(extra: Record<string, unknown> = {}) {
    const r = await send('put', '/api/v1/settings/reminders', {
      enabled: true,
      channel_order: ['ZALO_ZNS', 'SMS'],
      offsets_days: [-3, 0, 3],
      send_hour: 9,
      quiet_start: 21,
      quiet_end: 7,
      send_to_ended: true,
      ...extra,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  }

  /** Nhận phòng (tòa A/B) và phát hành thông báo đầu tiên. */
  async function tenancy(opts: { building?: 'A' | 'B'; phone?: string | null; consent?: boolean; publish?: boolean } = {}) {
    const room = await createRoom(t, { building: opts.building ?? 'A' });
    const res = await send(
      'post',
      '/api/v1/tenancies/move-in',
      {
        room_id: room.id,
        start_date: '2026-10-01',
        monthly_rent_vnd: '3000000',
        deposit_required_vnd: '0',
        primary: { new_tenant: { full_name: `Khách ${room.code}`, ...(opts.phone !== null ? { phone: opts.phone ?? '0912345678' } : {}) } },
      },
      true,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tenancyId = res.body.id as string;
    const draftId = (await owner.agent.get(`/api/v1/invoices?tenancy_id=${tenancyId}&lifecycle=DRAFT`)).body.items[0].id as string;
    let inv: InvoiceDetail = (await owner.agent.get(`/api/v1/invoices/${draftId}`)).body;
    if (opts.publish !== false) {
      const p = await send('post', `/api/v1/invoices/${draftId}/publish`, { expected_version: inv.version, source_hash: inv.source_hash });
      expect(p.status, JSON.stringify(p.body)).toBe(200);
      inv = p.body.invoice;
    }
    const tenantId = (await owner.agent.get(`/api/v1/tenancies/${tenancyId}`)).body.members.find((m: { role: string }) => m.role === 'PRIMARY').tenant_id as string;
    if (opts.consent !== false) await consent(tenantId, true);
    return { tenancyId, invoice: inv, tenantId };
  }

  async function consent(tenantId: string, optIn: boolean) {
    const tn = (await owner.agent.get(`/api/v1/tenants/${tenantId}`)).body;
    const r = await send('put', `/api/v1/tenants/${tenantId}/reminder-consent`, { opt_in: optIn, note: optIn ? 'Ký phụ lục đồng ý nhận tin' : undefined, expected_version: tn.version });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.reminder_opt_in).toBe(optIn);
  }

  const fake = (...channels: MessageChannel[]) => vi.spyOn(registry, 'resolve').mockReturnValue({ channels, real: true });

  beforeAll(async () => {
    t = await createTestApp();
    registry = t.app.get(ChannelRegistry);
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase(t);
    await at('2026-10-01T03:00:00.000Z');
  });
  afterAll(() => t.close());

  it('T62: job chạy lặp hoặc song song chỉ tạo một tin cho mỗi (thông báo, mốc) và chỉ gửi một lần', async () => {
    const { invoice } = await tenancy();
    await enable();
    // 10:00 ngày đến hạn (giờ VN): chỉ mốc DUE đang trong cửa sổ gửi; mốc trước hạn đã quá 24 giờ.
    await at(new Date(scheduledAt(invoice.due_date, 0, 9).getTime() + 3_600_000));
    const results = await Promise.all([run(), run(), run(), run()]);
    expect(results.reduce((a, r) => a + r.created, 0)).toBe(1);
    expect(results.reduce((a, r) => a + r.sent, 0)).toBe(1);
    expect(await run()).toMatchObject({ created: 0, sent: 0 });
    const msgs = await list();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ milestone: 'DUE', status: 'SENT', channel_used: 'LOG_ONLY', recipient_masked: '09******78', attempt_count: 1 });
    expect(msgs[0]!.attempts).toHaveLength(1);
    // 3 ngày sau hạn: thêm đúng một tin quá hạn
    await at(new Date(scheduledAt(invoice.due_date, 3, 9).getTime() + 60_000));
    await Promise.all([run(), run()]);
    expect((await list()).map((m) => m.milestone).sort()).toEqual(['DUE', 'OVERDUE']);
    // Gửi tin không đổi trạng thái tiền
    const after: InvoiceDetail = (await owner.agent.get(`/api/v1/invoices/${invoice.id}`)).body;
    expect(after.remaining_vnd).toBe(invoice.total_vnd);
  });

  it('T63: không gửi cho nháp, người chưa đồng ý, không có số; trả đủ hoặc tắt nhận tin sau khi lập lịch → SKIPPED; tôn trọng giờ yên lặng', async () => {
    const ok = await tenancy();
    const paidLater = await tenancy();
    const optOutLater = await tenancy();
    await tenancy({ publish: false }); // nháp
    await tenancy({ consent: false }); // chưa đồng ý
    await tenancy({ phone: null }); // không có số → không bật được nhắc có ý nghĩa
    await tenancy({ phone: '0212345678' }); // số bàn, không phải di động
    await enable();
    const due = ok.invoice.due_date;

    // 22:00 ngày đến hạn: giờ yên lặng → không tạo, không gửi
    await at(new Date(scheduledAt(due, 0, 22).getTime()));
    expect(await run()).toMatchObject({ created: 0, sent: 0 });
    expect(await list()).toHaveLength(0);

    // 07:30 hôm sau: hết giờ yên lặng, còn trong cửa sổ 24 giờ của mốc DUE. Kênh lỗi tạm thời → tin chờ thử lại.
    await at(new Date(scheduledAt(due, 1, 7).getTime() + 30 * 60_000));
    const flaky = new FakeChannel('ZALO_ZNS', () => ({ ok: false, code: 'TIMEOUT', message: 'timeout', transient: true }));
    fake(flaky);
    const r1 = await run();
    expect(r1).toMatchObject({ created: 3, retried: 3 });
    expect(new Set((await list()).map((m) => m.invoice_id))).toEqual(new Set([ok.invoice.id, paidLater.invoice.id, optOutLater.invoice.id]));

    // Trả đủ và tắt nhận tin sau khi đã lập lịch
    const pay = await send(
      'post',
      '/api/v1/payments',
      { tenancy_id: paidLater.tenancyId, amount_vnd: paidLater.invoice.total_vnd, method: 'CASH', paid_at: due, allocations: [{ invoice_id: paidLater.invoice.id, amount_vnd: paidLater.invoice.total_vnd }] },
      true,
    );
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    await consent(optOutLater.tenantId, false);
    const optedOut = (await list()).find((m) => m.invoice_id === optOutLater.invoice.id)!;
    expect(optedOut).toMatchObject({ status: 'SKIPPED', skip_reason: 'OPTED_OUT' });

    vi.restoreAllMocks();
    await at(new Date(scheduledAt(due, 1, 7).getTime() + 40 * 60_000));
    expect(await run()).toMatchObject({ sent: 1, skipped: 1 });
    const byInvoice = new Map((await list()).map((m) => [m.invoice_id, m]));
    expect(byInvoice.get(ok.invoice.id)).toMatchObject({ status: 'SENT', channel_used: 'LOG_ONLY' });
    expect(byInvoice.get(paidLater.invoice.id)).toMatchObject({ status: 'SKIPPED', skip_reason: 'PAID' });

    // Đồng ý nhận tin phải có ghi chú cách đồng ý
    const tn = (await owner.agent.get(`/api/v1/tenants/${optOutLater.tenantId}`)).body;
    expect((await send('put', `/api/v1/tenants/${optOutLater.tenantId}/reminder-consent`, { opt_in: true, expected_version: tn.version })).status).toBe(400);
  });

  it('T64: kênh đầu lỗi chuyển kênh dự phòng; lỗi tạm thời thử lại có giới hạn rồi FAILED; việc cần xử lý; gửi lại thủ công; log che số', async () => {
    const a = await tenancy({ phone: '0987654321' });
    const settings = await enable();
    // Ngoài production luôn chỉ ghi log
    expect(settings).toMatchObject({ real_sending: false });
    expect(settings.channels.every((c: { configured: boolean }) => !c.configured)).toBe(true);
    expect(registry.resolve(true, ['ZALO_ZNS', 'SMS']).channels.map((c) => c.code)).toEqual(['LOG_ONLY']);

    // Kênh đầu lỗi cố định → SMS gửi được
    const zalo = new FakeChannel('ZALO_ZNS', () => ({ ok: false, code: 'TEMPLATE_REJECTED', message: 'Số 0987654321 chưa quan tâm OA', transient: false }));
    const sms = new FakeChannel('SMS', () => ({ ok: true, providerMessageId: 'sms-1' }));
    fake(zalo, sms);
    await at(scheduledAt(a.invoice.due_date, -3, 9));
    expect(await run()).toMatchObject({ created: 1, sent: 1 });
    let m = (await list())[0]!;
    expect(m).toMatchObject({ status: 'SENT', channel_used: 'SMS', milestone: 'BEFORE_DUE' });
    expect(m.attempts.map((x) => [x.channel, x.result])).toEqual([
      ['ZALO_ZNS', 'FAILED'],
      ['SMS', 'SUCCESS'],
    ]);
    // Lỗi lưu đã che số điện thoại; nội dung tin có link xem thông báo
    expect(m.attempts[0]!.error_message).toBe('Số 09******21 chưa quan tâm OA');
    expect(sms.sent[0]!.text).toMatch(/^Nhà trọ .+: Phòng .+ còn 3\.000\.000đ, sắp đến hạn .+ Xem và quét QR: http:\/\/localhost:3000\/p\/[A-Za-z0-9_-]{40,}$/);
    const token = sms.sent[0]!.text.split('/p/')[1]!;
    expect((await owner.agent.get(`/api/v1/public/invoices/${token}`)).status).toBe(200);

    // Mốc đúng hạn: mọi kênh lỗi tạm thời → thử lại 5, 15 phút rồi FAILED ở lần thứ 3
    vi.restoreAllMocks();
    const down = new FakeChannel('ZALO_ZNS', () => ({ ok: false, code: 'HTTP_503', message: 'Service unavailable', transient: true }));
    fake(down);
    const t0 = scheduledAt(a.invoice.due_date, 0, 9).getTime();
    await at(new Date(t0));
    expect(await run()).toMatchObject({ created: 1, retried: 1 });
    await at(new Date(t0 + 4 * 60_000));
    expect(await run()).toMatchObject({ retried: 0, failed: 0 }); // chưa tới giờ thử lại
    await at(new Date(t0 + 5 * 60_000));
    expect(await run()).toMatchObject({ retried: 1 });
    await at(new Date(t0 + 20 * 60_000));
    expect(await run()).toMatchObject({ failed: 1 });
    await at(new Date(t0 + 120 * 60_000));
    expect(await run()).toMatchObject({ created: 0, sent: 0, failed: 0, retried: 0 });
    m = (await list('&status=FAILED'))[0]!;
    expect(m).toMatchObject({ milestone: 'DUE', attempt_count: 3 });
    expect(down.sent).toHaveLength(3);

    // FAILED hiện trong việc cần xử lý
    const dash: Dashboard = (await owner.agent.get('/api/v1/dashboard')).body;
    expect(dash.todo.find((x) => x.kind === 'REMINDERS_FAILED')).toMatchObject({ count: 1, href: '/reminders?status=FAILED' });

    // Nhân viên chỉ xem; nhân viên tòa khác không thấy
    const staffA = await login(t, 'staffA');
    expect((await staffA.agent.get('/api/v1/reminders')).body.total).toBe(2);
    expect((await staffA.agent.post(`/api/v1/reminders/${m.id}/resend`).set(CSRF_HEADER, staffA.csrf).send({})).status).toBe(403);
    const staffBC = await login(t, 'staffBC');
    expect((await staffBC.agent.get('/api/v1/reminders')).body.total).toBe(0);

    // Gửi lại thủ công: thêm một lần thử cho cùng tin, có audit
    vi.restoreAllMocks();
    const r = await send('post', `/api/v1/reminders/${m.id}/resend`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ id: m.id, status: 'SENT', channel_used: 'LOG_ONLY', attempt_count: 4 });
    expect(r.body.attempts.at(-1)).toMatchObject({ manual: true, result: 'SUCCESS' });
    expect(await list()).toHaveLength(2);
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'reminder.resend' } });
    expect(audit).not.toBeNull();
    // Không có số điện thoại thật trong nhật ký gửi
    const attempts = await t.prisma.reminderAttempt.findMany();
    expect(JSON.stringify(attempts)).not.toContain('0987654321');
    // Giờ yên lặng chặn gửi lại
    await at(new Date(scheduledAt(a.invoice.due_date, 0, 23)));
    expect((await send('post', `/api/v1/reminders/${m.id}/resend`, {})).status).toBe(422);
  });

  it('cấu hình: kiểm tra mốc, giờ gửi; tắt nhắc hủy tin chờ; nhân viên không sửa được', async () => {
    expect((await owner.agent.get('/api/v1/settings/reminders')).body).toMatchObject({ enabled: false, offsets_days: [-3, 0, 3], send_hour: 9 });
    const bad = (extra: object) => send('put', '/api/v1/settings/reminders', { enabled: true, channel_order: ['SMS'], offsets_days: [-3, 0, 3], send_hour: 9, quiet_start: 21, quiet_end: 7, send_to_ended: true, ...extra });
    expect((await bad({ offsets_days: [-3, -1] })).status).toBe(400);
    expect((await bad({ send_hour: 22 })).status).toBe(400);
    expect((await bad({ channel_order: ['SMS', 'SMS'] })).status).toBe(400);
    const staffA = await login(t, 'staffA');
    expect((await staffA.agent.get('/api/v1/settings/reminders')).status).toBe(200);
    expect((await staffA.agent.put('/api/v1/settings/reminders').set(CSRF_HEADER, staffA.csrf).send({})).status).toBe(403);

    const a = await tenancy();
    await enable();
    await at(new Date(scheduledAt(a.invoice.due_date, 0, 9)));
    fake(new FakeChannel('SMS', () => ({ ok: false, code: 'TIMEOUT', message: 't', transient: true })));
    expect(await run()).toMatchObject({ created: 1, retried: 1 });
    const s = (await owner.agent.get('/api/v1/settings/reminders')).body;
    await enable({ enabled: false, expected_version: s.version });
    expect((await list())[0]).toMatchObject({ status: 'CANCELLED' });
    expect(await run()).toMatchObject({ created: 0 });
  });
});
