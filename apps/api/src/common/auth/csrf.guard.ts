import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { COOKIE_NAMES, CSRF_HEADER } from '@ql-tro/shared';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors/app-error.js';
import { SKIP_CSRF } from './decorators.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit CSRF: mọi request thay đổi dữ liệu phải gửi header X-CSRF-Token khớp cookie qt_csrf. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()]);
    if (skip) return true;

    const cookie = req.cookies?.[COOKIE_NAMES.CSRF] as unknown;
    const header = req.headers[CSRF_HEADER];
    if (typeof cookie !== 'string' || typeof header !== 'string' || cookie.length < 16) {
      throw new AppError('CSRF_TOKEN_INVALID');
    }
    const a = Buffer.from(cookie);
    const b = Buffer.from(header);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('CSRF_TOKEN_INVALID');
    return true;
  }
}
