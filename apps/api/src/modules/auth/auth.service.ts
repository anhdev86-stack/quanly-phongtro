import { Inject, Injectable, Logger } from '@nestjs/common';
import { type MeResponse, PERMISSIONS } from '@ql-tro/shared';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppError } from '../../common/errors/app-error.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { burnPasswordCheck, verifyPassword } from './password.js';
import { TokenService } from './token.service.js';

export interface RequestMeta {
  ip: string;
  userAgent: string | undefined;
  requestId: string | undefined;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly limiter: LoginRateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<IssuedSession> {
    if (this.limiter.isBlocked(meta.ip, email)) throw new AppError('TOO_MANY_ATTEMPTS');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      await burnPasswordCheck(password);
      this.limiter.recordFailure(meta.ip, email);
      this.logger.warn({ emailHash: hashForLog(email), requestId: meta.requestId }, 'Đăng nhập sai: email không tồn tại');
      throw new AppError('INVALID_CREDENTIALS');
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      this.limiter.recordFailure(meta.ip, email);
      await this.audit.record(this.prisma, {
        workspaceId: user.workspaceId,
        actorId: null,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        after: { ip: meta.ip },
        requestId: meta.requestId ?? null,
      });
      throw new AppError('INVALID_CREDENTIALS');
    }

    // Chỉ báo "bị vô hiệu hóa" sau khi mật khẩu đúng, để không lộ trạng thái tài khoản.
    if (!user.isActive) throw new AppError('ACCOUNT_DISABLED');
    this.limiter.recordSuccess(meta.ip, email);

    return runInTransaction(this.prisma, async (tx) => {
      const issued = await this.createSession(tx, user, randomUUID(), meta);
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        after: { ip: meta.ip, userAgent: meta.userAgent },
        requestId: meta.requestId ?? null,
      });
      return issued;
    });
  }

  /**
   * Xoay vòng refresh token. Token đã xoay mà bị dùng lại được coi là bị đánh cắp:
   * thu hồi toàn bộ họ phiên (family) rồi trả REFRESH_TOKEN_REUSED.
   */
  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    const parsed = this.tokens.parseRefreshToken(rawToken);
    if (!parsed) throw new AppError('REFRESH_TOKEN_INVALID');

    const outcome = await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'refresh_sessions', [parsed.sessionId]);
      const session = await tx.refreshSession.findUnique({ where: { id: parsed.sessionId }, include: { user: true } });
      if (!session || !this.tokens.secretMatches(parsed.secret, session.tokenHash)) {
        return { kind: 'invalid' as const };
      }
      if (session.revokedAt) return { kind: 'invalid' as const };

      const now = this.clock.now();
      if (session.rotatedAt) {
        await this.revokeFamily(tx, session.familyId, 'reuse_detected', now);
        await this.audit.record(tx, {
          workspaceId: session.user.workspaceId,
          actorId: session.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'refresh_session',
          entityId: session.id,
          after: { familyId: session.familyId, ip: meta.ip },
          requestId: meta.requestId ?? null,
        });
        return { kind: 'reused' as const };
      }
      if (session.expiresAt <= now) return { kind: 'invalid' as const };
      if (!session.user.isActive) {
        await this.revokeFamily(tx, session.familyId, 'account_disabled', now);
        return { kind: 'disabled' as const };
      }

      const issued = await this.createSession(tx, session.user, session.familyId, meta);
      const newSessionId = this.tokens.parseRefreshToken(issued.refreshToken)?.sessionId ?? null;
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { rotatedAt: now, replacedById: newSessionId },
      });
      return { kind: 'ok' as const, issued };
    });

    if (outcome.kind === 'reused') throw new AppError('REFRESH_TOKEN_REUSED');
    if (outcome.kind === 'disabled') throw new AppError('ACCOUNT_DISABLED');
    if (outcome.kind === 'invalid') throw new AppError('REFRESH_TOKEN_INVALID');
    return outcome.issued;
  }

  /** Thu hồi họ phiên hiện tại (từ refresh cookie, hoặc từ access token kể cả đã hết hạn). */
  async logout(rawRefresh: string | undefined, rawAccess: string | undefined, meta: RequestMeta): Promise<void> {
    let sessionId = this.tokens.parseRefreshToken(rawRefresh)?.sessionId;
    if (!sessionId && rawAccess) sessionId = this.tokens.verifyAccessToken(rawAccess, { ignoreExpiration: true })?.sid;
    if (!sessionId) return;

    await runInTransaction(this.prisma, async (tx) => {
      const session = await tx.refreshSession.findUnique({ where: { id: sessionId }, include: { user: true } });
      if (!session) return;
      await this.revokeFamily(tx, session.familyId, 'logout', this.clock.now());
      await this.audit.record(tx, {
        workspaceId: session.user.workspaceId,
        actorId: session.userId,
        action: 'auth.logout',
        entityType: 'refresh_session',
        entityId: session.id,
        requestId: meta.requestId ?? null,
      });
    });
  }

  /** Dựng AuthUser từ access token đã xác minh. Quyền và phạm vi luôn đọc lại từ DB. */
  async loadAuthUser(accessToken: string | undefined): Promise<AuthUser | null> {
    if (!accessToken) return null;
    const payload = this.tokens.verifyAccessToken(accessToken);
    if (!payload) return null;

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true },
    });
    if (!session || session.revokedAt || session.userId !== payload.sub) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        buildingScopes: { select: { buildingId: true } },
      },
    });
    if (!user || !user.isActive || user.workspaceId !== payload.wid) return null;

    const permissions = new Set<string>();
    for (const ur of user.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission.code);

    return {
      id: user.id,
      workspaceId: user.workspaceId,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles.map((r) => r.role.code).sort(),
      permissions,
      allBuildings: permissions.has(PERMISSIONS.WORKSPACE_ALL_BUILDINGS),
      buildingIds: user.buildingScopes.map((s) => s.buildingId),
      sessionId: payload.sid,
    };
  }

  async me(user: AuthUser): Promise<MeResponse> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: user.workspaceId } });
    const buildings = await this.prisma.building.findMany({
      where: {
        workspaceId: user.workspaceId,
        archivedAt: null,
        ...(user.allBuildings ? {} : { id: { in: [...user.buildingIds] } }),
      },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
    return {
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      workspace: { id: workspace.id, name: workspace.name, timezone: workspace.timezone },
      roles: user.roles,
      permissions: [...user.permissions].sort(),
      all_buildings: user.allBuildings,
      buildings,
    };
  }

  private async createSession(
    tx: Prisma.TransactionClient,
    user: { id: string; workspaceId: string },
    familyId: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const refreshExpiresAt = new Date(now.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
    const { secret, hash } = this.tokens.newRefreshSecret();
    const session = await tx.refreshSession.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hash,
        createdAt: now,
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        ip: meta.ip,
      },
      select: { id: true },
    });
    return {
      accessToken: this.tokens.signAccessToken({ sub: user.id, wid: user.workspaceId, sid: session.id }),
      refreshToken: this.tokens.formatRefreshToken(session.id, secret),
      refreshExpiresAt,
    };
  }

  private async revokeFamily(tx: Prisma.TransactionClient, familyId: string, reason: string, at: Date): Promise<void> {
    await tx.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason },
    });
  }
}

function hashForLog(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
