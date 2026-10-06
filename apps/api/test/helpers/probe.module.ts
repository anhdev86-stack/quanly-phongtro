import { Body, Controller, Get, Headers, Module, Param, Post, Res } from '@nestjs/common';
import { IDEMPOTENCY_HEADER, PERMISSIONS } from '@ql-tro/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../src/common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../src/common/auth/decorators.js';
import { AppError } from '../../src/common/errors/app-error.js';
import { UuidPipe } from '../../src/common/validation/uuid.pipe.js';
import { ZodPipe } from '../../src/common/validation/zod.pipe.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { AccessService } from '../../src/modules/access/access.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { IdempotencyService } from '../../src/modules/idempotency/idempotency.service.js';

const idempotentBody = z.strictObject({
  note: z.string().max(100),
  fail: z.boolean().optional(),
  delayMs: z.number().int().min(0).max(2000).optional(),
});

/**
 * Endpoint CHỈ dùng trong integration test, để kiểm tra hạ tầng Phase 0 (guard, phạm vi tòa, idempotency)
 * khi chưa có module nghiệp vụ. Không bao giờ được import vào AppModule.
 */
@Controller('__probe')
class ProbeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('buildings')
  @RequirePermissions(PERMISSIONS.BUILDINGS_VIEW)
  async listBuildings(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.building.findMany({ where: this.access.buildingWhere(user), orderBy: { code: 'asc' } });
    return rows.map((b) => b.code);
  }

  @Get('buildings/:id')
  @RequirePermissions(PERMISSIONS.BUILDINGS_VIEW)
  async getBuilding(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    const b = await this.access.getBuildingInScope(this.prisma, user, id);
    return { id: b.id, code: b.code };
  }

  @Post('owner-only')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  ownerOnly() {
    return { ok: true };
  }

  @Post('idempotent')
  @RequirePermissions()
  async idempotent(
    @CurrentUser() user: AuthUser,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(idempotentBody)) body: z.output<typeof idempotentBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.execute(
      { user, route: 'POST /__probe/idempotent', key, payload: body, successStatus: 201 },
      async (tx) => {
        const auditId = await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'probe.idempotent',
          entityType: 'probe',
          after: { note: body.note },
        });
        if (body.delayMs) await new Promise((r) => setTimeout(r, body.delayMs));
        if (body.fail) throw new AppError('BUSINESS_RULE_VIOLATION', 'Lỗi giả lập sau khi đã ghi dữ liệu.');
        return { body: { auditId, note: body.note }, resultReference: auditId };
      },
    );
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
