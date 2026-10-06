import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  pagedSchema,
  roomCreateSchema,
  roomListQuerySchema,
  roomOperationalStatusSchema,
  roomSchema,
  roomUpdateSchema,
  versionOnlySchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { RoomsService } from './rooms.service.js';

@ApiTags('rooms')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Danh sách phòng (lọc tòa, trạng thái, tầng, tìm mã phòng/người thuê)' })
  @ApiZodResponse(200, pagedSchema(roomSchema), 'Danh sách phòng')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(roomListQuerySchema)) q: z.output<typeof roomListQuerySchema>) {
    return this.rooms.list(user, q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROOMS_MANAGE)
  @ApiOperation({ summary: 'Tạo phòng' })
  @ApiZodBody(roomCreateSchema)
  @ApiZodResponse(201, roomSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(roomCreateSchema)) body: z.output<typeof roomCreateSchema>) {
    return this.rooms.create(user, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Chi tiết phòng' })
  @ApiZodResponse(200, roomSchema, 'Phòng')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.rooms.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ROOMS_MANAGE)
  @ApiOperation({ summary: 'Sửa phòng (cần expected_version)' })
  @ApiZodBody(roomUpdateSchema)
  @ApiZodResponse(200, roomSchema, 'Đã sửa')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(roomUpdateSchema)) body: z.output<typeof roomUpdateSchema>) {
    return this.rooms.update(user, id, body);
  }

  @Post(':id/set-operational-status')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ROOMS_MANAGE)
  @ApiOperation({ summary: 'Đặt READY / MAINTENANCE' })
  @ApiZodBody(roomOperationalStatusSchema)
  @ApiZodResponse(200, roomSchema, 'Đã cập nhật')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(roomOperationalStatusSchema)) body: z.output<typeof roomOperationalStatusSchema>,
  ) {
    return this.rooms.setOperationalStatus(user, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ROOMS_MANAGE)
  @ApiOperation({ summary: 'Lưu trữ phòng (không có khách, không còn giữ chỗ)' })
  @ApiZodBody(versionOnlySchema)
  @ApiZodResponse(200, roomSchema, 'Đã lưu trữ')
  @ApiErrorResponses(401, 403, 404, 409, 422)
  archive(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(versionOnlySchema)) body: z.output<typeof versionOnlySchema>) {
    return this.rooms.setArchived(user, id, body.expected_version, true);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ROOMS_MANAGE)
  @ApiOperation({ summary: 'Bỏ lưu trữ phòng' })
  @ApiZodBody(versionOnlySchema)
  @ApiZodResponse(200, roomSchema, 'Đã bỏ lưu trữ')
  @ApiErrorResponses(401, 403, 404, 409)
  unarchive(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(versionOnlySchema)) body: z.output<typeof versionOnlySchema>) {
    return this.rooms.setArchived(user, id, body.expected_version, false);
  }
}
