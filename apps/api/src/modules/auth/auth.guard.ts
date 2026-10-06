import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { COOKIE_NAMES } from '@ql-tro/shared';
import type { Request } from 'express';
import { IS_PUBLIC } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { AuthService } from './auth.service.js';

/** Mặc định mọi endpoint cần đăng nhập (MASTER_PLAN mục 10). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const user = await this.auth.loadAuthUser(req.cookies?.[COOKIE_NAMES.ACCESS] as string | undefined);
    if (!user) throw new AppError('UNAUTHENTICATED');
    req.user = user;
    return true;
  }
}
