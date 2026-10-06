import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  contractCancelResultSchema,
  contractCancelSchema,
  contractCreateSchema,
  contractListQuerySchema,
  contractRenewSchema,
  contractSchema,
  contractSignSchema,
  pagedSchema,
  rentPriceCreateSchema,
  rentPriceSchema,
} from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { ContractsService } from './contracts.service.js';

@ApiTags('contracts')
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('contracts')
  @RequirePermissions(PERMISSIONS.CONTRACTS_VIEW)
  @ApiOperation({ summary: 'Danh sách hợp đồng; lọc trạng thái (suy ra từ ngày), sắp hết hạn trong N ngày' })
  @ApiZodResponse(200, pagedSchema(contractSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(contractListQuerySchema)) q: z.output<typeof contractListQuerySchema>) {
    return this.contracts.list(user, q);
  }

  @Get('contracts/:id')
  @RequirePermissions(PERMISSIONS.CONTRACTS_VIEW)
  @ApiOperation({ summary: 'Chi tiết hợp đồng' })
  @ApiZodResponse(200, contractSchema, 'Hợp đồng')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.contracts.get(user, id);
  }

  @Get('tenancies/:id/contracts')
  @RequirePermissions(PERMISSIONS.CONTRACTS_VIEW)
  @ApiOperation({ summary: 'Các kỳ hợp đồng của lần thuê' })
  @ApiZodResponse(200, pagedSchema(contractSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  listForTenancy(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.contracts.list(user, { tenancy_id: id, page: 1, page_size: 100 });
  }

  @Post('tenancies/:id/contracts')
  @RequirePermissions(PERMISSIONS.CONTRACTS_MANAGE)
  @ApiOperation({ summary: 'Tạo hợp đồng (nháp, hoặc đã ký với signed=true)' })
  @ApiZodBody(contractCreateSchema)
  @ApiZodResponse(201, contractSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  create(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(contractCreateSchema)) body: z.output<typeof contractCreateSchema>) {
    return this.contracts.create(user, id, body, false);
  }

  @Post('tenancies/:id/contracts/renew')
  @RequirePermissions(PERMISSIONS.CONTRACTS_MANAGE)
  @ApiOperation({ summary: 'Gia hạn: tạo kỳ hợp đồng mới cùng lần thuê; không sửa kỳ cũ, không nhận lại cọc' })
  @ApiZodBody(contractRenewSchema)
  @ApiZodResponse(201, contractSchema, 'Đã tạo kỳ mới')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  renew(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(contractRenewSchema)) body: z.output<typeof contractRenewSchema>) {
    return this.contracts.create(user, id, body, true);
  }

  @Post('contracts/:id/sign')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTRACTS_MANAGE)
  @ApiOperation({ summary: 'Xác nhận đã ký hợp đồng nháp' })
  @ApiZodBody(contractSignSchema)
  @ApiZodResponse(200, contractSchema, 'Đã ký')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  sign(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(contractSignSchema)) body: z.output<typeof contractSignSchema>) {
    return this.contracts.sign(user, id, body);
  }

  @Post('contracts/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTRACTS_MANAGE)
  @ApiOperation({ summary: 'Hủy nháp, hoặc hủy hợp đồng đã ký chưa bắt đầu (cần contracts.cancel_signed); vô hiệu hóa giá/dịch vụ phụ thuộc' })
  @ApiZodBody(contractCancelSchema)
  @ApiZodResponse(200, contractCancelResultSchema, 'Đã hủy')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  cancel(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(contractCancelSchema)) body: z.output<typeof contractCancelSchema>) {
    return this.contracts.cancel(user, id, body);
  }

  @Get('tenancies/:id/rent-prices')
  @RequirePermissions(PERMISSIONS.TENANTS_VIEW)
  @ApiOperation({ summary: 'Lịch sử giá thuê (kể cả phiên bản đã vô hiệu hóa)' })
  @ApiZodResponse(200, z.array(rentPriceSchema), 'Lịch sử giá')
  @ApiErrorResponses(400, 401, 403, 404)
  rentPrices(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.contracts.listRentPrices(user, id);
  }

  @Post('tenancies/:id/rent-prices')
  @RequirePermissions(PERMISSIONS.CONTRACTS_MANAGE)
  @ApiOperation({ summary: 'Đổi giá thuê có hiệu lực từ ngày; only_month = điều chỉnh/giảm giá cho đúng một tháng (D-022)' })
  @ApiZodBody(rentPriceCreateSchema)
  @ApiZodResponse(201, z.array(rentPriceSchema), 'Lịch sử giá sau khi đổi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  createRentPrice(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(rentPriceCreateSchema)) body: z.output<typeof rentPriceCreateSchema>) {
    return this.contracts.createRentPrice(user, id, body);
  }
}
