import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { COOKIE_NAMES, loginRequestSchema, meResponseSchema, okResponseSchema } from '@ql-tro/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Public, RequirePermissions, SkipCsrf } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import { clearSessionCookies, setSessionCookies } from './cookies.js';
import { TokenService } from './token.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  @SkipCsrf()
  @ApiOperation({ summary: 'Đăng nhập; đặt cookie access, refresh và CSRF' })
  @ApiZodBody(loginRequestSchema, { email: 'owner@example.test', password: '••••••••' })
  @ApiZodResponse(200, okResponseSchema, 'Đăng nhập thành công')
  @ApiErrorResponses(400, 401, 429)
  async login(
    @Body(new ZodPipe(loginRequestSchema)) body: z.output<typeof loginRequestSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.auth.login(body.email, body.password, meta(req));
    setSessionCookies(res, this.config, issued, this.tokens.newCsrfToken());
    return { ok: true as const };
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  @ApiOperation({ summary: 'Xoay vòng refresh token; cần header X-CSRF-Token' })
  @ApiZodResponse(200, okResponseSchema, 'Đã cấp phiên mới')
  @ApiErrorResponses(401, 403)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const issued = await this.auth.refresh(req.cookies?.[COOKIE_NAMES.REFRESH] as string | undefined, meta(req));
      setSessionCookies(res, this.config, issued);
      return { ok: true as const };
    } catch (error) {
      clearSessionCookies(res, this.config);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @Public()
  @ApiOperation({ summary: 'Đăng xuất; thu hồi phiên và xóa cookie; cần header X-CSRF-Token' })
  @ApiZodResponse(200, okResponseSchema, 'Đã đăng xuất')
  @ApiErrorResponses(403)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(
      req.cookies?.[COOKIE_NAMES.REFRESH] as string | undefined,
      req.cookies?.[COOKIE_NAMES.ACCESS] as string | undefined,
      meta(req),
    );
    clearSessionCookies(res, this.config);
    return { ok: true as const };
  }

  @Get('me')
  @RequirePermissions()
  @ApiOperation({ summary: 'Thông tin người dùng hiện tại, quyền và phạm vi tòa' })
  @ApiZodResponse(200, meResponseSchema, 'Người dùng hiện tại')
  @ApiErrorResponses(401)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}

function meta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? 'unknown',
    userAgent: req.headers['user-agent'],
    requestId: req.id === undefined ? undefined : String(req.id),
  };
}
