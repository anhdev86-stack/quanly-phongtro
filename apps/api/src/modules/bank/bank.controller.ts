import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bankAllocateSchema,
  bankConfigSchema,
  bankDismissSchema,
  bankLinkPaymentSchema,
  bankReconcileOptionsSchema,
  bankSimulateResultSchema,
  bankSimulateSchema,
  bankSyncResultSchema,
  bankTransactionListQuerySchema,
  bankTransactionSchema,
  IDEMPOTENCY_HEADER,
  pagedSchema,
  PERMISSIONS,
} from '@ql-tro/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Public, RequirePermissions, SkipCsrf } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { BankTransactionsService } from './bank-transactions.service.js';

const webhookBody = z.record(z.string(), z.unknown());
const webhookAck = z.object({ success: z.literal(true) });

/** Giao dịch ngân hàng tự động (D-047). */
@ApiTags('bank')
@Controller()
export class BankController {
  constructor(private readonly bank: BankTransactionsService) {}

  // ---------- Webhook nhà cung cấp (không đăng nhập; xác thực theo adapter) ----------

  @Post('bank-webhooks/:provider')
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Webhook giao dịch ngân hàng. Xác thực theo nhà cung cấp (SePay/mock: header Authorization: Apikey <khóa>). Lưu bền vững trước khi trả {"success": true}; gửi lại cùng giao dịch không ghi trùng',
  })
  @ApiZodBody(webhookBody)
  @ApiZodResponse(200, webhookAck, 'Đã nhận (kể cả giao dịch trùng)')
  @ApiErrorResponses(400, 401, 404)
  async webhook(@Param('provider') provider: string, @Req() req: Request, @Body() body: unknown) {
    return this.bank.handleWebhook(provider, req.headers, body);
  }

  // ---------- Giao dịch ngân hàng ----------

  @Get('bank-transactions/config')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Chế độ tích hợp ngân hàng (off/mock/test/live), nhà cung cấp, mốc đồng bộ' })
  @ApiZodResponse(200, bankConfigSchema, 'Cấu hình')
  async config(@CurrentUser() user: AuthUser) {
    return this.bank.configView(user);
  }

  @Get('bank-transactions')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Danh sách giao dịch ngân hàng (chủ trọ: tất cả; giới hạn tòa: chỉ giao dịch đã khớp thông báo trong tòa được giao)' })
  @ApiZodResponse(200, pagedSchema(bankTransactionSchema), 'Danh sách')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(bankTransactionListQuerySchema)) q: z.output<typeof bankTransactionListQuerySchema>) {
    return this.bank.list(user, q);
  }

  @Post('bank-transactions/sync')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Lấy bù giao dịch bị lỡ qua API nhà cung cấp (cùng luồng chống ghi trùng); mốc đồng bộ chỉ tiến sau khi lưu xong' })
  @ApiZodResponse(200, bankSyncResultSchema, 'Kết quả')
  @ApiErrorResponses(403, 422, 503)
  async sync(@CurrentUser() user: AuthUser) {
    return this.bank.sync(user);
  }

  @Post('bank-transactions/mock/simulate')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE)
  @ApiOperation({ summary: 'CHỈ MOCK: tạo giao dịch trong ngân hàng giả và gửi webhook (hoặc mô phỏng mất webhook / khóa sai). Bị chặn ở backend khi không phải mock' })
  @ApiZodBody(bankSimulateSchema)
  @ApiZodResponse(201, bankSimulateResultSchema, 'Đã giả lập')
  @ApiErrorResponses(400, 403, 422)
  async simulate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bankSimulateSchema)) body: z.output<typeof bankSimulateSchema>) {
    return this.bank.simulate(user, body);
  }

  @Post('bank-transactions/mock/:mockId/resend')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE)
  @HttpCode(200)
  @ApiOperation({ summary: 'CHỈ MOCK: gửi lại đúng webhook của giao dịch giả lập (kiểm tra không ghi trùng)' })
  @ApiZodResponse(200, bankSimulateResultSchema, 'Đã gửi lại')
  @ApiErrorResponses(403, 404)
  async resend(@CurrentUser() user: AuthUser, @Param('mockId') mockId: string) {
    return this.bank.resend(user, mockId);
  }

  @Get('bank-transactions/:id')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Chi tiết giao dịch ngân hàng, lý do chưa đối chiếu được, phiếu thu liên quan' })
  @ApiZodResponse(200, bankTransactionSchema, 'Giao dịch')
  @ApiErrorResponses(404)
  async get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.bank.get(user, id);
  }

  @Get('bank-transactions/:id/options')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE)
  @ApiOperation({ summary: 'Gợi ý đối chiếu: thông báo còn nợ, phiếu thu chuyển khoản chưa liên kết (trong phạm vi tòa)' })
  @ApiZodResponse(200, bankReconcileOptionsSchema, 'Gợi ý')
  @ApiErrorResponses(404)
  async options(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.bank.options(user, id);
  }

  @Post('bank-transactions/:id/allocate')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE, PERMISSIONS.PAYMENTS_RECORD)
  @ApiOperation({ summary: 'Đối chiếu tay: ghi phiếu thu từ giao dịch vào một thông báo (không vượt phần chưa phân bổ / số còn nợ). Cần Idempotency-Key' })
  @ApiZodBody(bankAllocateSchema)
  @ApiZodResponse(200, bankTransactionSchema, 'Đã ghi nhận')
  @ApiErrorResponses(400, 403, 404, 409, 422)
  async allocate(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(bankAllocateSchema)) body: z.output<typeof bankAllocateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.bank.allocate(user, id, body, key);
    res.status(r.status === 201 ? 200 : r.status);
    return r.body;
  }

  @Post('bank-transactions/:id/link-payment')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE)
  @ApiOperation({ summary: 'Xác nhận giao dịch là phiếu thu chuyển khoản đã ghi tay — chỉ liên kết, không tạo khoản thu mới. Cần Idempotency-Key' })
  @ApiZodBody(bankLinkPaymentSchema)
  @ApiZodResponse(200, bankTransactionSchema, 'Đã liên kết')
  @ApiErrorResponses(400, 403, 404, 409, 422)
  async link(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(bankLinkPaymentSchema)) body: z.output<typeof bankLinkPaymentSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.bank.linkPayment(user, id, body, key);
    res.status(r.status === 201 ? 200 : r.status);
    return r.body;
  }

  @Post('bank-transactions/:id/dismiss')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE)
  @ApiOperation({ summary: 'Phần chưa phân bổ không áp dụng (có lý do). Cần Idempotency-Key' })
  @ApiZodBody(bankDismissSchema)
  @ApiZodResponse(200, bankTransactionSchema, 'Đã cập nhật')
  @ApiErrorResponses(400, 403, 404, 409, 422)
  async dismiss(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(bankDismissSchema)) body: z.output<typeof bankDismissSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.bank.dismiss(user, id, body.reason, key);
    res.status(r.status === 201 ? 200 : r.status);
    return r.body;
  }

  @Post('bank-transactions/:id/retry')
  @RequirePermissions(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Xử lý lại giao dịch lỗi/chưa xử lý bằng luồng tự động' })
  @ApiZodResponse(200, bankTransactionSchema, 'Kết quả')
  @ApiErrorResponses(403, 404, 422)
  async retry(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.bank.retry(user, id);
  }
}
