'use client';

import type { InvoiceDetail } from '@ql-tro/shared';
import { useInvoiceQr } from '@/features/payments/api';
import { QrTransferInfo } from '@/features/payments/qr-image';

/** Trang in: QR và thông tin chuyển khoản khi thông báo đã phát hành còn nợ (MASTER_PLAN 9.6). */
export function InvoicePrintExtras({ invoice }: { invoice: InvoiceDetail }) {
  const owes = invoice.lifecycle === 'PUBLISHED' && invoice.type !== 'CREDIT_ADJUSTMENT' && invoice.remaining_vnd !== '0';
  const qr = useInvoiceQr(invoice.id, owes);
  if (!owes || !qr.data) return null;
  return (
    <section className="mt-5 break-inside-avoid border-t border-dashed border-slate-300 pt-4">
      <p className="mb-2 font-semibold">Chuyển khoản bằng VietQR</p>
      <QrTransferInfo qr={qr.data} size={150} />
    </section>
  );
}
