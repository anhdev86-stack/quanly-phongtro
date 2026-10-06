import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  pagedSchema,
  reservationCancelSchema,
  reservationCreateSchema,
  reservationListQuerySchema,
  reservationRescheduleSchema,
  reservationSchema,
} from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { ReservationsService } from './reservations.service.js';

@ApiTags('reservations')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Danh sách giữ phòng' })
  @ApiZodResponse(200, pagedSchema(reservationSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(reservationListQuerySchema)) q: z.output<typeof reservationListQuerySchema>) {
    return this.reservations.list(user, q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.RESERVATIONS_MANAGE)
  @ApiOperation({ summary: 'Tạo giữ phòng (chống chồng lịch)' })
  @ApiZodBody(reservationCreateSchema)
  @ApiZodResponse(201, reservationSchema, 'Đã tạo')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(reservationCreateSchema)) body: z.output<typeof reservationCreateSchema>) {
    return this.reservations.create(user, body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ROOMS_VIEW)
  @ApiOperation({ summary: 'Chi tiết giữ phòng' })
  @ApiZodResponse(200, reservationSchema, 'Giữ phòng')
  @ApiErrorResponses(400, 401, 403, 404)
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.reservations.get(user, id);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.RESERVATIONS_MANAGE)
  @ApiOperation({ summary: 'Đổi lịch giữ phòng' })
  @ApiZodBody(reservationRescheduleSchema)
  @ApiZodResponse(200, reservationSchema, 'Đã đổi lịch')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(reservationRescheduleSchema)) body: z.output<typeof reservationRescheduleSchema>,
  ) {
    return this.reservations.reschedule(user, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.RESERVATIONS_MANAGE)
  @ApiOperation({ summary: 'Hủy giữ phòng (tiền giữ chỗ không tự mất)' })
  @ApiZodBody(reservationCancelSchema)
  @ApiZodResponse(200, reservationSchema, 'Đã hủy')
  @ApiErrorResponses(400, 401, 403, 404, 409, 422)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(reservationCancelSchema)) body: z.output<typeof reservationCancelSchema>,
  ) {
    return this.reservations.cancel(user, id, body);
  }
}
