import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { AuditService } from '../audit/audit.service.js';
import type { ReversalObserver } from '../payments/payments.service.js';

/**
 * Đảo một phiếu thu gắn với giao dịch ngân hàng (D-047): tiền vẫn đã vào tài khoản nên giao dịch quay về “Chờ đối chiếu”
 * (phần chưa phân bổ tính lại từ các phiếu thu còn hiệu lực). Khóa bank_transactions sau cùng theo LOCK_ORDER.
 */
@Injectable()
export class BankReversalObserver implements ReversalObserver {
  constructor(private readonly audit: AuditService) {}

  async afterReversal(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    _tenancyId: string,
    kind: 'PAYMENT' | 'CREDIT_APPLICATION' | 'CREDIT_REFUND' | 'DEPOSIT_TX',
    refId: string,
    reason: string,
  ) {
    if (kind !== 'PAYMENT') return;
    const link = await tx.bankTransactionPayment.findUnique({ where: { paymentId: refId }, include: { payment: { select: { number: true } } } });
    if (!link) return;
    await lockRows(tx, 'bank_transactions', [link.bankTransactionId]);
    const row = await tx.bankTransaction.update({
      where: { id: link.bankTransactionId },
      data: { status: 'PENDING_REVIEW', reason: `Phiếu thu liên kết ${link.payment.number} đã bị đảo (${reason}) — khoản tiền này cần đối chiếu lại.` },
    });
    await this.audit.record(tx, {
      workspaceId: row.workspaceId,
      actorId: user.id,
      action: 'bank_transaction.payment_reversed',
      entityType: 'bank_transaction',
      entityId: row.id,
      reason,
      after: { payment_id: refId, status: 'PENDING_REVIEW' },
    });
  }
}
