import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IDEMPOTENCY_HEADER,
  noticeCreateSchema,
  noticeSchema,
  pagedSchema,
  PERMISSIONS,
  reverseSchema,
  settlementApproveSchema,
  settlementCancelSchema,
  settlementCashSchema,
  settlementCompleteSchema,
  settlementInputSchema,
  settlementListQuerySchema,
  settlementPreviewSchema,
  settlementSchema,
  settlementUpdateSchema,
} from '@ql-tro/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { NoticesService } from './notices.service.js';
import { SettlementsService } from './settlements.service.js';

@ApiTags('move-out')
@Controller()
export class SettlementsController {
  constructor(
    private readonly notices: NoticesService,
    private readonly settlements: SettlementsService,
  ) {}

  // ---------- Báo trả ----------

  @Get('tenancies/:id/move-out-notices')
  @RequirePermissions(PERMISSIONS.TENANTS_VIEW)
  @ApiOperation({ summary: 'Lịch sử báo trả của lần thuê' })
  @ApiZodResponse(200, z.array(noticeSchema), 'Báo trả')
  @ApiErrorResponses(400, 401, 403, 404)
  listNotices(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.notices.list(user, id);
  }

  @Post('tenancies/:id/move-out-notices')
  @RequirePermissions(PERMISSIONS.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Báo trả phòng (ACTIVE → NOTICE_GIVEN); báo lùi ngày cần quyền và lý do' })
  @ApiZodBody(noticeCreateSchema)
  @ApiZodResponse(201, z.array(noticeSchema), 'Đã ghi báo trả')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  createNotice(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(noticeCreateSchema)) body: z.output<typeof noticeCreateSchema>) {
    return this.notices.create(user, id, body);
  }

