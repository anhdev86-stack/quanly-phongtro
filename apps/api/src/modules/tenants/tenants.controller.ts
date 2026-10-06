import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, pagedSchema, tenantInputSchema, tenantListQuerySchema, tenantSchema, tenantUpdateSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { TenantsService } from './tenants.service.js';

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TENANTS_VIEW)
  @ApiOperation({ summary: 'Danh sách người thuê (tìm theo tên, SĐT; CCCD nếu có quyền)' })
  @ApiZodResponse(200, pagedSchema(tenantSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(tenantListQuerySchema)) q: z.output<typeof tenantListQuerySchema>) {
    return this.tenants.list(user, q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TENANTS_MANAGE)
  @ApiOperation({ summary: 'Thêm người thuê' })
  @ApiZodBody(tenantInputSchema)
  @ApiZodResponse(201, tenantSchema, 'Đã tạo (kèm cảnh báo trùng CCCD nếu có)')
  @ApiErrorResponses(400, 401, 403)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(tenantInputSchema)) body: z.output<typeof tenantInputSchema>) {
    return this.tenants.create(user, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TENANTS_VIEW)
  @ApiOperation({ summary: 'Chi tiết người thuê' })
  @ApiZodResponse(200, tenantSchema, 'Người thuê')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.tenants.get(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TENANTS_MANAGE)
  @ApiOperation({ summary: 'Sửa người thuê (cần expected_version)' })
  @ApiZodBody(tenantUpdateSchema)
  @ApiZodResponse(200, tenantSchema, 'Đã sửa')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(tenantUpdateSchema)) body: z.output<typeof tenantUpdateSchema>) {
    return this.tenants.update(user, id, body);
  }
}
