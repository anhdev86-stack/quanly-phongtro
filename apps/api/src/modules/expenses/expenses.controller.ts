import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { expenseCreateSchema, expenseListQuerySchema, expenseReverseSchema, expenseSchema, IDEMPOTENCY_HEADER, pagedSchema, PERMISSIONS } from '@ql-tro/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { ExpensesService } from './expenses.service.js';

@ApiTags('expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EXPENSES_VIEW)
  @ApiOperation({ summary: 'Danh sách chi phí trong phạm vi tòa (chi chung chỉ người có mọi tòa thấy)' })
  @ApiZodResponse(200, pagedSchema(expenseSchema).extend({ total_vnd: z.string() }), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(expenseListQuerySchema)) q: z.output<typeof expenseListQuerySchema>) {
    return this.expenses.list(user, q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EXPENSES_RECORD)
  @ApiOperation({ summary: 'Ghi khoản chi đã thực chi. Cần Idempotency-Key' })
  @ApiZodBody(expenseCreateSchema)
  @ApiZodResponse(201, expenseSchema, 'Đã ghi')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async create(
    @CurrentUser() user: AuthUser,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(expenseCreateSchema)) body: z.output<typeof expenseCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.expenses.create(user, body, key);
    res.status(r.status);
    return r.body;
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_REVERSE)
  @ApiOperation({ summary: 'Đảo khoản chi (không xóa), cần lý do. Cần Idempotency-Key' })
  @ApiZodBody(expenseReverseSchema)
  @ApiZodResponse(200, expenseSchema, 'Đã đảo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(expenseReverseSchema)) body: z.output<typeof expenseReverseSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.expenses.reverse(user, id, body.reason, key);
    res.status(r.status);
    return r.body;
  }
}