  @Post('move-out-notices/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Hủy báo trả (lưu lịch sử); lần thuê quay lại đang thuê' })
  @ApiZodBody(reverseSchema)
  @ApiZodResponse(200, z.array(noticeSchema), 'Đã hủy')
  @ApiErrorResponses(400, 401, 403, 404, 422)
  cancelNotice(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(reverseSchema)) body: z.output<typeof reverseSchema>) {
    return this.notices.cancel(user, id, body.reason);
  }

  // ---------- Quyết toán ----------

  @Get('settlements')
  @RequirePermissions(PERMISSIONS.SETTLEMENTS_VIEW)
  @ApiOperation({ summary: 'Danh sách quyết toán; lọc trạng thái, tình trạng tài chính hiện tại' })
  @ApiZodResponse(200, pagedSchema(settlementSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(settlementListQuerySchema)) q: z.output<typeof settlementListQuerySchema>) {
    return this.settlements.list(user, q);
  }

  @Get('settlements/:id')
  @RequirePermissions(PERMISSIONS.SETTLEMENTS_VIEW)
  @ApiOperation({ summary: 'Chi tiết quyết toán: số liệu lúc chốt, số liệu hiện tại, sự kiện sau quyết toán' })
  @ApiZodResponse(200, settlementSchema, 'Quyết toán')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.settlements.get(user, id);
  }

  @Get('tenancies/:id/move-out-settlements')
  @RequirePermissions(PERMISSIONS.SETTLEMENTS_VIEW)
  @ApiOperation({ summary: 'Quyết toán của lần thuê' })
  @ApiZodResponse(200, z.array(settlementSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403, 404)
  forTenancy(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.settlements.forTenancy(user, id);
  }

  @Post('tenancies/:id/move-out-settlements')
  @RequirePermissions(PERMISSIONS.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Bắt đầu trả phòng: ngày cuối tính tiền, chỉ số cuối, kiểm kê, khoản phí' })
  @ApiZodBody(settlementInputSchema)
  @ApiZodResponse(201, settlementSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  create(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(settlementInputSchema)) body: z.output<typeof settlementInputSchema>) {
    return this.settlements.create(user, id, body);
  }

  @Put('settlements/:id')
  @RequirePermissions(PERMISSIONS.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Sửa quyết toán chưa hoàn tất (đã duyệt thì quay về nháp)' })
  @ApiZodBody(settlementUpdateSchema)
  @ApiZodResponse(200, settlementSchema, 'Đã lưu')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  update(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(settlementUpdateSchema)) body: z.output<typeof settlementUpdateSchema>) {
    return this.settlements.update(user, id, body);
  }

  @Post('settlements/:id/preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTLEMENTS_VIEW)
  @ApiOperation({ summary: 'Xem trước đối soát cuối kỳ và cấn trừ (không ghi gì)' })
  @ApiZodResponse(200, settlementPreviewSchema, 'Xem trước')
  @ApiErrorResponses(400, 401, 403, 404)
  preview(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.settlements.preview(user, id);
  }

  @Post('settlements/:id/approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTLEMENT_APPROVE)
  @ApiOperation({ summary: 'Duyệt: chốt snapshot và input_hash đã xem; còn hợp đồng ký chưa bắt đầu thì chặn' })
  @ApiZodBody(settlementApproveSchema)
  @ApiZodResponse(200, settlementSchema, 'Đã duyệt')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  approve(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(settlementApproveSchema)) body: z.output<typeof settlementApproveSchema>) {
    return this.settlements.approve(user, id, body);
  }

  @Post('settlements/:id/complete')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTLEMENT_APPROVE)
  @ApiOperation({ summary: 'Hoàn tất trả phòng (một transaction); dữ liệu đổi sau duyệt → 409 STALE. Cần Idempotency-Key' })
  @ApiZodBody(settlementCompleteSchema)
  @ApiZodResponse(200, settlementSchema, 'Đã hoàn tất')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(settlementCompleteSchema)) body: z.output<typeof settlementCompleteSchema>,
  ) {
    return (await this.settlements.complete(user, id, body.expected_version, key)).body;
  }

  @Post('settlements/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTLEMENT_MANAGE)
  @ApiOperation({ summary: 'Hủy quyết toán chưa hoàn tất' })
  @ApiZodBody(settlementCancelSchema)
  @ApiZodResponse(200, settlementSchema, 'Đã hủy')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  cancel(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(settlementCancelSchema)) body: z.output<typeof settlementCancelSchema>) {
    return this.settlements.cancel(user, id, body.reason, body.expected_version);
  }

  @Post('settlements/:id/receipts')
  @RequirePermissions(PERMISSIONS.PAYMENTS_RECORD)
  @ApiOperation({ summary: 'Thu khoản khách còn nợ sau quyết toán (khi thực nhận). Cần Idempotency-Key' })
  @ApiZodBody(settlementCashSchema)
  @ApiZodResponse(201, settlementSchema, 'Đã ghi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async receipt(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Headers(IDEMPOTENCY_HEADER) key: string | undefined, @Body(new ZodPipe(settlementCashSchema)) body: z.output<typeof settlementCashSchema>, @Res({ passthrough: true }) res: Response) {
    const r = await this.settlements.receipt(user, id, body, key);
    res.status(r.status);
    return r.body;
  }

  @Post('settlements/:id/credit-refunds')
  @RequirePermissions(PERMISSIONS.CREDIT_REFUND)
  @ApiOperation({ summary: 'Hoàn tiền dư (credit) khi đã thực chi. Cần Idempotency-Key' })
  @ApiZodBody(settlementCashSchema)
  @ApiZodResponse(201, settlementSchema, 'Đã ghi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async creditRefund(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Headers(IDEMPOTENCY_HEADER) key: string | undefined, @Body(new ZodPipe(settlementCashSchema)) body: z.output<typeof settlementCashSchema>, @Res({ passthrough: true }) res: Response) {
    const r = await this.settlements.creditRefund(user, id, body, key);
    res.status(r.status);
    return r.body;
  }

  @Post('settlements/:id/deposit-refunds')
  @RequirePermissions(PERMISSIONS.DEPOSIT_REFUND)
  @ApiOperation({ summary: 'Hoàn cọc khi đã thực chi. Cần Idempotency-Key' })
  @ApiZodBody(settlementCashSchema)
  @ApiZodResponse(201, settlementSchema, 'Đã ghi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async depositRefund(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Headers(IDEMPOTENCY_HEADER) key: string | undefined, @Body(new ZodPipe(settlementCashSchema)) body: z.output<typeof settlementCashSchema>, @Res({ passthrough: true }) res: Response) {
    const r = await this.settlements.depositRefund(user, id, body, key);
    res.status(r.status);
    return r.body;
  }
}
