import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  billingSettingsCreateSchema,
  billingSettingsSchema,
  meterCreateSchema,
  meterInitialCorrectSchema,
  meterPriceCreateSchema,
  meterPricesSchema,
  meterReplaceSchema,
  PERMISSIONS,
  readingBatchResultSchema,
  readingBatchSchema,
  readingCorrectSchema,
  readingSchema,
  readingSheetQuerySchema,
  readingSheetSchema,
  roomMetersSchema,
  tenancyServiceChangeSchema,
  tenancyServiceSchema,
} from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { MetersService } from './meters.service.js';
import { PricesService } from './prices.service.js';
import { SettingsService } from './settings.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** Điện nước, đồng hồ, chỉ số, dịch vụ của lần thuê, cấu hình tính phí (Phase 4). */
@ApiTags('utilities')
@Controller()
export class UtilitiesController {
  constructor(
    private readonly prices: PricesService,
    private readonly meters: MetersService,
    private readonly subscriptions: SubscriptionsService,
    private readonly settings: SettingsService,
  ) {}

  // ---------- Giá điện nước theo tòa ----------

  @Get('buildings/:id/meter-prices')
  @RequirePermissions(PERMISSIONS.BUILDINGS_VIEW)
  @ApiOperation({ summary: 'Giá điện nước của tòa: đang áp dụng, đã đặt cho kỳ sau, lịch sử' })
  @ApiZodResponse(200, meterPricesSchema, 'Giá điện nước')
  @ApiErrorResponses(400, 401, 403, 404)
  meterPrices(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.prices.meterPrices(user, id);
  }

  @Post('buildings/:id/meter-prices')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: '“Thay đổi giá”: phiên bản giá mới áp dụng từ đầu một kỳ đọc; không sửa kỳ đã tính' })
  @ApiZodBody(meterPriceCreateSchema)
  @ApiZodResponse(201, meterPricesSchema, 'Đã đổi giá')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  createMeterPrice(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(meterPriceCreateSchema)) body: z.output<typeof meterPriceCreateSchema>) {
    return this.prices.createMeterPrice(user, id, body);
  }

  // ---------- Đồng hồ ----------

  @Get('rooms/:id/meters')
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Đồng hồ của phòng, chỉ số gần đây và lịch sử thay/sửa' })
  @ApiZodResponse(200, roomMetersSchema, 'Đồng hồ')
  @ApiErrorResponses(400, 401, 403, 404)
  roomMeters(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.meters.roomMeters(user, id);
  }

  @Post('rooms/:id/meters')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: 'Gắn đồng hồ, nhập chỉ số ban đầu một lần' })
  @ApiZodBody(meterCreateSchema)
  @ApiZodResponse(201, roomMetersSchema, 'Đã gắn')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  attach(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(meterCreateSchema)) body: z.output<typeof meterCreateSchema>) {
    return this.meters.attach(user, id, body);
  }

  @Post('meters/:id/replace')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: 'Thay đồng hồ: chốt chỉ số đồng hồ cũ, lắp đồng hồ mới' })
  @ApiZodBody(meterReplaceSchema)
  @ApiZodResponse(200, roomMetersSchema, 'Đã thay')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  replace(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(meterReplaceSchema)) body: z.output<typeof meterReplaceSchema>) {
    return this.meters.replace(user, id, body);
  }

  @Post('meters/:id/correct-initial')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: 'Sửa chỉ số ban đầu của đồng hồ (bắt buộc lý do)' })
  @ApiZodBody(meterInitialCorrectSchema)
  @ApiZodResponse(200, roomMetersSchema, 'Đã sửa')
  @ApiErrorResponses(400, 401, 403, 404, 422)
  correctInitial(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(meterInitialCorrectSchema)) body: z.output<typeof meterInitialCorrectSchema>) {
    return this.meters.correctInitial(user, id, body);
  }

  // ---------- Chỉ số ----------

  @Get('meter-readings/sheet')
  @RequirePermissions(PERMISSIONS.METER_READINGS_RECORD)
  @ApiOperation({ summary: 'Bảng nhập chỉ số của tòa theo kỳ: chỉ số trước tự lấy, tiêu thụ, đơn giá, tiền tạm tính' })
  @ApiZodResponse(200, readingSheetSchema, 'Bảng nhập')
  @ApiErrorResponses(400, 401, 403, 404)
  sheet(@CurrentUser() user: AuthUser, @Query(new ZodPipe(readingSheetQuerySchema)) q: z.output<typeof readingSheetQuerySchema>) {
    return this.meters.sheet(user, q);
  }

  @Post('meter-readings')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.METER_READINGS_RECORD)
  @ApiOperation({ summary: 'Lưu chỉ số chốt kỳ (một hoặc nhiều đồng hồ, atomic)' })
  @ApiZodBody(readingBatchSchema)
  @ApiZodResponse(200, readingBatchResultSchema, 'Đã lưu')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  saveBatch(@CurrentUser() user: AuthUser, @Body(new ZodPipe(readingBatchSchema)) body: z.output<typeof readingBatchSchema>) {
    return this.meters.saveBatch(user, body);
  }

  @Post('meter-readings/:id/correct')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.METER_READINGS_RECORD)
  @ApiOperation({ summary: '“Sửa chỉ số”: bắt buộc lý do, ghi lịch sử sửa và audit' })
  @ApiZodBody(readingCorrectSchema)
  @ApiZodResponse(200, readingSchema, 'Đã sửa')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  correct(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(readingCorrectSchema)) body: z.output<typeof readingCorrectSchema>) {
    return this.meters.correct(user, id, body);
  }

  // ---------- Dịch vụ của lần thuê ----------

  @Get('tenancies/:id/services')
  @RequirePermissions(PERMISSIONS.TENANTS_VIEW)
  @ApiOperation({ summary: 'Dịch vụ của lần thuê (mọi phiên bản)' })
  @ApiZodResponse(200, z.array(tenancyServiceSchema), 'Dịch vụ')
  @ApiErrorResponses(400, 401, 403, 404)
  tenancyServices(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.subscriptions.list(user, id);
  }

  @Post('tenancies/:id/services')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: 'Thêm dịch vụ, đổi số lượng hoặc ngưng từ một ngày (giữa tháng cần xác nhận)' })
  @ApiZodBody(tenancyServiceChangeSchema)
  @ApiZodResponse(201, z.array(tenancyServiceSchema), 'Dịch vụ sau thay đổi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  changeService(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(tenancyServiceChangeSchema)) body: z.output<typeof tenancyServiceChangeSchema>) {
    return this.subscriptions.change(user, id, body);
  }

  // ---------- Cấu hình tính phí ----------

  @Get('settings/billing')
  @RequirePermissions()
  @ApiOperation({ summary: 'Cấu hình tính phí đang áp dụng và lịch sử phiên bản' })
  @ApiZodResponse(200, billingSettingsSchema, 'Cấu hình')
  @ApiErrorResponses(401)
  billing(@CurrentUser() user: AuthUser) {
    return this.settings.getBilling(user);
  }

  @Post('settings/billing')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Tạo phiên bản cấu hình tính phí mới (không sửa phiên bản cũ)' })
  @ApiZodBody(billingSettingsCreateSchema)
  @ApiZodResponse(201, billingSettingsSchema, 'Đã lưu')
  @ApiErrorResponses(400, 401, 403, 409)
  createBilling(@CurrentUser() user: AuthUser, @Body(new ZodPipe(billingSettingsCreateSchema)) body: z.output<typeof billingSettingsCreateSchema>) {
    return this.settings.createBilling(user, body);
  }
}
