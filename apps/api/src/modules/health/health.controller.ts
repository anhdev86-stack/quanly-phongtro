import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../../common/auth/decorators.js';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

const liveSchema = z.object({ status: z.literal('ok') });
const readySchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({ database: z.enum(['ok', 'error']) }),
});

/** Liveness tách readiness; không trả về biến môi trường hay chi tiết lỗi (MASTER_PLAN 17). */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Tiến trình còn sống' })
  @ApiZodResponse(200, liveSchema, 'OK')
  live() {
    return { status: 'ok' as const };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Sẵn sàng phục vụ (kiểm tra database)' })
  @ApiZodResponse(200, readySchema, 'Sẵn sàng')
  @ApiZodResponse(503, readySchema, 'Chưa sẵn sàng')
  async ready(@Res({ passthrough: true }) res: Response) {
    let database: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    const status = database === 'ok' ? 'ok' : 'error';
    res.status(status === 'ok' ? 200 : 503);
    return { status, checks: { database } };
  }
}
