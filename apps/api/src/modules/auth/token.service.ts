import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';

export interface AccessTokenPayload {
  sub: string;
  wid: string;
  sid: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Access token: JWT HS256 ngắn hạn, thời gian lấy từ Clock (test được hết hạn).
 * Refresh token: chuỗi ngẫu nhiên `<sessionId>.<secret>`; DB chỉ lưu SHA-256 của secret.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  signAccessToken(payload: AccessTokenPayload): string {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    return jwt.sign({ ...payload, iat, exp: iat + this.config.ACCESS_TOKEN_TTL_SECONDS }, this.config.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      noTimestamp: true,
    });
  }

  /** Trả payload nếu hợp lệ, null nếu sai chữ ký/hết hạn/sai định dạng. */
  verifyAccessToken(token: string, options: { ignoreExpiration?: boolean } = {}): AccessTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.config.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1000),
        ignoreExpiration: options.ignoreExpiration ?? false,
      });
      if (typeof decoded !== 'object' || decoded === null) return null;
      const { sub, wid, sid } = decoded as Record<string, unknown>;
      if (typeof sub !== 'string' || typeof wid !== 'string' || typeof sid !== 'string') return null;
      if (![sub, wid, sid].every((v) => UUID_RE.test(v))) return null;
      return { sub, wid, sid };
    } catch {
      return null;
    }
  }

  newRefreshSecret(): { secret: string; hash: string } {
    const secret = randomBytes(32).toString('base64url');
    return { secret, hash: hashSecret(secret) };
  }

  formatRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  parseRefreshToken(token: string | undefined): { sessionId: string; secret: string } | null {
    if (!token) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const sessionId = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!UUID_RE.test(sessionId) || !/^[A-Za-z0-9_-]{40,64}$/.test(secret)) return null;
    return { sessionId, secret };
  }

  secretMatches(secret: string, storedHash: string): boolean {
    const a = Buffer.from(hashSecret(secret), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  newCsrfToken(): string {
    return randomBytes(32).toString('base64url');
  }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
