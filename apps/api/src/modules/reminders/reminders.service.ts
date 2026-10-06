import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  type Paged,
  type ReminderDto,
  type reminderConsentSchema,
  type reminderListQuerySchema,
  type ReminderSettingsDto,
  type reminderSettingsInputSchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { day, iso, paged } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { addDays, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import {
  backoffMinutes,
  isQuietHour,
  localHour,
  MAX_ATTEMPTS,
  maskPhone,
  maskPhonesIn,
  milestoneOf,
  normalizeVnMobile,
  type ReminderContent,
  renderReminder,
  scheduledAt,
  validateOffsets,
} from '../../domain/reminders/schedule.js';
import type { Prisma, ReminderMessage, ReminderSettings } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { InvoiceBalances } from '../payments/balances.js';
import { SharingService } from '../payments/sharing.service.js';
import type { DashboardTodoExtension } from '../reports/reports.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ChannelRegistry } from './channels.js';

const JOB_INTERVAL_MS = 15 * 60 * 1000;
/** Tin chỉ được tạo trong 24 giờ sau thời điểm gửi của mốc (không gửi bù mốc đã quá lâu). */
const SEND_WINDOW_MS = 24 * 3_600_000;
/** Thời gian “giữ” tin đang gửi; tiến trình chết giữa chừng thì tin quay về PENDING sau khoảng này. */
const SENDING_LEASE_MS = 10 * 60 * 1000;
/** Khóa advisory (transaction-level) để hai tiến trình không lập lịch chồng nhau. */
const SCHEDULE_LOCK_KEY = 8_250_001;

export interface RunResult {
  created: number;
  sent: number;
  failed: number;
  skipped: number;
  retried: number;
}

const emptyRun = (): RunResult => ({ created: 0, sent: 0, failed: 0, skipped: 0, retried: 0 });

const DEFAULTS = { enabled: false, channelOrder: ['ZALO_ZNS', 'SMS'], offsetsDays: [-3, 0, 3], sendHour: 9, quietStart: 21, quietEnd: 7, sendToEnded: true, version: 0 };
type Settings = typeof DEFAULTS;

const toSettings = (s: ReminderSettings | null): Settings =>
  s
    ? {
        enabled: s.enabled,
        channelOrder: s.channelOrder as string[],
        offsetsDays: s.offsetsDays as number[],
        sendHour: s.sendHour,
        quietStart: s.quietStart,
        quietEnd: s.quietEnd,
        sendToEnded: s.sendToEnded,
        version: s.version,
      }
    : DEFAULTS;

const messageInclude = {
  invoice: { include: { tenancy: { include: { room: { include: { building: true } } } } } },
  attempts: { orderBy: { attemptedAt: 'asc' } },
} satisfies Prisma.ReminderMessageInclude;

/**
 * Nhắc đóng tiền qua Zalo/SMS (MASTER_PLAN 9.7). Gửi tin không đổi trạng thái tiền. Unique (invoice, milestone)
 * chặn tin trùng; tin được “giành” bằng cập nhật có điều kiện PENDING → SENDING nên chạy song song không gửi hai lần.
 */
@Injectable()
export class RemindersService implements DashboardTodoExtension, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly balances: InvoiceBalances,
    private readonly sharing: SharingService,
    private readonly audit: AuditService,
    private readonly registry: ChannelRegistry,
    private readonly tenants: TenantsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ Job

  onApplicationBootstrap() {
    if (!this.config.REMINDER_JOB_ENABLED || this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), JOB_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const all = await this.prisma.reminderSettings.findMany({ select: { workspaceId: true } });
      for (const { workspaceId } of all) {
        const r = await this.runWorkspace(workspaceId, null);
        if (r.created || r.sent || r.failed || r.skipped) this.logger.log(`Nhắc đóng tiền ${workspaceId}: ${JSON.stringify(r)}`);
      }
    } catch (e) {
      this.logger.error(`Job nhắc đóng tiền lỗi: ${maskPhonesIn(e instanceof Error ? e.message : String(e))}`);
    } finally {
      this.running = false;
    }
  }

  /** Chạy ngay một vòng cho nhà trọ của người dùng (nút “Chạy nhắc ngay”, cũng dùng trong test). */
  async runNow(user: AuthUser): Promise<RunResult> {
    return this.runWorkspace(user.workspaceId, user.id);
  }

  async runWorkspace(workspaceId: string, actorId: string | null): Promise<RunResult> {
    const settings = toSettings(await this.prisma.reminderSettings.findUnique({ where: { workspaceId } }));
    const result = emptyRun();
    if (!settings.enabled) return result;
    const quiet = isQuietHour(localHour(this.clock.now()), settings.quietStart, settings.quietEnd);
    if (quiet) return result;
    result.created = await this.schedule(workspaceId, settings);
    await this.releaseStaleLeases(workspaceId);
    const due = await this.prisma.reminderMessage.findMany({
      where: { workspaceId, status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: this.clock.now() } }] },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    });
    for (const m of due) {
      const claimed = await this.prisma.reminderMessage.updateMany({
        where: { id: m.id, status: 'PENDING' },
        data: { status: 'SENDING', nextAttemptAt: new Date(this.clock.now().getTime() + SENDING_LEASE_MS) },
      });
      if (claimed.count !== 1) continue;
      const outcome = await this.deliver(m, settings, actorId, false);
      result[outcome]++;
    }
    return result;
  }

  // ------------------------------------------------------------------ Lập lịch

  /** Tạo tin PENDING cho các mốc đã tới giờ gửi (trong cửa sổ 24 giờ). Trả số tin mới. */
  private async schedule(workspaceId: string, s: Settings): Promise<number> {
    const now = this.clock.now();
    const today = this.clock.today();
    const lo = Math.min(...s.offsetsDays);
    const hi = Math.max(...s.offsetsDays);
    return runInTransaction(this.prisma, async (tx) => {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SCHEDULE_LOCK_KEY}::int, hashtext(${workspaceId}::text)) AS ok`;
      if (!lock?.ok) return 0;
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      // Hạn đóng sao cho (hạn + offset) rơi vào hôm qua…hôm nay.
      const invoices = await tx.invoice.findMany({
        where: {
          workspaceId,
          lifecycle: 'PUBLISHED',
          type: { not: 'CREDIT_ADJUSTMENT' },
          number: { not: null },
          dueDate: { gte: toDbDate(addDays(today, -hi - 1)), lte: toDbDate(addDays(today, -lo + 1)) },
          tenancy: { ...(s.sendToEnded ? {} : { status: { not: 'ENDED' } }), room: { archivedAt: null } },
        },
        include: { tenancy: { include: { room: true, members: { where: { role: 'PRIMARY' }, include: { tenant: true }, orderBy: { joinedOn: 'desc' } } } }, statementPeriod: true },
      });
      if (!invoices.length) return 0;
      const remaining = await this.balances.remaining(tx, invoices);
      const rows: Prisma.ReminderMessageCreateManyInput[] = [];
      for (const inv of invoices) {
        const left = remaining.get(inv.id) ?? 0n;
        if (left <= 0n) continue;
        const primary = inv.tenancy.members.find((m) => !m.leftOnExclusive) ?? inv.tenancy.members[0];
        const tenant = primary?.tenant;
        if (!tenant?.reminderOptIn) continue;
        const phone = normalizeVnMobile(tenant.phone);
        if (!phone) continue;
        const due = fromDbDate(inv.dueDate);
        for (const offset of s.offsetsDays) {
          const at = scheduledAt(due, offset, s.sendHour);
          if (now < at || now.getTime() >= at.getTime() + SEND_WINDOW_MS) continue;
          const content: ReminderContent = {
            workspace_name: workspace.name,
            room_code: inv.tenancy.room.code,
            period: inv.statementPeriod ? fromDbDate(inv.statementPeriod.monthStart).slice(0, 7) : null,
            invoice_number: inv.number!,
            remaining_vnd: left.toString(),
            due_date: due,
            milestone: milestoneOf(offset),
          };
          rows.push({
            workspaceId,
            invoiceId: inv.id,
            tenantId: tenant.id,
            milestone: milestoneOf(offset),
            offsetDays: offset,
            scheduledFor: at,
            recipientMasked: maskPhone(phone),
            contentSnapshot: content as unknown as Prisma.InputJsonValue,
          });
        }
      }
      if (!rows.length) return 0;
      // Unique (invoice_id, milestone): chạy lại hoặc song song không tạo trùng (T62).
      return (await tx.reminderMessage.createMany({ data: rows, skipDuplicates: true })).count;
    });
  }

  /** Tin SENDING quá thời gian giữ (tiến trình gửi bị dừng) quay lại PENDING. */
  private async releaseStaleLeases(workspaceId: string) {
    await this.prisma.reminderMessage.updateMany({ where: { workspaceId, status: 'SENDING', nextAttemptAt: { lte: this.clock.now() } }, data: { status: 'PENDING', nextAttemptAt: null } });
  }

  // ------------------------------------------------------------------ Gửi

  /** Lý do bỏ qua khi kiểm tra lại ngay trước lúc gửi; null nếu vẫn gửi. */
  private async skipReason(m: ReminderMessage, s: Settings): Promise<{ reason: string | null; phone: string | null }> {
    const inv = await this.prisma.invoice.findUniqueOrThrow({ where: { id: m.invoiceId }, include: { tenancy: true } });
    if (inv.lifecycle === 'CANCELLED') return { reason: 'CANCELLED', phone: null };
    if (inv.lifecycle !== 'PUBLISHED') return { reason: 'NOT_PUBLISHED', phone: null };
    const left = (await this.balances.remaining(this.prisma, [inv])).get(inv.id) ?? 0n;
    if (left <= 0n) return { reason: 'PAID', phone: null };
    if (inv.tenancy.status === 'ENDED' && !s.sendToEnded) return { reason: 'TENANCY_ENDED', phone: null };
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: m.tenantId } });
    if (!tenant.reminderOptIn) return { reason: 'OPTED_OUT', phone: null };
    const phone = normalizeVnMobile(tenant.phone);
    if (!phone) return { reason: 'NO_PHONE', phone: null };
    return { reason: null, phone };
  }

  /** Gửi một tin đã được giành (status SENDING). */
  private async deliver(m: ReminderMessage, s: Settings, actorId: string | null, manual: boolean): Promise<'sent' | 'failed' | 'skipped' | 'retried'> {
    const { reason, phone } = await this.skipReason(m, s);
    if (reason || !phone) {
      await this.prisma.reminderMessage.update({ where: { id: m.id }, data: { status: 'SKIPPED', skipReason: reason ?? 'NO_PHONE', nextAttemptAt: null, sentAt: null, channelUsed: null } });
      return 'skipped';
    }
    // Link xem thông báo kèm QR: tạo mới mỗi lượt gửi (chỉ lưu hash), thu hồi link của lượt trước.
    const createdBy = actorId ?? (await this.ownerId(m.workspaceId));
    const { token } = await runInTransaction(this.prisma, async (tx) => {
      if (m.shareLinkId) await tx.shareLink.updateMany({ where: { id: m.shareLinkId, revokedAt: null }, data: { revokedAt: this.clock.now(), revokedBy: createdBy } });
      const r = await this.sharing.createLinkInTx(tx, m.workspaceId, m.invoiceId, createdBy);
      await tx.reminderMessage.update({ where: { id: m.id }, data: { shareLinkId: r.link.id } });
      return r;
    });
    const text = renderReminder(m.contentSnapshot as unknown as ReminderContent, `${this.config.PUBLIC_BASE_URL.replace(/\/$/, '')}/p/${token}`);

    const { channels } = this.registry.resolve(s.enabled, s.channelOrder);
    let transient = false;
    for (const ch of channels) {
      let r: Awaited<ReturnType<typeof ch.send>>;
      try {
        r = await ch.send(phone, text, { messageId: m.id });
      } catch (e) {
        r = { ok: false, code: 'CHANNEL_ERROR', message: e instanceof Error ? e.message : String(e), transient: true };
      }
      const at = this.clock.now();
      await this.prisma.reminderAttempt.create({
        data: {
          messageId: m.id,
          channel: ch.code,
          attemptedAt: at,
          result: r.ok ? 'SUCCESS' : 'FAILED',
          providerMessageId: r.ok ? r.providerMessageId : null,
          errorCode: r.ok ? null : r.code.slice(0, 100),
          errorMessage: r.ok ? null : maskPhonesIn(r.message).slice(0, 500),
          manual,
        },
      });
      if (r.ok) {
        await this.prisma.reminderMessage.update({
          where: { id: m.id },
          data: { status: 'SENT', sentAt: at, channelUsed: ch.code, attemptCount: { increment: 1 }, nextAttemptAt: null, skipReason: null },
        });
        return 'sent';
      }
      transient ||= r.transient;
    }
    const attempts = m.attemptCount + 1;
    if (transient && attempts < MAX_ATTEMPTS) {
      await this.prisma.reminderMessage.update({
        where: { id: m.id },
        data: { status: 'PENDING', attemptCount: attempts, nextAttemptAt: new Date(this.clock.now().getTime() + backoffMinutes(attempts) * 60_000), sentAt: null, channelUsed: null },
      });
      return 'retried';
    }
    await this.prisma.reminderMessage.update({ where: { id: m.id }, data: { status: 'FAILED', attemptCount: attempts, nextAttemptAt: null, sentAt: null, channelUsed: null } });
    return 'failed';
  }

  private async ownerId(workspaceId: string): Promise<string> {
    const owner = await this.prisma.user.findFirst({ where: { workspaceId, roles: { some: { role: { code: 'OWNER' } } } }, orderBy: { createdAt: 'asc' } });
    if (!owner) throw new Error('Workspace không có chủ trọ.');
    return owner.id;
  }

  /** Gửi lại thủ công: thêm một lượt thử cho cùng tin (không tạo tin mới, giữ unique theo mốc). */
  async resend(user: AuthUser, id: string): Promise<ReminderDto> {
    const m = await this.messageInScope(user, id);
    const s = toSettings(await this.prisma.reminderSettings.findUnique({ where: { workspaceId: user.workspaceId } }));
    if (!s.enabled) throw new AppError('BUSINESS_RULE_VIOLATION', 'Nhắc đóng tiền đang tắt. Bật trong cấu hình trước khi gửi lại.');
    if (isQuietHour(localHour(this.clock.now()), s.quietStart, s.quietEnd)) {
      throw new AppError('BUSINESS_RULE_VIOLATION', `Đang trong giờ yên lặng (${s.quietStart}:00–${s.quietEnd}:00), không gửi tin.`);
    }
    const claimed = await this.prisma.reminderMessage.updateMany({
      where: { id, status: { in: ['FAILED', 'SKIPPED', 'SENT', 'CANCELLED'] } },
      data: { status: 'SENDING', sentAt: null, channelUsed: null, skipReason: null, nextAttemptAt: new Date(this.clock.now().getTime() + SENDING_LEASE_MS) },
    });
    if (claimed.count !== 1) throw new AppError('CONFLICT', 'Tin đang chờ gửi hoặc đang gửi.');
    await this.audit.record(this.prisma, {
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: 'reminder.resend',
      entityType: 'invoice',
      entityId: m.invoiceId,
      before: { reminder_id: id, status: m.status },
      after: null,
    });
    // Gửi lại thủ công vẫn kiểm tra lại đối tượng; không bị giới hạn số lần thử tự động.
    await this.deliver({ ...m, attemptCount: 0 }, s, user.id, true);
    return this.get(user, id);
  }

  // ------------------------------------------------------------------ Cấu hình

  async getSettings(user: AuthUser): Promise<ReminderSettingsDto> {
    const s = toSettings(await this.prisma.reminderSettings.findUnique({ where: { workspaceId: user.workspaceId } }));
    const { real } = this.registry.resolve(s.enabled, s.channelOrder);
    return {
      enabled: s.enabled,
      channel_order: s.channelOrder as ('ZALO_ZNS' | 'SMS')[],
      offsets_days: s.offsetsDays,
      send_hour: s.sendHour,
      quiet_start: s.quietStart,
      quiet_end: s.quietEnd,
      send_to_ended: s.sendToEnded,
      version: s.version,
      channels: this.registry.status(),
      real_sending: real,
      note: real
        ? 'Đang gửi tin thật qua nhà cung cấp.'
        : 'Chưa gửi tin thật: hệ thống chỉ ghi log (LogOnlyChannel). Gửi thật cần môi trường production, bật nhắc và adapter Zalo/SMS đã được kiểm chứng với tài khoản của chủ trọ.',
    };
  }

  async putSettings(user: AuthUser, input: z.output<typeof reminderSettingsInputSchema>): Promise<ReminderSettingsDto> {
    const err = validateOffsets(input.offsets_days);
    if (err) throw new AppError('VALIDATION_FAILED', undefined, { offsets_days: [err] });
    if (new Set(input.channel_order).size !== input.channel_order.length) throw new AppError('VALIDATION_FAILED', undefined, { channel_order: ['Kênh bị trùng.'] });
    if (isQuietHour(input.send_hour, input.quiet_start, input.quiet_end)) {
      throw new AppError('VALIDATION_FAILED', undefined, { send_hour: ['Giờ gửi nằm trong giờ yên lặng.'] });
    }
    await runInTransaction(this.prisma, async (tx) => {
      const current = await tx.reminderSettings.findUnique({ where: { workspaceId: user.workspaceId } });
      if (current && input.expected_version !== undefined && current.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      const data = {
        enabled: input.enabled,
        channelOrder: input.channel_order,
        offsetsDays: [...input.offsets_days].sort((a, b) => a - b),
        sendHour: input.send_hour,
        quietStart: input.quiet_start,
        quietEnd: input.quiet_end,
        sendToEnded: input.send_to_ended,
      };
      if (current) await tx.reminderSettings.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } });
      else await tx.reminderSettings.create({ data: { ...data, workspaceId: user.workspaceId } });
      // Tắt nhắc: các tin chưa gửi bị hủy ngay.
      if (!input.enabled) await tx.reminderMessage.updateMany({ where: { workspaceId: user.workspaceId, status: 'PENDING' }, data: { status: 'CANCELLED', skipReason: 'DISABLED', nextAttemptAt: null } });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'reminder_settings.update',
        entityType: 'reminder_settings',
        entityId: user.workspaceId,
        before: current ? toSettings(current) : null,
        after: data,
      });
    });
    return this.getSettings(user);
  }

  // ------------------------------------------------------------------ Đồng ý nhận tin

  async setConsent(user: AuthUser, tenantId: string, input: z.output<typeof reminderConsentSchema>) {
    const tenant = await this.tenants.getRow(this.prisma, user, tenantId);
    if (tenant.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
    await runInTransaction(this.prisma, async (tx) => {
      const r = await tx.tenant.updateMany({
        where: { id: tenantId, version: input.expected_version },
        data: input.opt_in
          ? { reminderOptIn: true, reminderConsentAt: this.clock.now(), reminderConsentNote: input.note ?? null, version: { increment: 1 } }
          : { reminderOptIn: false, version: { increment: 1 } },
      });
      if (r.count !== 1) throw new AppError('VERSION_CONFLICT');
      // Tắt nhận tin có hiệu lực ngay với tin chưa gửi.
      if (!input.opt_in) await tx.reminderMessage.updateMany({ where: { tenantId, status: 'PENDING' }, data: { status: 'SKIPPED', skipReason: 'OPTED_OUT', nextAttemptAt: null } });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: input.opt_in ? 'tenant.reminder_opt_in' : 'tenant.reminder_opt_out',
        entityType: 'tenant',
        entityId: tenantId,
        before: { reminder_opt_in: tenant.reminderOptIn },
        after: { reminder_opt_in: input.opt_in, note: input.note ?? null },
      });
    });
  }

  // ------------------------------------------------------------------ Danh sách

  private scopeWhere(user: AuthUser, buildingId?: string): Prisma.ReminderMessageWhereInput {
    return {
      workspaceId: user.workspaceId,
      invoice: { tenancy: { room: { AND: [this.rooms.roomWhere(user), ...(buildingId ? [{ buildingId }] : [])] } } },
    };
  }

  async failedReminders(user: AuthUser, buildingId?: string): Promise<number> {
    return this.prisma.reminderMessage.count({ where: { AND: [this.scopeWhere(user, buildingId), { status: 'FAILED' }] } });
  }

  async list(user: AuthUser, q: z.output<typeof reminderListQuerySchema>): Promise<Paged<ReminderDto>> {
    const rows = await this.prisma.reminderMessage.findMany({
      where: { AND: [this.scopeWhere(user, q.building_id), q.status ? { status: q.status } : {}, q.invoice_id ? { invoiceId: q.invoice_id } : {}] },
      include: messageInclude,
      orderBy: [{ scheduledFor: 'desc' }, { milestone: 'desc' }],
    });
    const page = paged(rows, q.page, q.page_size);
    return { ...page, items: await this.dtos(page.items) };
  }

  async get(user: AuthUser, id: string): Promise<ReminderDto> {
    await this.messageInScope(user, id);
    return (await this.dtos([await this.prisma.reminderMessage.findUniqueOrThrow({ where: { id }, include: messageInclude })]))[0]!;
  }

  private async messageInScope(user: AuthUser, id: string): Promise<ReminderMessage> {
    const m = await this.prisma.reminderMessage.findFirst({ where: { AND: [{ id }, this.scopeWhere(user)] } });
    if (!m) throw new AppError('NOT_FOUND');
    return m;
  }

  private async dtos(rows: Prisma.ReminderMessageGetPayload<{ include: typeof messageInclude }>[]): Promise<ReminderDto[]> {
    if (!rows.length) return [];
    const remaining = await this.balances.remaining(this.prisma, rows.map((r) => r.invoice));
    const tenants = await this.prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, fullName: true } });
    const names = new Map(tenants.map((t) => [t.id, t.fullName]));
    return rows.map((r) => ({
      id: r.id,
      invoice_id: r.invoiceId,
      invoice_number: r.invoice.number,
      room_code: r.invoice.tenancy.room.code,
      building_code: r.invoice.tenancy.room.building.code,
      tenant_name: names.get(r.tenantId) ?? null,
      milestone: r.milestone,
      scheduled_for: iso(r.scheduledFor)!,
      status: r.status,
      skip_reason: r.skipReason,
      channel_used: r.channelUsed,
      recipient_masked: r.recipientMasked,
      remaining_vnd: (r.invoice.lifecycle === 'PUBLISHED' ? (remaining.get(r.invoiceId) ?? 0n) : 0n).toString(),
      attempt_count: r.attemptCount,
      sent_at: iso(r.sentAt),
      due_date: day(r.invoice.dueDate),
      attempts: r.attempts.map((a) => ({
        channel: a.channel,
        attempted_at: iso(a.attemptedAt)!,
        result: a.result,
        error_code: a.errorCode,
        error_message: a.errorMessage,
        manual: a.manual,
      })),
    }));
  }
}
