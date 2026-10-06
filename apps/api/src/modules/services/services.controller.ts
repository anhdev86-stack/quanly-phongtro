import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, serviceCreateSchema, serviceDetailSchema, servicePriceCreateSchema, serviceSchema, serviceUpdateSchema, type ServiceDto } from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { PricesService } from '../utilities/prices.service.js';

/** Danh mục dịch vụ và giá dịch vụ có phiên bản (MASTER_PLAN 6.4). */
@ApiTags('services')
@Controller('services')
export class ServicesCatalogController {
  constructor(private readonly prices: PricesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Danh mục dịch vụ (kể cả đã lưu trữ)' })
  @ApiZodResponse(200, z.array(serviceSchema), 'Dịch vụ')
  @ApiErrorResponses(401, 403)
  list(@CurrentUser() user: AuthUser): Promise<ServiceDto[]> {
    return this.prices.listServices(user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Chi tiết dịch vụ và lịch sử giá (giá chung và giá riêng các tòa trong phạm vi)' })
  @ApiZodResponse(200, serviceDetailSchema, 'Dịch vụ')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.prices.getService(user, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: 'Thêm dịch vụ không đồng hồ' })
  @ApiZodBody(serviceCreateSchema)
  @ApiZodResponse(201, serviceDetailSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 409)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(serviceCreateSchema)) body: z.output<typeof serviceCreateSchema>) {
    return this.prices.createService(user, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: 'Sửa tên, đơn vị, thu trước/thu sau, lưu trữ (không đổi loại)' })
  @ApiZodBody(serviceUpdateSchema)
  @ApiZodResponse(200, serviceDetailSchema, 'Đã lưu')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(serviceUpdateSchema)) body: z.output<typeof serviceUpdateSchema>) {
    return this.prices.updateService(user, id, body);
  }

  @Post(':id/prices')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: 'Thêm phiên bản giá (chung hoặc riêng một tòa); giữa tháng cần xác nhận' })
  @ApiZodBody(servicePriceCreateSchema)
  @ApiZodResponse(201, serviceDetailSchema, 'Đã thêm giá')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  createPrice(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(servicePriceCreateSchema)) body: z.output<typeof servicePriceCreateSchema>) {
    return this.prices.createServicePrice(user, id, body);
  }
}
