import { COOKIE_NAMES } from '@ql-tro/shared';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/env.js';
import type { IssuedSession } from './auth.service.js';

/** Refresh cookie chỉ gửi tới các endpoint auth (MASTER_PLAN 3.5). */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function base(config: AppConfig): CookieOptions {
  return { secure: config.COOKIE_SECURE, sameSite: 'lax' };
}

export function setSessionCookies(res: Response, config: AppConfig, issued: IssuedSession, csrfToken?: string): void {
  res.cookie(COOKIE_NAMES.ACCESS, issued.accessToken, {
    ...base(config),
    httpOnly: true,
    path: '/',
    maxAge: config.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(COOKIE_NAMES.REFRESH, issued.refreshToken, {
    ...base(config),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    expires: issued.refreshExpiresAt,
  });
  if (csrfToken) {
    // Không HttpOnly: JavaScript của web cần đọc để gửi lại qua header X-CSRF-Token.
    res.cookie(COOKIE_NAMES.CSRF, csrfToken, {
      ...base(config),
      httpOnly: false,
      path: '/',
      expires: issued.refreshExpiresAt,
    });
  }
}

export function clearSessionCookies(res: Response, config: AppConfig): void {
  res.clearCookie(COOKIE_NAMES.ACCESS, { ...base(config), httpOnly: true, path: '/' });
  res.clearCookie(COOKIE_NAMES.REFRESH, { ...base(config), httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(COOKIE_NAMES.CSRF, { ...base(config), httpOnly: false, path: '/' });
}
