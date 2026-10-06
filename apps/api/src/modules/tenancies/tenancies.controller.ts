import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IDEMPOTENCY_HEADER,
  PERMISSIONS,
  memberAddSchema,
  memberLeaveSchema,
  memberResidenceSchema,
  memberSetPrimarySchema,
  moveInSchema,
  pagedSchema,
  tenancyDetailSchema,
  tenancyListQuerySchema,
  tenancySummarySchema,
} from '@ql-tro/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { MembersService } from './members.service.js';
import { TenanciesService } from './tenancies.service.js';

const createdRef = z.object({ id: z.string(), code: z.string() });

@ApiTags('tenancies')
@Controller()
export class TenanciesController {
  constructor(
    private readonly tenancies: TenanciesService,
    private readonly members: MembersService,
  ) {}

  @Get('tenancies')
  @RequirePermissions(PERMISSIONS.TENANTS_VIEW)
  @ApiOperation({ summary: 'Danh sách lần thuê (lọc trạng thái, tòa, phòng, người thuê)' })
  @ApiZodResponse(200, pagedSchema(tenancySummarySchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(tenancyListQuerySchema)) q: z.output<typeof tenancyListQuerySchema>) {
    return this.tenancies.list(user, q);
  }

  @Post('tenancies/move-in')
  @RequirePermissions(PERMISSIONS.TENANCIES_MOVE_IN)
  @ApiOperation({ summary: 'Nhận phòng (một transaction; cần Idempotency-Key)' })
  @ApiZodBody(moveInSchema)
  @ApiZodResponse(201, createdRef, 'Đã nhận phòng')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  async moveIn(
    @CurrentUser() user: AuthUser,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body(new ZodPipe(moveInSchema)) body: z.output<typeof moveInSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.tenancies.moveIn(user, body, key);
    res.status(r.status);
    return r.body;
  }

  @Get('tenancies/:id')
  @RequirePermissions(PERMISSIONS.TENANTS_VIEW)
  @ApiOperation({ summary: 'Chi tiết lần thuê: thành viên, giá, dịch vụ, cọc' })
  @ApiZodResponse(200, tenancyDetailSchema, 'Lần thuê')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.tenancies.get(user, id);
  }

  @Post('tenancies/:id/members')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.TENANTS_MANAGE)
  @ApiOperation({ summary: 'Thêm thành viên (cần expected_version của lần thuê)' })
  @ApiZodBody(memberAddSchema)
  @ApiZodResponse(200, tenancyDetailSchema, 'Đã thêm')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  addMember(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(memberAddSchema)) body: z.output<typeof memberAddSchema>) {
    return this.members.add(user, id, body);
  }

  @Post('members/:memberId/leave')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.TENANTS_MANAGE)
  @ApiOperation({ summary: 'Thành viên rời đi (ghi ngày cuối ở; đại diện rời thì chọn người mới)' })
  @ApiZodBody(memberLeaveSchema)
  @ApiZodResponse(200, tenancyDetailSchema, 'Đã cập nhật')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  leave(@CurrentUser() user: AuthUser, @Param('memberId', UuidPipe) id: string, @Body(new ZodPipe(memberLeaveSchema)) body: z.output<typeof memberLeaveSchema>) {
    return this.members.leave(user, id, body);
  }

  @Post('members/:memberId/set-primary')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.TENANTS_MANAGE)
  @ApiOperation({ summary: 'Đổi người đại diện' })
  @ApiZodBody(memberSetPrimarySchema)
  @ApiZodResponse(200, tenancyDetailSchema, 'Đã cập nhật')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  setPrimary(
    @CurrentUser() user: AuthUser,
    @Param('memberId', UuidPipe) id: string,
    @Body(new ZodPipe(memberSetPrimarySchema)) body: z.output<typeof memberSetPrimarySchema>,
  ) {
    return this.members.setPrimary(user, id, body);
  }

  @Post('members/:memberId/residence')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.TENANTS_MANAGE)
  @ApiOperation({ summary: 'Cập nhật tình trạng đăng ký tạm trú' })
  @ApiZodBody(memberResidenceSchema)
  @ApiZodResponse(200, tenancyDetailSchema, 'Đã cập nhật')
  @ApiErrorResponses(400, 401, 403, 404, 409)
  residence(
    @CurrentUser() user: AuthUser,
    @Param('memberId', UuidPipe) id: string,
    @Body(new ZodPipe(memberResidenceSchema)) body: z.output<typeof memberResidenceSchema>,
  ) {
    return this.members.setResidence(user, id, body);
  }
}
