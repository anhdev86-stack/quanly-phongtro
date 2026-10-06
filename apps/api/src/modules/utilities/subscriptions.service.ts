import { Inject, Injectable } from '@nestjs/common';
import type { tenancyServiceChangeSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode, violatedConstraint } from '../../common/db/pg-errors.js';
import { day, dayOrNull } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { TenancyService } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { RoomsService } from '../rooms/rooms.service.js';

type Change = z.output<typeof tenancyServiceChangeSchema>;

/**
 * Dịch vụ của lần thuê có phiên bản theo ngày (MASTER_PLAN 6.4, 8.4): thêm, đổi số lượng (VD số xe), ngưng.
 * Không sửa đè phiên bản cũ: đổi số lượng = kết thúc phiên bản đang dùng tại ngày đổi và mở phiên bản mới.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: AuthUser, tenancyId: string) {
    await this.tenancyInScope(this.prisma, user, tenancyId);
    const rows = await this.prisma.tenancyService.findMany({
      where: { tenancyId },
      include: { service: true },
      orderBy: [{ service: { code: 'asc' } }, { effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((s) => ({
      id: s.id,
      service_id: s.serviceId,
      service_name: s.service.name,
      service_type: s.service.type,
      unit: s.service.unit,
      effective_from: day(s.effectiveFrom),
      end_exclusive: dayOrNull(s.endExclusive),
      quantity: s.quantity.toString(),
      status: s.status,
    }));
  }

  async change(user: AuthUser, tenancyId: string, input: Change) {
    try {
      await runInTransaction(this.prisma, async (tx) => {
        const t0 = await this.tenancyInScope(tx, user, tenancyId);
        await lockRows(tx, 'rooms', [t0.roomId]);
        await lockRows(tx, 'tenancies', [tenancyId]);
        const tenancy = await tx.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
        if (tenancy.status === 'ENDED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê đã kết thúc.');
        if (input.effective_from < fromDbDate(tenancy.startDate)) {
          throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày hiệu lực trước ngày nhận phòng.', { effective_from: ['Trước ngày nhận phòng.'] });
        }
        const service = await tx.service.findFirst({ where: { id: input.service_id, workspaceId: user.workspaceId } });
        if (!service) throw new AppError('NOT_FOUND', 'Dịch vụ không tồn tại.');
        if (service.type === 'METER') throw new AppError('BUSINESS_RULE_VIOLATION', 'Điện/nước theo đồng hồ tính từ chỉ số, không thêm như dịch vụ.');
        if (!input.effective_from.endsWith('-01') && !input.confirm_mid_month) {
          throw new AppError('BUSINESS_RULE_VIOLATION', 'Thay đổi có hiệu lực giữa tháng: phí tháng đó sẽ chia theo ngày. Hãy xác nhận để tiếp tục.', {
            confirm_mid_month: ['Cần xác nhận thay đổi giữa tháng.'],
          });
        }
        const d = toDbDate(input.effective_from);
        const covering = await tx.tenancyService.findFirst({
          where: { tenancyId, serviceId: service.id, status: 'ACTIVE', effectiveFrom: { lte: d }, OR: [{ endExclusive: null }, { endExclusive: { gt: d } }] },
        });
        const now = this.clock.now();
        const voidRow = (row: TenancyService, reason: string) =>
          tx.tenancyService.update({ where: { id: row.id }, data: { status: 'VOIDED', voidedAt: now, voidedBy: user.id, voidReason: reason } });

        let before: unknown = covering ? { quantity: covering.quantity.toString(), effective_from: day(covering.effectiveFrom) } : null;
        if (input.action === 'ADD') {
          if (service.archivedAt) throw new AppError('BUSINESS_RULE_VIOLATION', 'Dịch vụ đã ngừng cung cấp.');
          let dual = false;
          if (service.substitutesMeter) {
            const meter = await tx.meter.findFirst({ where: { roomId: tenancy.roomId, type: service.substitutesMeter, retiredOn: null } });
            if (meter && !input.confirm_dual_utility) {
              throw new AppError(
                'BUSINESS_RULE_VIOLATION',
                `Phòng đang có đồng hồ ${service.substitutesMeter === 'WATER' ? 'nước' : 'điện'}. Bật “${service.name}” nghĩa là tính cả hai khoản độc lập; hãy xác nhận.`,
                { confirm_dual_utility: ['Cần xác nhận tính cả hai khoản.'] },
              );
            }
            dual = !!meter;
          }
          await tx.tenancyService.create({
            data: {
              tenancyId,
              serviceId: service.id,
              effectiveFrom: d,
              quantity: input.quantity,
              reason: input.reason,
              billingPolicySnapshot: dual ? { dual_utility_confirmed: true } : undefined,
              createdBy: user.id,
            },
          });
        } else {
          if (!covering) throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê không dùng dịch vụ này vào ngày đã chọn.', { effective_from: ['Không có dịch vụ đang dùng.'] });
          const later = await tx.tenancyService.findFirst({ where: { tenancyId, serviceId: service.id, status: 'ACTIVE', effectiveFrom: { gt: d } } });
          if (later) throw new AppError('BUSINESS_RULE_VIOLATION', `Đã có thay đổi từ ngày ${day(later.effectiveFrom)}; hãy thao tác theo thứ tự thời gian.`);
          const startsSameDay = day(covering.effectiveFrom) === input.effective_from;
          if (input.action === 'CHANGE_QUANTITY') {
            if (covering.quantity.equals(input.quantity)) {
              throw new AppError('BUSINESS_RULE_VIOLATION', 'Số lượng không đổi.', { quantity: ['Số lượng không đổi.'] });
            }
            if (startsSameDay) await voidRow(covering, `Thay bằng số lượng ${input.quantity}: ${input.reason}`);
            else await tx.tenancyService.update({ where: { id: covering.id }, data: { endExclusive: d } });
            await tx.tenancyService.create({
              data: { tenancyId, serviceId: service.id, effectiveFrom: d, endExclusive: covering.endExclusive, quantity: input.quantity, reason: input.reason, createdBy: user.id },
            });
          } else if (startsSameDay) {
            await voidRow(covering, `Ngưng: ${input.reason}`);
          } else {
            await tx.tenancyService.update({ where: { id: covering.id }, data: { endExclusive: d } });
          }
          before = { ...(before as object), id: covering.id };
        }
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: `tenancy_service.${input.action.toLowerCase()}`,
          entityType: 'tenancy',
          entityId: tenancyId,
          reason: input.reason ?? null,
          before,
          after: input,
        });
      });
    } catch (error) {
      if (pgErrorCode(error) === PG.EXCLUSION_VIOLATION && violatedConstraint(error) === 'no_overlapping_tenancy_services') {
        throw new AppError('CONFLICT', 'Dịch vụ này đã được dùng trong khoảng thời gian đã chọn. Hãy đổi số lượng thay vì thêm mới.', {
          service_id: ['Đang dùng dịch vụ này.'],
        });
      }
      throw error;
    }
    return this.list(user, tenancyId);
  }

  private async tenancyInScope(db: Db, user: AuthUser, tenancyId: string) {
    const t = await db.tenancy.findFirst({ where: { id: tenancyId, room: this.rooms.roomWhere(user) } });
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }
}

