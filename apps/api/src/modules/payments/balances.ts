import { Injectable } from '@nestjs/common';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import type { InvoiceSettlementProvider } from '../billing/billing.service.js';

/**
 * Nơi duy nhất tính “đã thanh toán/đã dùng” của chứng từ (MASTER_PLAN 8.8). Chi tiết thông báo, công nợ, sao kê,
 * dashboard và báo cáo đều đi qua đây — không tự cộng lại ở từng chỗ.
 *
 * - Thông báo loại nợ: Σ allocation của payment POSTED + Σ deposit_allocations của APPLIED_TO_INVOICE chưa bị đảo
 *   + Σ credit_applications ACTIVE (là đích).
 * - Chứng từ credit: Σ credit_applications ACTIVE (là nguồn) + Σ credit_refunds POSTED.
 * Kết quả gộp theo id chứng từ; với mỗi loại chỉ một nhóm có giá trị.
 */
@Injectable()
export class InvoiceBalances implements InvoiceSettlementProvider {
  async settled(db: Db, invoiceIds: string[]): Promise<Map<string, bigint>> {
    const parts = await this.breakdown(db, invoiceIds);
    return new Map([...parts].map(([id, p]) => [id, p.cash + p.deposit + p.credit + p.used]));
  }

  /**
   * Đã thu tách theo nguồn (báo cáo doanh thu, MASTER_PLAN 13): tiền thực nhận (phiếu thu POSTED), trừ từ cọc (chưa bị đảo),
   * cấn trừ credit (ACTIVE). `used` = phần đã dùng của chứng từ credit (cấn trừ đi + hoàn tiền).
   */
  async breakdown(db: Db, invoiceIds: string[]): Promise<Map<string, { cash: bigint; deposit: bigint; credit: bigint; used: bigint }>> {
    const out = new Map<string, { cash: bigint; deposit: bigint; credit: bigint; used: bigint }>();
    if (!invoiceIds.length) return out;
    const get = (id: string) => {
      let v = out.get(id);
      if (!v) {
        v = { cash: 0n, deposit: 0n, credit: 0n, used: 0n };
        out.set(id, v);
      }
      return v;
    };

    const payments = await db.paymentAllocation.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: invoiceIds }, payment: { status: 'POSTED' } },
      _sum: { amountVnd: true },
    });
    for (const p of payments) get(p.invoiceId).cash += p._sum.amountVnd ?? 0n;

    const deposits = await db.depositAllocation.findMany({
      where: { invoiceId: { in: invoiceIds } },
      select: { invoiceId: true, amountVnd: true, depositTransactionId: true },
    });
    if (deposits.length) {
      // “Chưa bị đảo” = không có REVERSAL trỏ tới giao dịch gốc (8.8).
      const reversed = await db.depositTransaction.findMany({
        where: { type: 'REVERSAL', reversesTransactionId: { in: [...new Set(deposits.map((d) => d.depositTransactionId))] } },
        select: { reversesTransactionId: true },
      });
      const dead = new Set(reversed.map((r) => r.reversesTransactionId));
      for (const d of deposits) if (!dead.has(d.depositTransactionId)) get(d.invoiceId).deposit += d.amountVnd;
    }

    const received = await db.creditApplication.groupBy({
      by: ['targetInvoiceId'],
      where: { targetInvoiceId: { in: invoiceIds }, status: 'ACTIVE' },
      _sum: { amountVnd: true },
    });
    for (const c of received) get(c.targetInvoiceId).credit += c._sum.amountVnd ?? 0n;

    const given = await db.creditApplication.groupBy({
      by: ['creditInvoiceId'],
      where: { creditInvoiceId: { in: invoiceIds }, status: 'ACTIVE' },
      _sum: { amountVnd: true },
    });
    for (const c of given) get(c.creditInvoiceId).used += c._sum.amountVnd ?? 0n;

    const refunds = await db.creditRefund.groupBy({
      by: ['creditInvoiceId'],
      where: { creditInvoiceId: { in: invoiceIds }, status: 'POSTED' },
      _sum: { amountVnd: true },
    });
    for (const r of refunds) get(r.creditInvoiceId).used += r._sum.amountVnd ?? 0n;
    return out;
  }

  /** Còn lại của từng chứng từ đã phát hành: nợ còn phải thu, hoặc credit còn dùng được. Không âm. */
  async remaining(db: Db, invoices: { id: string; totalVnd: bigint }[]): Promise<Map<string, bigint>> {
    const settled = await this.settled(db, invoices.map((i) => i.id));
    return new Map(
      invoices.map((i) => {
        const r = i.totalVnd - (settled.get(i.id) ?? 0n);
        return [i.id, r > 0n ? r : 0n];
      }),
    );
  }
}
