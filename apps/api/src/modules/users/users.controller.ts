import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, userCreateSchema, userResetPasswordSchema, userSchema, userScopesSchema, userUpdateSchema } from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Danh sách tài khoản' })
  @ApiZodResponse(200, z.array(userSchema), 'Danh sách')
  @ApiErrorResponses(401, 403)
  list(@CurrentUser() actor: AuthUser) {
    return this.users.list(actor);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Tạo tài khoản' })
  @ApiZodBody(userCreateSchema)
  @ApiZodResponse(201, userSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 409, 422)
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(userCreateSchema)) body: z.output<typeof userCreateSchema>) {
    return this.users.create(actor, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Chi tiết tài khoản' })
  @ApiZodResponse(200, userSchema, 'Tài khoản')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() actor: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.users.get(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Sửa tên, vai trò, bật/tắt tài khoản' })
  @ApiZodBody(userUpdateSchema)
  @ApiZodResponse(200, userSchema, 'Đã sửa')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  update(@CurrentUser() actor: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(userUpdateSchema)) body: z.output<typeof userUpdateSchema>) {
    return this.users.update(actor, id, body);
  }

  @Put(':id/building-scopes')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Giao phạm vi tòa' })
  @ApiZodBody(userScopesSchema)
  @ApiZodResponse(200, userSchema, 'Đã cập nhật')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  setScopes(@CurrentUser() actor: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(userScopesSchema)) body: z.output<typeof userScopesSchema>) {
    return this.users.setScopes(actor, id, body);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Đặt lại mật khẩu (thu hồi mọi phiên của tài khoản)' })
  @ApiZodBody(userResetPasswordSchema)
  @ApiZodResponse(200, userSchema, 'Đã đặt lại')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(userResetPasswordSchema)) body: z.output<typeof userResetPasswordSchema>,
  ) {
    return this.users.resetPassword(actor, id, body);
  }
}
