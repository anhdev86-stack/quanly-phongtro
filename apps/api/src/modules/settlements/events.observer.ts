import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ReversalObserver } from '../payments/payments.service.js';

const KIND = {
  PAYMENT: 'PAYMENT_REVERSED',
  CREDIT_APPLICATION: 'CREDIT_APPLICATION_REVERSED',
  CREDIT_REFUND: 'CREDIT_REFUND_REVERSED',
  DEPOSIT_TX: 'DEPOSIT_TX_REVERSED',
} as const;

/**
 * Ghi `settlement_events` khi có đảo khoản thu/cọc/credit hoặc thu tiền muộn **sau** khi quyết toán COMPLETED
 * (MASTER_PLAN 9.1). Sự kiện chỉ ghi nhận, không mang số tiền; nợ tự quay lại trên chứng từ gốc, snapshot không đổi.
 */
@Injectable()
export class SettlementEventsObserver implements ReversalObserver {
  async afterReversal(tx: Prisma.TransactionClient, user: AuthUser, tenancyId: string, kind: keyof typeof KIND, refId: string, reason: string): Promise<void> {
    const s = await tx.moveOutSettlement.findFirst({ where: { tenancyId, status: 'COMPLETED' } });
    if (!s) return;
    await tx.settlementEvent.create({
      data: { settlementId: s.id, kind: KIND[kind], linkedEntityType: kind.toLowerCase(), linkedEntityId: refId, note: reason, createdBy: user.id },
    });
  }

  async afterPayment(tx: Prisma.TransactionClient, user: AuthUser, tenancyId: string, paymentId: string): Promise<void> {
    const s = await tx.moveOutSettlement.findFirst({ where: { tenancyId, status: 'COMPLETED' } });
    if (!s) return;
    await tx.settlementEvent.create({
      data: { settlementId: s.id, kind: 'LATE_PAYMENT', linkedEntityType: 'payment', linkedEntityId: paymentId, note: 'Thu tiền sau khi quyết toán', createdBy: user.id },
    });
  }
}
