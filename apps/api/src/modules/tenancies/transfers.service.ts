import { Inject, Injectable } from '@nestjs/common';
import { type roomTransferCreateSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppError } from '../../common/errors/app-error.js';
import { addDays, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { LedgersService } from '../ledgers/ledgers.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { TenanciesService } from './tenancies.service.js';

type Input = z.output<typeof roomTransferCreateSchema>;

/**
 * Chuyển phòng (V1.1, MASTER_PLAN 7.7, T48). Bước 1 làm bằng quy trình trả phòng sẵn có: quyết toán lần thuê cũ với ngày cuối tính
 * tiền là ngày trước ngày sang phòng mới (thông báo cuối, áp cọc/khấu trừ nếu có). Bước 2 (service này), trong một transaction:
 * nhận phòng mới cho cùng người thuê (dùng chung logic nhận phòng), chuyển cọc còn giữ bằng cặp TRANSFER_OUT ↔ TRANSFER_IN liên kết
 * nhau, ghi `room_transfers`. Credit còn dư của lần thuê cũ KHÔNG chuyển: chỉ cấn trừ nợ cũ hoặc hoàn. Đảo một phía cặp chuyển cọc
 * luôn đảo cả cặp (LedgersService).
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly tenancies: TenanciesService,
    private readonly ledgers: LedgersService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async transfer(user: AuthUser, fromId: string, input: Input, key: string | undefined) {
    const head = await this.prisma.tenancy.findFirst({ where: { id: fromId, workspaceId: user.workspaceId, room: this.rooms.roomWhere(user) }, select: { roomId: true } });
    if (!head) throw new AppError('NOT_FOUND');
    try {
      return await this.idempotency.execute({ user, route: `POST /tenancies/${fromId}/transfer`, key, payload: input, successStatus: 201 }, async (tx) => {
        // Thứ tự khóa: phòng (cũ + mới) → lần thuê cũ (6.9).
        await lockRows(tx, 'rooms', [head.roomId, input.to_room_id]);
        await lockRows(tx, 'tenancies', [fromId]);
        const from = await tx.tenancy.findUniqueOrThrow({ where: { id: fromId }, include: { members: true, room: { select: { code: true } } } });
        if (input.to_room_id === from.roomId) throw new AppError('VALIDATION_FAILED', undefined, { to_room_id: ['Chọn phòng khác phòng đang ở.'] });
        if (from.status !== 'ENDED' || !from.chargeEndExclusive) {
          throw new AppError('BUSINESS_RULE_VIOLATION', 'Hãy làm trả phòng và hoàn tất quyết toán của phòng cũ trước (ngày cuối tính tiền là ngày trước ngày sang phòng mới).');
        }
        const completed = await tx.moveOutSettlement.count({ where: { tenancyId: fromId, status: 'COMPLETED' } });
        if (!completed) throw new AppError('BUSINESS_RULE_VIOLATION', 'Quyết toán phòng cũ chưa hoàn tất.');
        const expected = fromDbDate(from.chargeEndExclusive);
        if (input.start_date !== expected) {
          throw new AppError('BUSINESS_RULE_VIOLATION', `Phòng cũ tính tiền đến hết ngày ${addDays(expected, -1)}: ngày nhận phòng mới phải là ${expected}.`, {
            start_date: [`Phải là ${expected}.`],
          });
        }
        if (await tx.roomTransfer.findUnique({ where: { fromTenancyId: fromId } })) throw new AppError('CONFLICT', 'Lần thuê này đã được chuyển phòng.');
        const people = new Set(from.members.map((m) => m.tenantId));
        for (const [i, id] of [input.primary_tenant_id, ...input.member_tenant_ids].entries()) {
          if (!people.has(id)) {
            throw new AppError('VALIDATION_FAILED', undefined, { [i === 0 ? 'primary_tenant_id' : `member_tenant_ids.${i - 1}`]: ['Không phải người của lần thuê cũ.'] });
          }
        }
        const held = await this.ledgers.depositHeld(tx, fromId);
        const amount = input.deposit_transfer_vnd === null ? held : BigInt(input.deposit_transfer_vnd);
        if (amount > held) {
          throw new AppError('BUSINESS_RULE_VIOLATION', `Cọc đang giữ của phòng cũ là ${held.toLocaleString('vi-VN')} ₫, không chuyển nhiều hơn.`, { deposit_transfer_vnd: ['Vượt số cọc đang giữ.'] });
        }

        const to = await this.tenancies.moveInTx(tx, user, {
          room_id: input.to_room_id,
          start_date: input.start_date,
          reservation_id: null,
          primary: { tenant_id: input.primary_tenant_id },
          members: input.member_tenant_ids.map((tenant_id) => ({ tenant_id })),
          monthly_rent_vnd: input.monthly_rent_vnd,
          billing_due_day: input.billing_due_day,
          deposit_required_vnd: input.deposit_required_vnd,
          deposit_received: null,
          services: input.services,
          meter_readings: input.meter_readings,
          contract: null,
          note: `Chuyển từ phòng ${from.room.code} (lần thuê ${from.code})${input.reason ? `: ${input.reason}` : ''}`,
        });

        let outId: string | null = null;
        let inId: string | null = null;
        if (amount > 0n) {
          const reason = `Chuyển cọc ${from.code} → ${to.code}${input.reason ? `: ${input.reason}` : ''}`;
          const paidAt = toDbDate(input.start_date);
          const out = await tx.depositTransaction.create({
            data: { workspaceId: user.workspaceId, tenancyId: fromId, type: 'TRANSFER_OUT', amountVnd: amount, reason, paidAt, createdBy: user.id },
          });
          const inn = await tx.depositTransaction.create({
            data: { workspaceId: user.workspaceId, tenancyId: to.id, type: 'TRANSFER_IN', amountVnd: amount, reason, paidAt, linkedDepositTransactionId: out.id, createdBy: user.id },
          });
          await tx.depositTransaction.update({ where: { id: out.id }, data: { linkedDepositTransactionId: inn.id } });
          await this.ledgers.assertNonNegativeDeposit(tx, fromId);
          outId = out.id;
          inId = inn.id;
        }
        const transfer = await tx.roomTransfer.create({
          data: {
            workspaceId: user.workspaceId,
            fromTenancyId: fromId,
            toTenancyId: to.id,
            transferDate: toDbDate(input.start_date),
            depositAmountVnd: amount,
            depositTransferOutId: outId,
            depositTransferInId: inId,
            reason: input.reason ?? null,
            createdBy: user.id,
          },
        });
        const after = { transfer_id: transfer.id, from_tenancy_id: fromId, to_tenancy_id: to.id, transfer_date: input.start_date, deposit_amount_vnd: amount, credit_not_transferred: true };
        await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'tenancy.transfer_out', entityType: 'tenancy', entityId: fromId, reason: input.reason ?? null, after });
        await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'tenancy.transfer_in', entityType: 'tenancy', entityId: to.id, reason: input.reason ?? null, after });
        return { body: { id: to.id, code: to.code, transfer_id: transfer.id, deposit_amount_vnd: amount.toString() }, resultReference: to.id };
      });
    } catch (error) {
      throw TenanciesService.mapMoveInError(error);
    }
  }
}
