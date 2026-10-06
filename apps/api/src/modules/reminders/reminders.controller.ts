import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  pagedSchema,
  PERMISSIONS,
  reminderConsentSchema,
  reminderListQuerySchema,
  reminderRunResultSchema,
  reminderSchema,
  reminderSettingsInputSchema,
  reminderSettingsSchema,
  tenantSchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { RemindersService } from './reminders.service.js';

@ApiTags('reminders')
@Controller()
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly tenants: TenantsService,
  ) {}

  @Get('settings/reminders')
  @RequirePermissions(PERMISSIONS.REMINDERS_VIEW)
  @ApiOperation({ summary: 'Cấu hình nhắc đóng tiền và trạng thái kênh (không trả khóa API)' })
  @ApiZodResponse(200, reminderSettingsSchema, 'Cấu hình')
  @ApiErrorResponses(401, 403)
  getSettings(@CurrentUser() user: AuthUser) {
    return this.reminders.getSettings(user);
  }

  @Put('settings/reminders')
  @RequirePermissions(PERMISSIONS.REMINDERS_MANAGE)
  @ApiOperation({ summary: 'Lưu cấu hình nhắc đóng tiền; tắt thì hủy các tin chưa gửi' })
  @ApiZodBody(reminderSettingsInputSchema)
  @ApiZodResponse(200, reminderSettingsSchema, 'Đã lưu')
  @ApiErrorResponses(400, 401, 403, 409)
  putSettings(@CurrentUser() user: AuthUser, @Body(new ZodPipe(reminderSettingsInputSchema)) body: z.output<typeof reminderSettingsInputSchema>) {
    return this.reminders.putSettings(user, body);
  }

  @Get('reminders')
  @RequirePermissions(PERMISSIONS.REMINDERS_VIEW)
  @ApiOperation({ summary: 'Nhật ký tin nhắc đóng tiền (số điện thoại đã che)' })
  @ApiZodResponse(200, pagedSchema(reminderSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(reminderListQuerySchema)) q: z.output<typeof reminderListQuerySchema>) {
    return this.reminders.list(user, q);
  }

  @Post('reminders/run')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.REMINDERS_MANAGE)
  @ApiOperation({ summary: 'Chạy ngay một vòng lập lịch và gửi (job tự chạy mỗi 15 phút)' })
  @ApiZodResponse(200, reminderRunResultSchema, 'Kết quả')
  @ApiErrorResponses(401, 403)
  run(@CurrentUser() user: AuthUser) {
    return this.reminders.runNow(user);
  }

  @Post('reminders/:id/resend')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.REMINDERS_MANAGE)
  @ApiOperation({ summary: 'Gửi lại thủ công: thêm một lần thử cho cùng tin (kiểm tra lại đối tượng, tôn trọng giờ yên lặng)' })
  @ApiZodResponse(200, reminderSchema, 'Kết quả gửi lại')
  @ApiErrorResponses(401, 403, 404, 409, 422)
  resend(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.reminders.resend(user, id);
  }

  @Put('tenants/:id/reminder-consent')
  @RequirePermissions(PERMISSIONS.TENANTS_MANAGE)
  @ApiOperation({ summary: 'Ghi nhận đồng ý / tắt nhận tin nhắc đóng tiền; tắt có hiệu lực ngay với tin chưa gửi' })
  @ApiZodBody(reminderConsentSchema)
  @ApiZodResponse(200, tenantSchema, 'Người thuê sau khi cập nhật')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  async consent(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(reminderConsentSchema)) body: z.output<typeof reminderConsentSchema>) {
    await this.reminders.setConsent(user, id, body);
    return this.tenants.get(user, id);
  }
}
