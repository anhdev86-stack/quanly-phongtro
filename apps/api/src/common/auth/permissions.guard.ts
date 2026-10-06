import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error.js';
import { IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators.js';

/** Kiểm tra quyền ở backend. Ẩn nút ở frontend không thay thế được guard này. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS, targets) ?? [];
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) throw new AppError('UNAUTHENTICATED');
    if (required.some((p) => !user.permissions.has(p))) throw new AppError('FORBIDDEN');
    return true;
  }
}
