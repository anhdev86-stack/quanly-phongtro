import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  buildingCreateSchema,
  buildingListQuerySchema,
  buildingSchema,
  buildingUpdateSchema,
  versionOnlySchema,
} from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { BuildingsService } from './buildings.service.js';

@ApiTags('buildings')
@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BUILDINGS_VIEW)
  @ApiOperation({ summary: 'Danh sách tòa trong phạm vi' })
  @ApiZodResponse(200, z.array(buildingSchema), 'Danh sách tòa')
  @ApiErrorResponses(401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(buildingListQuerySchema)) q: z.output<typeof buildingListQuerySchema>) {
    return this.buildings.list(user, q.include_archived === 'true');
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BUILDINGS_MANAGE)
  @ApiOperation({ summary: 'Tạo tòa' })
  @ApiZodBody(buildingCreateSchema)
  @ApiZodResponse(201, buildingSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 409)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(buildingCreateSchema)) body: z.output<typeof buildingCreateSchema>) {
    return this.buildings.create(user, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BUILDINGS_VIEW)
  @ApiOperation({ summary: 'Chi tiết tòa' })
  @ApiZodResponse(200, buildingSchema, 'Tòa')
  @ApiErrorResponses(401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.buildings.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BUILDINGS_MANAGE)
  @ApiOperation({ summary: 'Sửa tòa (cần expected_version)' })
  @ApiZodBody(buildingUpdateSchema)
  @ApiZodResponse(200, buildingSchema, 'Đã sửa')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(buildingUpdateSchema)) body: z.output<typeof buildingUpdateSchema>,
  ) {
    return this.buildings.update(user, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BUILDINGS_MANAGE)
  @ApiOperation({ summary: 'Lưu trữ tòa (phải lưu trữ hết phòng trước)' })
  @ApiZodBody(versionOnlySchema)
  @ApiZodResponse(200, buildingSchema, 'Đã lưu trữ')
  @ApiErrorResponses(401, 403, 404, 409, 422)
  archive(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(versionOnlySchema)) body: z.output<typeof versionOnlySchema>) {
    return this.buildings.setArchived(user, id, body.expected_version, true);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BUILDINGS_MANAGE)
  @ApiOperation({ summary: 'Bỏ lưu trữ tòa' })
  @ApiZodBody(versionOnlySchema)
  @ApiZodResponse(200, buildingSchema, 'Đã bỏ lưu trữ')
  @ApiErrorResponses(401, 403, 404, 409)
  unarchive(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(versionOnlySchema)) body: z.output<typeof versionOnlySchema>) {
    return this.buildings.setArchived(user, id, body.expected_version, false);
  }
}
