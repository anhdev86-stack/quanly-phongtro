'use client';

import { PAYMENT_METHOD_LABELS } from '@ql-tro/shared';
import { Printer } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { usePayment } from '@/features/payments/api';
import { formatBusinessDate, formatVnd } from '@/lib/format';

/** Phiếu thu (in khổ A5/A4 bằng “In → Lưu PDF”). */
export default function PrintPaymentPage() {
  const { id } = useParams<{ id: string }>();
  const payment = usePayment(id);
  if (payment.isPending) return <LoadingState />;
  if (payment.isError) return <ErrorState error={payment.error} onRetry={() => void payment.refetch()} />;
  const p = payment.data;
  return (
    <>
      <style>{'@page { size: A5; margin: 10mm; }'}</style>
      <div className="mx-auto flex max-w-xl justify-end px-4 py-3 print:hidden">
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          In / Lưu PDF
        </Button>
      </div>
      <article className="mx-auto mb-8 max-w-xl bg-white p-8 text-sm text-slate-900 shadow print:m-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-slate-300 pb-3">
          <p className="font-semibold">{p.building_name}</p>
          <div className="text-right">
            <p className="text-base font-bold">PHIẾU THU</p>
            <p>Số: {p.number}</p>
            {p.status === 'REVERSED' ? <p className="font-semibold text-red-700">ĐÃ ĐẢO — {p.reversal_reason}</p> : null}
          </div>
        </header>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1 py-4">
          <dt>Ngày thu</dt>
          <dd>{formatBusinessDate(p.paid_at)}</dd>
          <dt>Phòng</dt>
          <dd>
            {p.room_code} ({p.building_code})
          </dd>
          <dt>Người nộp</dt>
          <dd>{p.primary_tenant_name ?? '—'}</dd>
          <dt>Phương thức</dt>
          <dd>
            {PAYMENT_METHOD_LABELS[p.method]}
            {p.reference ? ` · ${p.reference}` : ''}
          </dd>
          <dt>Thu cho</dt>
          <dd>{p.allocations.map((a) => `${a.invoice_number ?? ''} (${formatVnd(a.amount_vnd)})`).join(', ')}</dd>
          {p.note ? (
            <>
              <dt>Ghi chú</dt>
              <dd>{p.note}</dd>
            </>
          ) : null}
          <dt className="text-base">Số tiền</dt>
          <dd className="text-base font-bold tabular">{formatVnd(p.amount_vnd)}</dd>
        </dl>
        <div className="mt-6 grid grid-cols-2 text-center">
          <p>
            Người nộp tiền
            <br />
            <span className="text-xs text-slate-500">(ký, ghi rõ họ tên)</span>
          </p>
          <p>
            Người thu tiền
            <br />
            <span className="text-xs text-slate-500">{p.received_by_name ?? p.created_by_name}</span>
            {p.created_by_name && p.received_by_name && p.created_by_name !== p.received_by_name ? (
              <span className="block text-xs text-slate-400">Người lập phiếu: {p.created_by_name}</span>
            ) : null}
          </p>
        </div>
        <footer className="mt-16 border-t border-slate-300 pt-2 text-center text-xs text-slate-500">Chứng từ nội bộ, không phải hóa đơn GTGT.</footer>
      </article>
    </>
  );
}
