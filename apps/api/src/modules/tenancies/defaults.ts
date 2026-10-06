import { Injectable } from '@nestjs/common';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import type { DepositRequirementProvider } from '../ledgers/ledgers.service.js';
import type { RentalModeProvider } from './tenancies.service.js';

/** Mức cọc yêu cầu lúc nhận phòng (Phase 3 thay bằng cách suy ra từ hợp đồng còn hiệu lực). */
@Injectable()
export class InitialDepositRequirement implements DepositRequirementProvider {
  async requiredDeposit(db: Db, tenancyId: string): Promise<bigint> {
    const t = await db.tenancy.findUnique({ where: { id: tenancyId }, select: { initialDepositRequiredVnd: true } });
    return t?.initialDepositRequiredVnd ?? 0n;
  }
}

/** Chưa có hợp đồng thì mọi lần thuê là thuê theo tháng (Phase 3 thay). */
@Injectable()
export class NoContractRentalMode implements RentalModeProvider {
  async rentalModes(_db: Db, tenancyIds: string[]): Promise<Map<string, 'FIXED_TERM' | 'MONTH_TO_MONTH'>> {
    return new Map(tenancyIds.map((id) => [id, 'MONTH_TO_MONTH']));
  }
}
