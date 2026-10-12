import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type PaymentAccountDto, type paymentAccountInputSchema, type PublicInvoice, VN_BANKS, type VietQrDto } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { buildVietQr, toTransferText, transferContent } from '../../domain/payments/vietqr.js';
import type { Invoice, PaymentAccount } from '../../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { userNames } from '../utilities/user-names.js';
import { InvoiceBalances } from './balances.js';

/** Hạn của link xem thông báo (MASTER_PLAN 2.2). */
export const SHARE_LINK_DAYS = 60;
const PUBLIC_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_MAX_PER_IP = 60;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Cùng một lỗi cho token sai, hết hạn, bị thu hồi (T59). */
const linkInvalid = () => new AppError('NOT_FOUND', 'Link không còn hiệu lực.');

/**
 * Tài khoản nhận tiền, mã VietQR và link xem thông báo (MASTER_PLAN 9.6). QR không bao giờ đổi trạng thái tiền (T58):
 * chỉ “Ghi nhận thu” mới giảm nợ.
 */
@Injectable()
export class SharingService {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly balances: InvoiceBalances,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------ Tài khoản nhận tiền

  async getAccount(user: AuthUser): Promise<PaymentAccountDto | null> {
    const a = await this.prisma.paymentAccount.findFirst({ where: { workspaceId: user.workspaceId, isActive: true } });
    return a ? accountDto(a) : null;
  }

  /** Đặt/thay tài khoản active (tài khoản cũ ngưng, giữ lịch sử). */
  async putAccount(user: AuthUser, input: z.output<typeof paymentAccountInputSchema>): Promise<PaymentAccountDto> {
    const bank = VN_BANKS.find((b) => b.bin === input.bank_bin);
    if (!bank) throw new AppError('VALIDATION_FAILED', undefined, { bank_bin: ['Ngân hàng không có trong danh sách.'] });
    await runInTransaction(this.prisma, async (tx) => {
      const current = await tx.paymentAccount.findFirst({ where: { workspaceId: user.workspaceId, isActive: true } });
      if (current && input.expected_version !== undefined && current.version !== input.expected_version) throw new AppError('VERSION_CONFLICT');
      if (current) await tx.paymentAccount.update({ where: { id: current.id }, data: { isActive: false, version: { increment: 1 } } });
      const created = await tx.paymentAccount.create({
        data: {
          workspaceId: user.workspaceId,
          bankBin: bank.bin,
          bankName: bank.name,
          accountNumber: input.account_number,
          accountName: toTransferText(input.account_name, 50),
          createdBy: user.id,
        },
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'payment_account.set',
        entityType: 'payment_account',
        entityId: created.id,
        before: current ? { bank_bin: current.bankBin, account_number: current.accountNumber } : null,
        after: { bank_bin: bank.bin, account_number: input.account_number },
      });
    });
    return (await this.getAccount(user))!;
  }

  // ------------------------------------------------------------------ VietQR

