import { Inject, Injectable } from '@nestjs/common';
import { BILLING_SETTINGS_DEFAULTS, type BillingSettings, type BillingSettingsDto, billingSettingsPayloadSchema, type billingSettingsCreateSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode } from '../../common/db/pg-errors.js';
import { day, iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { toDbDate } from '../../domain/dates/date-only.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { type Db, PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { userNames } from './user-names.js';

/** Cấu hình tính phí có phiên bản theo ngày hiệu lực (MASTER_PLAN 4.3). Chưa có phiên bản nào thì dùng mặc định. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async billingPolicy(db: Db, workspaceId: string, onDate: string): Promise<BillingSettings> {
    const row = await db.settingsVersion.findFirst({
      where: { workspaceId, kind: 'BILLING', effectiveFrom: { lte: toDbDate(onDate) } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row ? billingSettingsPayloadSchema.parse(row.payload) : BILLING_SETTINGS_DEFAULTS;
  }

  async getBilling(user: AuthUser): Promise<BillingSettingsDto> {
    const today = this.clock.today();
    const rows = await this.prisma.settingsVersion.findMany({ where: { workspaceId: user.workspaceId, kind: 'BILLING' }, orderBy: { effectiveFrom: 'desc' } });
    const names = await userNames(this.prisma, rows.map((r) => r.createdBy));
    const current = rows.find((r) => day(r.effectiveFrom) <= today) ?? null;
    return {
      current: current ? billingSettingsPayloadSchema.parse(current.payload) : BILLING_SETTINGS_DEFAULTS,
      effective_from: current ? day(current.effectiveFrom) : null,
      history: rows.map((r) => ({
        id: r.id,
        effective_from: day(r.effectiveFrom),
        payload: billingSettingsPayloadSchema.parse(r.payload),
        created_by_name: names.get(r.createdBy) ?? null,
        created_at: iso(r.createdAt)!,
      })),
    };
  }

  /** Tạo phiên bản mới; không sửa phiên bản cũ. Chứng từ đã phát hành giữ chính sách đã snapshot. */
  async createBilling(user: AuthUser, input: z.output<typeof billingSettingsCreateSchema>): Promise<BillingSettingsDto> {
    const { effective_from, ...payload } = input;
    try {
      await runInTransaction(this.prisma, async (tx) => {
        const before = await this.billingPolicy(tx, user.workspaceId, effective_from);
        await tx.settingsVersion.create({
          data: { workspaceId: user.workspaceId, kind: 'BILLING', effectiveFrom: toDbDate(effective_from), payload, createdBy: user.id },
        });
        await this.audit.record(tx, {
          workspaceId: user.workspaceId,
          actorId: user.id,
          action: 'settings.billing.create',
          entityType: 'settings',
          before,
          after: input,
        });
      });
    } catch (error) {
      if (pgErrorCode(error) === PG.UNIQUE_VIOLATION) {
        throw new AppError('CONFLICT', 'Đã có cấu hình có hiệu lực từ đúng ngày này.', { effective_from: ['Trùng ngày hiệu lực.'] });
      }
      throw error;
    }
    return this.getBilling(user);
  }
}
