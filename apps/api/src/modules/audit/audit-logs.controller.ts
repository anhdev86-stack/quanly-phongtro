import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditListQuerySchema, auditLogSchema, pagedSchema } from '@ql-tro/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { AuditLogsService } from './audit-logs.service.js';

const auditPageSchema = pagedSchema(auditLogSchema).extend({ categories: z.array(z.enum(['OPERATIONS', 'FINANCE', 'SYSTEM'])) });

@ApiTags('audit')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly logs: AuditLogsService) {}

  @Get()
  // Cần một trong: audit.view (toàn bộ), audit.view_operations, audit.view_finance — kiểm tra trong service (403 nếu không có).
  @RequirePermissions()
  @ApiOperation({ summary: 'Tra cứu nhật ký thao tác theo nhóm và tòa được giao (cần audit.view / audit.view_operations / audit.view_finance)' })
  @ApiZodResponse(200, auditPageSchema, 'Danh sách')
  @ApiErrorResponses(400, 401, 403, 404)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(auditListQuerySchema)) q: z.output<typeof auditListQuerySchema>) {
    return this.logs.list(user, q);
  }
}
