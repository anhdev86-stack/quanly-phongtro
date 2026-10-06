'use client';

import { INVOICE_TYPE_LABELS } from '@ql-tro/shared';
import { Printer } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { useInvoice } from '@/features/billing/api';
import { InvoiceLines } from '@/features/billing/invoice-lines';
import { periodText } from '@/features/billing/invoice-status';
import { InvoicePrintExtras } from '@/features/billing/print-extras';
import { formatBusinessDate, formatVnd } from '@/lib/format';

const TITLES = {
  MONTHLY: 'THÔNG BÁO TIỀN PHÒNG',
  FINAL: 'THÔNG BÁO THANH TOÁN TRẢ PHÒNG',
  DEBIT_ADJUSTMENT: 'THÔNG BÁO ĐIỀU CHỈNH TĂNG',
  CREDIT_ADJUSTMENT: 'CHỨNG TỪ ĐIỀU CHỈNH GIẢM',
} as const;

/** Trang in khổ A4/A5 (MASTER_PLAN 12): dùng “In → Lưu PDF” của trình duyệt để gửi thủ công. */
export default function PrintInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const invoice = useInvoice(id);
  const [size, setSize] = useState<'A4' | 'A5'>('A4');
  if (invoice.isPending) return <LoadingState />;
  if (invoice.isError) return <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />;
  const inv = invoice.data;
  const money = (v: string) => (v.startsWith('-') ? `− ${formatVnd(v.slice(1))}` : formatVnd(v));

  return (
    <>
      <style>{`@page { size: ${size}; margin: 12mm; }`}</style>
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3 print:hidden">
        <div className="flex gap-1 text-sm">
          {(['A4', 'A5'] as const).map((s) => (
            <Button key={s} size="sm" variant={size === s ? 'default' : 'outline'} onClick={() => setSize(s)}>
              {s}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          In / Lưu PDF
        </Button>
      </div>
      <article className={`mx-auto mb-8 bg-white p-8 text-sm text-slate-900 shadow print:m-0 print:p-0 print:shadow-none ${size === 'A5' ? 'max-w-xl' : 'max-w-3xl'}`}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
          <div>
            <p className="font-semibold">{inv.building_name}</p>
            {inv.room_address ? <p className="text-slate-600">{inv.room_address}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-base font-bold">{TITLES[inv.type]}</p>
            <p>Số: {inv.number ?? `${INVOICE_TYPE_LABELS[inv.type]} (nháp — chưa phát hành)`}</p>
            {inv.period ? <p>Kỳ: tháng {periodText(inv.period)}</p> : null}
          </div>
        </header>
        <section className="grid grid-cols-2 gap-x-6 gap-y-1 py-3">
          <p>
            Phòng: <strong>{inv.room_code}</strong> ({inv.building_code})
          </p>
          <p>Người thuê: {inv.primary_tenant_name ?? '—'}</p>
          <p>Ngày lập: {formatBusinessDate(inv.issue_date)}</p>
          <p>
            Hạn thanh toán: <strong>{formatBusinessDate(inv.due_date)}</strong>
          </p>
          {inv.source_invoice_number ? <p className="col-span-2">Điều chỉnh cho chứng từ: {inv.source_invoice_number}</p> : null}
        </section>
        <InvoiceLines items={inv.items} compact={size === 'A5'} />
        <section className="mt-3 flex flex-col items-end gap-1 text-base">
          <p>
            Tổng cộng: <strong className="tabular">{money(inv.total_vnd)}</strong>
          </p>
          {inv.lifecycle === 'PUBLISHED' && inv.type !== 'CREDIT_ADJUSTMENT' && inv.settled_vnd !== '0' ? (
            <>
              <p className="text-sm">Đã thanh toán: {formatVnd(inv.settled_vnd)}</p>
              <p>
                Còn phải thanh toán: <strong className="tabular">{formatVnd(inv.remaining_vnd)}</strong>
              </p>
            </>
          ) : null}
        </section>
        <InvoicePrintExtras invoice={inv} />
        <footer className="mt-6 border-t border-slate-300 pt-2 text-center text-xs text-slate-500">Chứng từ nội bộ, không phải hóa đơn GTGT.</footer>
      </article>
    </>
  );
}
