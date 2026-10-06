import { Injectable } from '@nestjs/common';
import type { memberAddSchema, memberLeaveSchema, memberResidenceSchema, memberSetPrimarySchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode } from '../../common/db/pg-errors.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { AppError } from '../../common/errors/app-error.js';
import { addDays, fromDbDate, toDbDate } from '../../domain/dates/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenanciesService } from './tenancies.service.js';

/** Lịch sử thành viên: không xóa người cũ, chỉ ghi ngày rời (MASTER_PLAN 6.3). */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancies: TenanciesService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {}

  async add(user: AuthUser, tenancyId: string, input: z.output<typeof memberAddSchema>) {
    try {
      await runInTransaction(this.prisma, async (tx) => {
        await lockRows(tx, 'tenancies', [tenancyId]);
        const t = await this.tenancies.getRow(tx, user, tenancyId);
        this.assertOpen(t.status);
        if (input.joined_on < fromDbDate(t.startDate)) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày vào ở phải từ ngày nhận phòng trở đi.');
        const presentOn = t.members.filter((m) => fromDbDate(m.joinedOn) <= input.joined_on && (!m.leftOnExclusive || fromDbDate(m.leftOnExclusive) > input.joined_on));
        if (presentOn.length + 1 > t.room.maxOccupants) {
          throw new AppError('BUSINESS_RULE_VIOLATION', `Phòng tối đa ${t.room.maxOccupants} người.`);
        }
        const tenantId =
          'tenant_id' in input.person
            ? (await this.tenants.getRow(tx, user, input.person.tenant_id)).id
            : (await this.tenants.createInTx(tx, user, input.person.new_tenant)).id;
        await updateVersioned(tx.tenancy, { id: tenancyId, workspaceId: user.workspaceId }, input.expected_version, {});
        const m = await tx.tenancyTenant.create({
          data: { workspaceId: user.workspaceId, tenancyId, tenantId, role: 'MEMBER', joinedOn: toDbDate(input.joined_on) },
        });
        await this.auditMember(tx, user, tenancyId, 'tenancy.member_add', { member_id: m.id, tenant_id: tenantId, joined_on: input.joined_on });
      });
    } catch (error) {
      if (pgErrorCode(error) === PG.EXCLUSION_VIOLATION) {
        throw new AppError('CONFLICT', 'Người này đang ở trong lần thuê này trong khoảng thời gian đó.');
      }
      throw error;
    }
    return this.tenancies.get(user, tenancyId);
  }

  async leave(user: AuthUser, memberId: string, input: z.output<typeof memberLeaveSchema>) {
    const member = await this.prisma.tenancyTenant.findFirst({ where: { id: memberId, workspaceId: user.workspaceId } });
    if (!member) throw new AppError('NOT_FOUND');
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [member.tenancyId]);
      const t = await this.tenancies.getRow(tx, user, member.tenancyId);
      this.assertOpen(t.status);
      const current = t.members.find((m) => m.id === memberId);
      if (!current || current.leftOnExclusive) throw new AppError('BUSINESS_RULE_VIOLATION', 'Thành viên đã rời đi.');
      if (input.last_day < fromDbDate(current.joinedOn)) throw new AppError('BUSINESS_RULE_VIOLATION', 'Ngày rời phải từ ngày vào ở trở đi.');
      await updateVersioned(tx.tenancy, { id: t.id, workspaceId: user.workspaceId }, input.expected_version, {});
      const leftOnExclusive = toDbDate(addDays(input.last_day, 1));

      if (current.role === 'PRIMARY') {
        // Chuyển vai trò đại diện trong cùng transaction (MASTER_PLAN 6.3).
        const others = t.members.filter((m) => m.id !== memberId && !m.leftOnExclusive);
        if (others.length === 0) {
          throw new AppError('BUSINESS_RULE_VIOLATION', 'Người đại diện là người cuối cùng của phòng. Hãy dùng quy trình trả phòng.');
        }
        const next = others.find((m) => m.id === input.new_primary_member_id);
        if (!next) throw new AppError('BUSINESS_RULE_VIOLATION', 'Hãy chọn người đại diện mới trong số người đang ở.', { new_primary_member_id: ['Bắt buộc.'] });
        await tx.tenancyTenant.update({ where: { id: memberId }, data: { leftOnExclusive, role: 'MEMBER', version: { increment: 1 } } });
        await tx.tenancyTenant.update({ where: { id: next.id }, data: { role: 'PRIMARY', version: { increment: 1 } } });
      } else {
        await tx.tenancyTenant.update({ where: { id: memberId }, data: { leftOnExclusive, version: { increment: 1 } } });
      }
      await this.auditMember(tx, user, t.id, 'tenancy.member_leave', { member_id: memberId, last_day: input.last_day, new_primary: input.new_primary_member_id });
    });
    return this.tenancies.get(user, member.tenancyId);
  }

  async setPrimary(user: AuthUser, memberId: string, input: z.output<typeof memberSetPrimarySchema>) {
    const member = await this.prisma.tenancyTenant.findFirst({ where: { id: memberId, workspaceId: user.workspaceId } });
    if (!member) throw new AppError('NOT_FOUND');
    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'tenancies', [member.tenancyId]);
      const t = await this.tenancies.getRow(tx, user, member.tenancyId);
      this.assertOpen(t.status);
      const target = t.members.find((m) => m.id === memberId);
      if (!target || target.leftOnExclusive) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chỉ chọn người đang ở làm đại diện.');
      if (target.role === 'PRIMARY') return;
      await updateVersioned(tx.tenancy, { id: t.id, workspaceId: user.workspaceId }, input.expected_version, {});
      // Hạ người cũ trước, rồi nâng người mới (thỏa partial unique one_current_primary ở mọi thời điểm).
      await tx.tenancyTenant.updateMany({ where: { tenancyId: t.id, role: 'PRIMARY', leftOnExclusive: null }, data: { role: 'MEMBER' } });
      await tx.tenancyTenant.update({ where: { id: memberId }, data: { role: 'PRIMARY', version: { increment: 1 } } });
      await this.auditMember(tx, user, t.id, 'tenancy.set_primary', { member_id: memberId });
    });
    return this.tenancies.get(user, member.tenancyId);
  }

  async setResidence(user: AuthUser, memberId: string, input: z.output<typeof memberResidenceSchema>) {
    const member = await this.prisma.tenancyTenant.findFirst({ where: { id: memberId, workspaceId: user.workspaceId } });
    if (!member) throw new AppError('NOT_FOUND');
    await this.tenancies.getRow(this.prisma, user, member.tenancyId);
    await runInTransaction(this.prisma, async (tx) => {
      await updateVersioned(tx.tenancyTenant, { id: memberId, workspaceId: user.workspaceId }, input.expected_version, {
        residenceStatus: input.residence_status,
        residenceRegisteredOn: input.residence_registered_on ? toDbDate(input.residence_registered_on) : null,
        residenceNote: input.residence_note,
      });
      await this.auditMember(tx, user, member.tenancyId, 'tenancy.member_residence', { member_id: memberId, ...input });
    });
    return this.tenancies.get(user, member.tenancyId);
  }

  private assertOpen(status: string) {
    if (status === 'ENDED') throw new AppError('BUSINESS_RULE_VIOLATION', 'Lần thuê đã kết thúc.');
  }

  private auditMember(tx: Prisma.TransactionClient, user: AuthUser, tenancyId: string, action: string, after: unknown) {
    return this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action, entityType: 'tenancy', entityId: tenancyId, after });
  }
}
