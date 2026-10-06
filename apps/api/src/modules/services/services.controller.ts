import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, serviceSchema, type ServiceDto } from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { iso } from '../../common/dto/mappers.js';
import { ApiErrorResponses, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

/** Danh mục dịch vụ (quản lý đầy đủ và giá theo tòa ở Phase 4). */
@ApiTags('services')
@Controller('services')
export class ServicesCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Danh mục dịch vụ đang dùng' })
  @ApiZodResponse(200, z.array(serviceSchema), 'Dịch vụ')
  @ApiErrorResponses(401, 403)
  async list(@CurrentUser() user: AuthUser): Promise<ServiceDto[]> {
    const rows = await this.prisma.service.findMany({ where: { workspaceId: user.workspaceId }, orderBy: [{ type: 'desc' }, { code: 'asc' }] });
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      type: s.type,
      unit: s.unit,
      charge_timing: s.chargeTiming,
      meter_type: s.meterType,
      archived_at: iso(s.archivedAt),
      version: s.version,
    }));
  }
}
