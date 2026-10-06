import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  billingResultSchema,
  billingRunSchema,
  invoiceAdjustResultSchema,
  invoiceAdjustSchema,
  invoiceCancelSchema,
  invoiceDetailSchema,
  invoiceListQuerySchema,
  invoicePublishResultSchema,
  invoicePublishSchema,
  invoiceRecalculateResultSchema,
  invoiceRecalculateSchema,
  invoiceSummarySchema,
  pagedSchema,
  PERMISSIONS,
  statementPeriodSchema,
} from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { BillingService } from './billing.service.js';

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('billing/preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_GENERATE)
  @ApiOperation({ summary: 'Xem trước thông báo tháng của các lần thuê (không ghi gì)' })
  @ApiZodBody(billingRunSchema)
  @ApiZodResponse(200, billingResultSchema, 'Kết quả từng lần thuê')
  @ApiErrorResponses(400, 401, 403)
  preview(@CurrentUser() user: AuthUser, @Body(new ZodPipe(billingRunSchema)) body: z.output<typeof billingRunSchema>) {
    return this.billing.preview(user, body);
  }

  @Post('billing/generate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_GENERATE)
  @ApiOperation({ summary: 'Tạo nháp thông báo tháng (idempotent theo lần thuê + tháng; mỗi lần thuê một transaction)' })
  @ApiZodBody(billingRunSchema)
  @ApiZodResponse(200, billingResultSchema, 'Kết quả từng lần thuê')
  @ApiErrorResponses(400, 401, 403)
  generate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(billingRunSchema)) body: z.output<typeof billingRunSchema>) {
    return this.billing.generate(user, body);
  }

  @Get('statement-periods')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Các tháng phát hành và số thông báo nháp/đã phát hành' })
  @ApiZodResponse(200, z.array(statementPeriodSchema), 'Kỳ')
  @ApiErrorResponses(401, 403)
  periods(@CurrentUser() user: AuthUser) {
    return this.billing.statementPeriods(user);
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Danh sách thông báo; lọc kỳ, tòa, lần thuê, vòng đời, loại, trạng thái thanh toán' })
  @ApiZodResponse(200, pagedSchema(invoiceSummarySchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(invoiceListQuerySchema)) q: z.output<typeof invoiceListQuerySchema>) {
    return this.billing.list(user, q);
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Chi tiết thông báo và các dòng phí' })
  @ApiZodResponse(200, invoiceDetailSchema, 'Thông báo')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.billing.get(user, id);
  }

  @Post('invoices/:id/recalculate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_GENERATE)
  @ApiOperation({ summary: 'Tính lại nháp từ dữ liệu hiện tại' })
  @ApiZodBody(invoiceRecalculateSchema)
  @ApiZodResponse(200, invoiceRecalculateResultSchema, 'Nháp sau khi tính lại')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  recalculate(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(invoiceRecalculateSchema)) body: z.output<typeof invoiceRecalculateSchema>) {
    return this.billing.recalculate(user, id, body.expected_version);
  }

  @Post('invoices/:id/publish')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INVOICES_PUBLISH)
  @ApiOperation({ summary: 'Phát hành: khóa nội dung, cấp số; dữ liệu nguồn đổi → 409 STALE; tổng âm → tách CREDIT_ADJUSTMENT' })
  @ApiZodBody(invoicePublishSchema)
  @ApiZodResponse(200, invoicePublishResultSchema, 'Đã phát hành')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  publish(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(invoicePublishSchema)) body: z.output<typeof invoicePublishSchema>) {
    return this.billing.publish(user, id, body);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INVOICES_PUBLISH)
  @ApiOperation({ summary: 'Hủy nháp, hoặc hủy thông báo đã phát hành chưa có khoản thu/cấn trừ' })
  @ApiZodBody(invoiceCancelSchema)
  @ApiZodResponse(200, invoiceDetailSchema, 'Đã hủy')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  cancel(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(invoiceCancelSchema)) body: z.output<typeof invoiceCancelSchema>) {
    return this.billing.cancel(user, id, body);
  }

  @Post('invoices/:id/adjustments')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INVOICES_ADJUST)
  @ApiOperation({ summary: '“Điều chỉnh ngay”: xem trước (confirm=false) hoặc phát hành chứng từ điều chỉnh liên kết' })
  @ApiZodBody(invoiceAdjustSchema)
  @ApiZodResponse(200, invoiceAdjustResultSchema, 'Kết quả điều chỉnh')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  adjust(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(invoiceAdjustSchema)) body: z.output<typeof invoiceAdjustSchema>) {
    return this.billing.adjust(user, id, body);
  }
}
