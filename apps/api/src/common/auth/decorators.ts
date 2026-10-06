import { applyDecorators, createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { PermissionCode } from '@ql-tro/shared';
import type { Request } from 'express';
import { AppError } from '../errors/app-error.js';
import type { AuthUser } from './auth-user.js';

export const IS_PUBLIC = 'qt:isPublic';
export const SKIP_CSRF = 'qt:skipCsrf';
export const REQUIRED_PERMISSIONS = 'qt:requiredPermissions';

/** Endpoint không cần đăng nhập. Chỉ dùng cho login/refresh/health (MASTER_PLAN mục 10). */
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC, true), ApiExtension('x-public', true));

/** Bỏ kiểm tra CSRF. Chỉ dùng cho login (chưa có cookie CSRF). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/**
 * Yêu cầu tất cả các quyền liệt kê. Không truyền quyền nào nghĩa là chỉ cần đăng nhập.
 * Danh sách quyền được ghi vào OpenAPI qua `x-permissions`.
 */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  applyDecorators(SetMetadata(REQUIRED_PERMISSIONS, permissions), ApiExtension('x-permissions', permissions));

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.user) throw new AppError('UNAUTHENTICATED');
  return req.user;
});
