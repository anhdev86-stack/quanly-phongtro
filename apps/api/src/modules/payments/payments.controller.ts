import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  creditApplySchema,
  creditRefundCreateSchema,
  debtListSchema,
  debtQuerySchema,
  IDEMPOTENCY_HEADER,
  invoiceSettlementsSchema,
  pagedSchema,
  paymentAccountInputSchema,
  paymentAccountSchema,
  paymentCreateSchema,
  paymentListQuerySchema,
  paymentReceiversSchema,
  paymentSchema,
  PERMISSIONS,
  publicInvoiceSchema,
  reverseSchema,
  shareLinkCreatedSchema,
  shareLinkSchema,
  statementSchema,
  vietQrSchema,
} from '@ql-tro/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Public, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { CreditsService } from './credits.service.js';
import { DebtsService } from './debts.service.js';
import { PaymentsService } from './payments.service.js';
import { SharingService } from './sharing.service.js';

const ok = z.object({ ok: z.literal(true) });
const ids = z.object({ ids: z.array(z.string()) });
const refundCreated = z.object({ id: z.string(), paid_at: z.string() });

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly credits: CreditsService,
    private readonly debts: DebtsService,
    private readonly sharing: SharingService,
  ) {}

  // ---------- Phiếu thu ----------

  @Post('payments')
  @RequirePermissions(PERMISSIONS.PAYMENTS_RECORD)
  @ApiOperation({ summary: 'Ghi nhận thu (đã thực nhận), phân bổ vào thông báo; không vượt số còn phải thu. Cần Idempotency-Key' })
  @ApiZodBody(paymentCreateSchema)
  @ApiZodResponse(201, paymentSchema, 'Đã ghi phiếu thu')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async create(
    @CurrentUser() user: AuthUser,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(paymentCreateSchema)) body: z.output<typeof paymentCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.payments.create(user, body, key);
    res.status(r.status);
    return r.body;
  }

  @Get('payments')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Danh sách phiếu thu' })
  @ApiZodResponse(200, pagedSchema(paymentSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paymentListQuerySchema)) q: z.output<typeof paymentListQuerySchema>) {
    return this.payments.list(user, q);
  }

  @Get('tenancies/:id/payment-receivers')
  @RequirePermissions(PERMISSIONS.PAYMENTS_RECORD)
  @ApiOperation({ summary: 'Người có thể nhận tiền khi ghi nhận thu cho lần thuê này (chủ trọ/quản lý có quyền thu ở tòa)' })
  @ApiZodResponse(200, paymentReceiversSchema, 'Danh sách')
  @ApiErrorResponses(400, 401, 403, 404)
  receivers(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.payments.receiversForTenancy(user, id);
  }

  @Get('payments/:id')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Chi tiết phiếu thu' })
  @ApiZodResponse(200, paymentSchema, 'Phiếu thu')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.payments.get(user, id);
  }

  @Post('payments/:id/reverse')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_REVERSE)
  @ApiOperation({ summary: 'Đảo toàn bộ phiếu thu (có lý do); nợ quay lại thông báo gốc. Cần Idempotency-Key' })
  @ApiZodBody(reverseSchema)
  @ApiZodResponse(200, paymentSchema, 'Đã đảo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(reverseSchema)) body: z.output<typeof reverseSchema>,
  ) {
    return (await this.payments.reverse(user, id, body.reason, key)).body;
  }

  @Get('invoices/:id/settlements')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Các khoản đã thu/cấn trừ của thông báo (hoặc đã dùng, với chứng từ credit)' })
  @ApiZodResponse(200, invoiceSettlementsSchema, 'Khoản thu')
  @ApiErrorResponses(400, 401, 403, 404)
  settlements(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.payments.invoiceSettlements(user, id);
  }

  // ---------- Credit ----------

  @Post('credit-applications')
  @RequirePermissions(PERMISSIONS.INVOICES_ADJUST)
  @ApiOperation({ summary: 'Cấn trừ credit vào thông báo còn nợ của cùng lần thuê (mặc định đến hạn sớm nhất trước). Cần Idempotency-Key' })
  @ApiZodBody(creditApplySchema)
  @ApiZodResponse(201, ids, 'Các khoản cấn trừ đã tạo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async apply(
    @CurrentUser() user: AuthUser,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(creditApplySchema)) body: z.output<typeof creditApplySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.credits.apply(user, body, key);
    res.status(r.status);
    return r.body;
  }

  @Post('credit-applications/:id/reverse')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_REVERSE)
  @ApiOperation({ summary: 'Đảo khoản cấn trừ credit. Cần Idempotency-Key' })
  @ApiZodBody(reverseSchema)
  @ApiZodResponse(200, ok, 'Đã đảo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async reverseApplication(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(reverseSchema)) body: z.output<typeof reverseSchema>,
  ) {
    return (await this.credits.reverseApplication(user, id, body.reason, key)).body;
  }

  @Post('credit-refunds')
  @RequirePermissions(PERMISSIONS.CREDIT_REFUND)
  @ApiOperation({ summary: 'Ghi hoàn credit cho khách khi đã thực chi (không dùng sổ cọc). Cần Idempotency-Key' })
  @ApiZodBody(creditRefundCreateSchema)
  @ApiZodResponse(201, refundCreated, 'Đã ghi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async refund(
    @CurrentUser() user: AuthUser,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(creditRefundCreateSchema)) body: z.output<typeof creditRefundCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.credits.refund(user, body, key);
    res.status(r.status);
    return r.body;
  }

  @Post('credit-refunds/:id/reverse')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_REVERSE)
  @ApiOperation({ summary: 'Đảo khoản hoàn credit. Cần Idempotency-Key' })
  @ApiZodBody(reverseSchema)
  @ApiZodResponse(200, ok, 'Đã đảo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async reverseRefund(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(reverseSchema)) body: z.output<typeof reverseSchema>,
  ) {
    return (await this.credits.reverseRefund(user, id, body.reason, key)).body;
  }

  // ---------- Công nợ ----------

  @Get('debts')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Công nợ theo lần thuê (gồm lần thuê đã kết thúc còn nợ), credit còn lại' })
  @ApiZodResponse(200, debtListSchema, 'Công nợ')
  @ApiErrorResponses(400, 401, 403)
  debtList(@CurrentUser() user: AuthUser, @Query(new ZodPipe(debtQuerySchema)) q: z.output<typeof debtQuerySchema>) {
    return this.debts.list(user, q);
  }

  @Get('tenancies/:id/statement')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Sao kê lần thuê: thông báo, phiếu thu, đảo, trừ cọc, hoàn credit, số dư' })
  @ApiZodResponse(200, statementSchema, 'Sao kê')
  @ApiErrorResponses(400, 401, 403, 404)
  statement(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.debts.statement(user, id);
  }

  // ---------- Tài khoản nhận tiền, VietQR, link ----------

  @Get('settings/payment-account')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Tài khoản nhận tiền đang dùng cho VietQR (null nếu chưa cấu hình)' })
  @ApiZodResponse(200, paymentAccountSchema.nullable(), 'Tài khoản')
  @ApiErrorResponses(401, 403)
  account(@CurrentUser() user: AuthUser) {
    return this.sharing.getAccount(user);
  }

  @Put('settings/payment-account')
  @RequirePermissions(PERMISSIONS.PAYMENT_ACCOUNTS_MANAGE)
  @ApiOperation({ summary: 'Đặt/thay tài khoản nhận tiền (tài khoản cũ ngưng, giữ lịch sử)' })
  @ApiZodBody(paymentAccountInputSchema)
  @ApiZodResponse(200, paymentAccountSchema, 'Đã lưu')
  @ApiErrorResponses(400, 401, 403, 409)
  putAccount(@CurrentUser() user: AuthUser, @Body(new ZodPipe(paymentAccountInputSchema)) body: z.output<typeof paymentAccountInputSchema>) {
    return this.sharing.putAccount(user, body);
  }

  @Get('invoices/:id/vietqr')
  @RequirePermissions(PERMISSIONS.INVOICES_VIEW)
  @ApiOperation({ summary: 'Payload VietQR + thông tin chuyển khoản; 422 nếu không còn nợ. Không đổi trạng thái tiền' })
  @ApiZodResponse(200, vietQrSchema, 'QR')
  @ApiErrorResponses(400, 401, 403, 404, 422)
  vietqr(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.sharing.invoiceQr(user, id);
  }

  @Post('invoices/:id/share-links')
  @RequirePermissions(PERMISSIONS.INVOICES_SHARE)
  @ApiOperation({ summary: 'Tạo link xem thông báo cho khách (token trả một lần, DB chỉ lưu hash, hạn 60 ngày)' })
  @ApiZodResponse(201, shareLinkCreatedSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 404, 422)
  createLink(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.sharing.createLink(user, id);
  }

  @Get('invoices/:id/share-links')
  @RequirePermissions(PERMISSIONS.INVOICES_SHARE)
  @ApiOperation({ summary: 'Các link xem thông báo đã tạo' })
  @ApiZodResponse(200, z.array(shareLinkSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403, 404)
  links(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.sharing.listLinks(user, id);
  }

  @Post('share-links/:id/revoke')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INVOICES_SHARE)
  @ApiOperation({ summary: 'Thu hồi link xem thông báo' })
  @ApiZodResponse(200, shareLinkSchema, 'Đã thu hồi')
  @ApiErrorResponses(400, 401, 403, 404)
  revoke(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.sharing.revokeLink(user, id);
  }

  @Get('public/invoices/:token')
  @Public()
  @ApiOperation({ summary: 'Xem thông báo qua link (công khai, giới hạn truy cập). Sai/hết hạn/thu hồi: cùng một lỗi' })
  @ApiZodResponse(200, publicInvoiceSchema, 'Thông báo')
  @ApiErrorResponses(404, 429)
  async publicInvoice(@Param('token') token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return this.sharing.publicView(token, req.ip ?? 'unknown');
  }
}
