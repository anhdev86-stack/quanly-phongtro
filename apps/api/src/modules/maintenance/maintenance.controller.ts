import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { maintenanceCreateSchema, maintenanceListQuerySchema, maintenanceSchema, maintenanceUpdateSchema, pagedSchema, PERMISSIONS } from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { MaintenanceService } from './maintenance.service.js';

@ApiTags('maintenance')
@Controller('maintenance-requests')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MAINTENANCE_VIEW)
  @ApiOperation({ summary: 'Yêu cầu bảo trì trong phạm vi tòa (đang mở xếp trước, theo mức ưu tiên)' })
  @ApiZodResponse(200, pagedSchema(maintenanceSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(maintenanceListQuerySchema)) q: z.output<typeof maintenanceListQuerySchema>) {
    return this.maintenance.list(user, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_VIEW)
  @ApiOperation({ summary: 'Chi tiết yêu cầu bảo trì' })
  @ApiZodResponse(200, maintenanceSchema, 'Chi tiết')
  @ApiErrorResponses(401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.maintenance.get(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Tạo yêu cầu bảo trì cho phòng' })
  @ApiZodBody(maintenanceCreateSchema)
  @ApiZodResponse(201, maintenanceSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 404)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(maintenanceCreateSchema)) body: z.output<typeof maintenanceCreateSchema>) {
    return this.maintenance.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Cập nhật trạng thái, ưu tiên, người phụ trách, kết quả, khoản chi liên quan' })
  @ApiZodBody(maintenanceUpdateSchema)
  @ApiZodResponse(200, maintenanceSchema, 'Đã cập nhật')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(maintenanceUpdateSchema)) body: z.output<typeof maintenanceUpdateSchema>) {
    return this.maintenance.update(user, id, body);
  }
}
