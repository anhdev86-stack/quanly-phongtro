import { Injectable } from '@nestjs/common';
import type { moveInSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { rentalMode } from '../../domain/contracts/contract-status.js';
import type { Prisma, Tenancy } from '../../generated/prisma/client.js';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import type { DepositRequirementProvider } from '../ledgers/ledgers.service.js';
import type { MoveInExtension, RentalModeProvider } from '../tenancies/tenancies.service.js';
import { ContractsService, toDates } from './contracts.service.js';

/** Mức cọc yêu cầu hiện hành suy ra từ hợp đồng còn hiệu lực (MASTER_PLAN 7.4). */
@Injectable()
export class ContractDepositRequirement implements DepositRequirementProvider {
  constructor(private readonly contracts: ContractsService) {}

  async requiredDeposit(db: Db, tenancyId: string, onDate: string): Promise<bigint> {
    const t = await db.tenancy.findUnique({ where: { id: tenancyId }, select: { id: true, initialDepositRequiredVnd: true } });
    if (!t) return 0n;
    return this.contracts.requiredDepositOn(db, t, onDate);
  }
}

/** FIXED_TERM / MONTH_TO_MONTH theo hợp đồng đã ký bao phủ ngày (MASTER_PLAN 5.2). */
@Injectable()
export class ContractRentalMode implements RentalModeProvider {
  async rentalModes(db: Db, tenancyIds: string[], onDate: string): Promise<Map<string, 'FIXED_TERM' | 'MONTH_TO_MONTH'>> {
    const rows = await db.contract.findMany({ where: { tenancyId: { in: tenancyIds }, lifecycle: 'SIGNED' } });
    return new Map(tenancyIds.map((id) => [id, rentalMode(rows.filter((r) => r.tenancyId === id).map(toDates), onDate)]));
  }
}

/** Tạo hợp đồng (nháp hoặc đã ký) kèm khi nhận phòng, trong cùng transaction. */
@Injectable()
export class ContractMoveInExtension implements MoveInExtension {
  constructor(private readonly contracts: ContractsService) {}

  async afterMoveIn(tx: Prisma.TransactionClient, user: AuthUser, tenancy: Tenancy, input: z.output<typeof moveInSchema>): Promise<void> {
    if (!input.contract) return;
    await this.contracts.createInTx(
      tx,
      user,
      tenancy,
      {
        term_start: input.contract.term_start,
        term_end: input.contract.term_end,
        notice_days: input.contract.notice_days,
        deposit_required_vnd: input.deposit_required_vnd,
        monthly_rent_vnd: input.monthly_rent_vnd,
        terms_note: input.contract.terms_note,
        signed: input.contract.signed,
        signed_at: input.contract.signed ? (input.contract.signed_at ?? input.start_date) : null,
        confirm_mid_month_price: false,
      },
      false,
    );
  }
}