  /** QR cho thông báo đã phát hành còn nợ; số tiền = remaining tại thời điểm hiển thị (T57). */
  async invoiceQr(user: AuthUser, invoiceId: string): Promise<VietQrDto> {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } },
      include: { tenancy: { include: { room: true } } },
    });
    if (!inv) throw new AppError('NOT_FOUND');
    const qr = await this.qrFor(this.prisma, inv, inv.tenancy.room.code);
    if (!qr) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ tạo QR cho thông báo đã phát hành còn nợ, khi đã cấu hình tài khoản nhận tiền.');
    return qr;
  }

  private async qrFor(db: Db, inv: Invoice, roomCode: string): Promise<VietQrDto | null> {
    if (inv.lifecycle !== 'PUBLISHED' || inv.type === 'CREDIT_ADJUSTMENT' || !inv.number) return null;
    const remaining = (await this.balances.remaining(db, [inv])).get(inv.id) ?? 0n;
    if (remaining <= 0n) return null;
    const account = await db.paymentAccount.findFirst({ where: { workspaceId: inv.workspaceId, isActive: true } });
    if (!account) return null;
    const content = transferContent(inv.number, roomCode);
    return {
      payload: buildVietQr({ bankBin: account.bankBin, accountNumber: account.accountNumber, amountVnd: remaining, content }),
      bank_bin: account.bankBin,
      bank_name: account.bankName,
      account_number: account.accountNumber,
      account_name: account.accountName,
      amount_vnd: remaining.toString(),
      content,
      is_demo: account.isDemo,
      test_mode: this.config.BANK_INTEGRATION_MODE === 'mock' || this.config.BANK_INTEGRATION_MODE === 'test',
    };
  }

  // ------------------------------------------------------------------ Link xem thông báo

  async createLink(user: AuthUser, invoiceId: string) {
    const inv = await this.invoiceInScope(user, invoiceId);
    if (inv.lifecycle !== 'PUBLISHED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ chia sẻ thông báo đã phát hành.');
    const { link, token } = await runInTransaction(this.prisma, async (tx) => {
      const r = await this.createLinkInTx(tx, user.workspaceId, invoiceId, user.id);
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'share_link.create', entityType: 'invoice', entityId: invoiceId, after: { link_id: r.link.id, expires_at: r.link.expiresAt } });
      return r;
    });
    return { ...(await this.linkDtos([link]))[0]!, token, path: `/p/${token}` };
  }

  /** Tạo link mới; chỉ lưu hash, token chỉ trả về một lần (dùng cả cho tin nhắc đóng tiền). */
  async createLinkInTx(db: Db, workspaceId: string, invoiceId: string, createdBy: string) {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(this.clock.now().getTime() + SHARE_LINK_DAYS * 86_400_000);
    const link = await db.shareLink.create({ data: { workspaceId, invoiceId, tokenHash: hashToken(token), expiresAt: expires, createdBy } });
    return { link, token };
  }

  async listLinks(user: AuthUser, invoiceId: string) {
    await this.invoiceInScope(user, invoiceId);
    return this.linkDtos(await this.prisma.shareLink.findMany({ where: { invoiceId }, orderBy: { createdAt: 'desc' } }));
  }

  async revokeLink(user: AuthUser, linkId: string) {
    const link = await this.prisma.shareLink.findFirst({ where: { id: linkId, workspaceId: user.workspaceId, invoice: { tenancy: { room: this.rooms.roomWhere(user) } } } });
    if (!link) throw new AppError('NOT_FOUND');
    if (!link.revokedAt) {
      await runInTransaction(this.prisma, async (tx) => {
        await tx.shareLink.update({ where: { id: linkId }, data: { revokedAt: this.clock.now(), revokedBy: user.id } });
        await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'share_link.revoke', entityType: 'invoice', entityId: link.invoiceId, after: { link_id: linkId } });
      });
    }
    return (await this.linkDtos([await this.prisma.shareLink.findUniqueOrThrow({ where: { id: linkId } })]))[0]!;
  }

  /** Trang công khai: chỉ thông tin cần để đóng tiền; không CCCD, số điện thoại, địa chỉ hay dữ liệu khác (T59). */
  async publicView(token: string, ip: string): Promise<PublicInvoice> {
    this.throttle(ip);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw linkInvalid();
    const link = await this.prisma.shareLink.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!link || link.revokedAt || link.expiresAt <= this.clock.now()) throw linkInvalid();
    const inv = await this.prisma.invoice.findUnique({
      where: { id: link.invoiceId },
      include: { tenancy: { include: { room: { include: { building: true } } } }, statementPeriod: true, items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!inv || inv.lifecycle !== 'PUBLISHED') throw linkInvalid();
    await this.prisma.shareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: this.clock.now() } });
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: inv.workspaceId } });
    const settled = (await this.balances.settled(this.prisma, [inv.id])).get(inv.id) ?? 0n;
    const remaining = inv.totalVnd > settled ? inv.totalVnd - settled : 0n;
    return {
      workspace_name: workspace.name,
      building_name: inv.tenancy.room.building.name,
      room_code: inv.tenancy.room.code,
      number: inv.number,
      type: inv.type,
      period: inv.statementPeriod ? inv.statementPeriod.monthStart.toISOString().slice(0, 7) : null,
      issue_date: inv.issueDate.toISOString().slice(0, 10),
      due_date: inv.dueDate.toISOString().slice(0, 10),
      items: inv.items.map((i) => ({
        group: (i.calculationSnapshot as { group?: string }).group ?? i.chargeTiming,
        label: i.labelSnapshot,
        direction: i.direction,
        amount_vnd: i.amountVnd.toString(),
      })),
      total_vnd: inv.totalVnd.toString(),
      settled_vnd: settled.toString(),
      remaining_vnd: remaining.toString(),
      qr: await this.qrFor(this.prisma, inv, inv.tenancy.room.code),
    };
  }

  // ------------------------------------------------------------------ Hỗ trợ

  /** Giới hạn truy cập trang công khai theo IP (bộ nhớ một tiến trình — xem D-009). */
  private throttle(ip: string) {
    const now = this.clock.now().getTime();
    const b = this.hits.get(ip);
    if (!b || b.resetAt <= now) {
      this.hits.set(ip, { count: 1, resetAt: now + PUBLIC_WINDOW_MS });
      return;
    }
    b.count++;
    if (b.count > PUBLIC_MAX_PER_IP) throw new AppError('TOO_MANY_ATTEMPTS', 'Truy cập quá nhiều lần. Vui lòng thử lại sau.');
  }

  resetThrottle() {
    this.hits.clear();
  }

  private async invoiceInScope(user: AuthUser, id: string): Promise<Invoice> {
    const inv = await this.prisma.invoice.findFirst({ where: { id, workspaceId: user.workspaceId, tenancy: { room: this.rooms.roomWhere(user) } } });
    if (!inv) throw new AppError('NOT_FOUND');
    return inv;
  }

  private async linkDtos(links: { id: string; expiresAt: Date; revokedAt: Date | null; createdAt: Date; createdBy: string; viewCount: number; lastViewedAt: Date | null }[]) {
    const names = await userNames(this.prisma, links.map((l) => l.createdBy));
    const now = this.clock.now();
    return links.map((l) => ({
      id: l.id,
      expires_at: iso(l.expiresAt)!,
      revoked_at: iso(l.revokedAt),
      created_at: iso(l.createdAt)!,
      created_by_name: names.get(l.createdBy) ?? null,
      view_count: l.viewCount,
      last_viewed_at: iso(l.lastViewedAt),
      active: !l.revokedAt && l.expiresAt > now,
    }));
  }
}

const accountDto = (a: PaymentAccount): PaymentAccountDto => ({
  id: a.id,
  bank_bin: a.bankBin,
  bank_name: a.bankName,
  account_number: a.accountNumber,
  account_name: a.accountName,
  is_demo: a.isDemo,
  version: a.version,
  updated_at: iso(a.updatedAt)!,
});
