'use client';

import { Printer } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { InvoiceLines } from '@/features/billing/invoice-lines';
import { useSettlement } from '@/features/move-out/api';
import { formatBusinessDate, formatVnd } from '@/lib/format';

/** Biên bản quyết toán trả phòng (số liệu lúc chốt) — in A4 bằng “In → Lưu PDF”. */
export default function PrintSettlementPage() {
  const { id } = useParams<{ id: string }>();
  const st = useSettlement(id);
  if (st.isPending) return <LoadingState />;
  if (st.isError) return <ErrorState error={st.error} onRetry={() => void st.refetch()} />;
  const s = st.data;
  const snap = s.approved_snapshot;
  return (
    <>
      <style>{'@page { size: A4; margin: 12mm; }'}</style>
      <div className="mx-auto flex max-w-3xl justify-end px-4 py-3 print:hidden">
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          In / Lưu PDF
        </Button>
      </div>
      <article className="mx-auto mb-8 max-w-3xl bg-white p-8 text-sm text-slate-900 shadow print:m-0 print:p-0 print:shadow-none">
        <header className="border-b border-slate-300 pb-3 text-center">
          <p className="font-semibold">{s.building_name}</p>
          <p className="mt-1 text-base font-bold">BIÊN BẢN QUYẾT TOÁN TRẢ PHÒNG</p>
          <p>Số: {s.code}</p>
        </header>
        <section className="grid grid-cols-2 gap-x-6 gap-y-1 py-3">
          <p>
            Phòng: <strong>{s.room_code}</strong> ({s.building_code})
          </p>
          <p>Người thuê: {s.primary_tenant_name ?? '—'}</p>
          <p>Ở đến hết ngày: {formatBusinessDate(s.last_charge_date)}</p>
          <p>Người bàn giao: {s.handover_by ?? '—'}</p>
          <p className="col-span-2">Kiểm kê: {s.inventory_note ?? '—'}</p>
          <p className="col-span-2">
            Chỉ số cuối: {s.final_readings.map((r) => `${r.meter_type === 'ELECTRICITY' ? 'Điện' : 'Nước'} ${r.previous_value ?? '?'} → ${r.value}`).join('; ') || (s.final_reading_waiver ?? '—')}
          </p>
        </section>
        {snap ? (
          <>
            <p className="mb-1 font-semibold">Các khoản tính đến ngày cuối</p>
            <InvoiceLines items={snap.final_lines} compact />
            {snap.old_debts.length ? (
              <p className="mt-2">Công nợ trước đó: {snap.old_debts.map((d) => `${d.number} còn ${formatVnd(d.remaining_vnd)}`).join('; ')}</p>
            ) : null}
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1">
              <dt>Tổng nợ</dt>
              <dd className="text-right tabular">{formatVnd(snap.debt_vnd)}</dd>
              <dt>Cấn trừ tiền đã thu trước dư</dt>
              <dd className="text-right tabular">− {formatVnd(snap.credit_applied_vnd)}</dd>
              <dt>Trừ vào tiền cọc ({formatVnd(snap.deposit_available_vnd)} đang giữ)</dt>
              <dd className="text-right tabular">− {formatVnd(snap.deposit_applied_vnd)}</dd>
              <dt className="font-semibold">Khách còn phải trả</dt>
              <dd className="text-right font-semibold tabular">{formatVnd(snap.customer_receivable_vnd)}</dd>
              <dt className="font-semibold">Chủ trọ hoàn tiền dư</dt>
              <dd className="text-right font-semibold tabular">{formatVnd(snap.credit_refund_payable_vnd)}</dd>
              <dt className="font-semibold">Chủ trọ hoàn cọc</dt>
              <dd className="text-right font-semibold tabular">{formatVnd(snap.deposit_refund_payable_vnd)}</dd>
            </dl>
          </>
        ) : null}
        <div className="mt-8 grid grid-cols-2 text-center">
          <p>
            Bên thuê
            <br />
            <span className="text-xs text-slate-500">(ký, ghi rõ họ tên)</span>
          </p>
          <p>
            Bên cho thuê
            <br />
            <span className="text-xs text-slate-500">(ký, ghi rõ họ tên)</span>
          </p>
        </div>
        <footer className="mt-20 border-t border-slate-300 pt-2 text-center text-xs text-slate-500">Chứng từ nội bộ, không phải hóa đơn GTGT.</footer>
      </article>
    </>
  );
}
