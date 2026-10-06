import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { firstDayOfMonth, fromDbDate } from '../../domain/dates/date-only.js';
import type { Prisma, Tenancy } from '../../generated/prisma/client.js';
import type { MoveInExtension } from '../tenancies/tenancies.service.js';
import { BillingService } from './billing.service.js';

/**
 * Bước 8 của nhận phòng (MASTER_PLAN 7.2): sinh thông báo đầu tiên dạng DRAFT cho tháng nhận phòng — tiền phòng
 * từ ngày nhận đến hết tháng (chia theo ngày) cộng dịch vụ thu trước; đến hạn vào ngày nhận phòng. Cùng transaction.
 */
@Injectable()
export class BillingMoveInExtension implements MoveInExtension {
  constructor(private readonly billing: BillingService) {}

  async afterMoveIn(tx: Prisma.TransactionClient, user: AuthUser, tenancy: Tenancy): Promise<void> {
    await this.billing.generateInTx(tx, user, tenancy.id, firstDayOfMonth(fromDbDate(tenancy.startDate)));
  }
}
