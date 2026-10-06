import { INVOICE_LIFECYCLE_LABELS, INVOICE_TYPE_LABELS, type InvoiceSummary, PAYMENT_STATUS_LABELS } from '@ql-tro/shared';
import { Badge } from '@/components/ui/badge';

/** Vòng đời + trạng thái thanh toán tính toán; “Thu một phần · Quá hạn” cùng hiện (MASTER_PLAN 5.4). */
export function InvoiceStatusBadges({ invoice }: { invoice: Pick<InvoiceSummary, 'lifecycle' | 'payment_status' | 'overdue' | 'blocking_errors' | 'type'> }) {
  if (invoice.lifecycle === 'DRAFT') {
    return (
      <span className="inline-flex flex-wrap gap-1">
        <Badge tone="gray">{INVOICE_LIFECYCLE_LABELS.DRAFT}</Badge>
        {invoice.blocking_errors.length ? <Badge tone="amber">Có lỗi chặn phát hành</Badge> : null}
      </span>
    );
  }
  if (invoice.lifecycle === 'CANCELLED') return <Badge tone="gray">{INVOICE_LIFECYCLE_LABELS.CANCELLED}</Badge>;
  if (invoice.type === 'CREDIT_ADJUSTMENT') return <Badge tone="violet">Credit</Badge>;
  const tone = invoice.payment_status === 'PAID' ? 'green' : invoice.payment_status === 'PARTIAL' ? 'blue' : 'amber';
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={tone}>{invoice.payment_status ? PAYMENT_STATUS_LABELS[invoice.payment_status] : ''}</Badge>
      {invoice.overdue ? <Badge tone="red">Quá hạn</Badge> : null}
    </span>
  );
}

export const invoiceTitle = (i: Pick<InvoiceSummary, 'number' | 'type' | 'period'>) =>
  i.number ?? `${INVOICE_TYPE_LABELS[i.type]}${i.period ? ` ${i.period.slice(5)}/${i.period.slice(0, 4)}` : ''} (nháp)`;

export const periodText = (p: string | null) => (p ? `${p.slice(5)}/${p.slice(0, 4)}` : '—');
