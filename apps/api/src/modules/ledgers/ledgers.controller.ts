import { Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IDEMPOTENCY_HEADER,
  PERMISSIONS,
  depositLedgerSchema,
  depositTxCreateSchema,
  holdingLedgerSchema,
  holdingTxCreateSchema,
  reverseSchema,
} from '@ql-tro/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { LedgersService } from './ledgers.service.js';

const idRef = z.object({ id: z.string() });
const ok = z.object({ ok: z.literal(true) });

@ApiTags('deposits')
@Controller()
export class LedgersController {
  constructor(private readonly ledgers: LedgersService) {}

  @Get('tenancies/:id/deposit-transactions')
  @RequirePermissions(PERMISSIONS.TENANTS_VIEW)
  @ApiOperation({ summary: 'Sổ cọc của lần thuê: tổng hợp và giao dịch' })
  @ApiZodResponse(200, depositLedgerSchema, 'Sổ cọc')
  @ApiErrorResponses(400, 401, 403, 404)
  deposit(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.ledgers.depositLedger(user, id);
  }

  @Post('tenancies/:id/deposit-transactions')
  @RequirePermissions(PERMISSIONS.DEPOSIT_RECORD)
  @ApiOperation({ summary: 'Ghi giao dịch cọc thực tế (nhận/nhận thêm; hoàn cần deposit.refund; khấu trừ cần settlement.approve). Cần Idempotency-Key' })
  @ApiZodBody(depositTxCreateSchema)
  @ApiZodResponse(201, idRef, 'Đã ghi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async createDeposit(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(depositTxCreateSchema)) body: z.output<typeof depositTxCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.ledgers.createDeposit(user, id, body, key);
    res.status(r.status);
    return r.body;
  }

  @Post('deposit-transactions/:id/reverse')
  @RequirePermissions(PERMISSIONS.FINANCE_REVERSE)
  @ApiOperation({ summary: 'Đảo giao dịch cọc (cặp liên kết được đảo cả cặp). Cần Idempotency-Key' })
  @ApiZodBody(reverseSchema)
  @ApiZodResponse(201, ok, 'Đã đảo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async reverseDeposit(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(reverseSchema)) body: z.output<typeof reverseSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.ledgers.reverseDeposit(user, id, body.reason, key);
    res.status(r.status);
    return r.body;
  }

  @Get('reservations/:id/holding-transactions')
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Sổ tiền giữ chỗ của lượt giữ phòng' })
  @ApiZodResponse(200, holdingLedgerSchema, 'Sổ giữ chỗ')
  @ApiErrorResponses(400, 401, 403, 404)
  holding(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.ledgers.holdingLedger(user, id);
  }

  @Post('reservations/:id/holding-transactions')
  @RequirePermissions(PERMISSIONS.HOLDING_RECORD)
  @ApiOperation({ summary: 'Ghi tiền giữ chỗ: nhận; hoàn (holding.refund); giữ lại theo thỏa thuận (holding.forfeit). Cần Idempotency-Key' })
  @ApiZodBody(holdingTxCreateSchema)
  @ApiZodResponse(201, idRef, 'Đã ghi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async createHolding(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(holdingTxCreateSchema)) body: z.output<typeof holdingTxCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.ledgers.createHolding(user, id, body, key);
    res.status(r.status);
    return r.body;
  }

  @Post('holding-transactions/:id/reverse')
  @RequirePermissions(PERMISSIONS.FINANCE_REVERSE)
  @ApiOperation({ summary: 'Đảo giao dịch giữ chỗ (chuyển thành cọc thì đảo cả cặp). Cần Idempotency-Key' })
  @ApiZodBody(reverseSchema)
  @ApiZodResponse(201, ok, 'Đã đảo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async reverseHolding(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(reverseSchema)) body: z.output<typeof reverseSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.ledgers.reverseHolding(user, id, body.reason, key);
    res.status(r.status);
    return r.body;
  }
}
