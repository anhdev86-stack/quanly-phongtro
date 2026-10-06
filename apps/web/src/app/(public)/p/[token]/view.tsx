'use client';

import { LINE_GROUP_LABELS, LINE_GROUPS, type PublicInvoice } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { LoadingState } from '@/components/common/states';
import { QrTransferInfo } from '@/features/payments/qr-image';
import { api } from '@/lib/api-client';
import { formatBusinessDate, formatVnd } from '@/lib/format';

/** Xem thông báo qua link: chỉ tên nhà trọ, phòng, tháng, dòng phí, tổng, đã trả, còn phải trả, hạn, QR (T59). */
export function PublicInvoiceView({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ['public-invoice', token],
    queryFn: ({ signal }) => api<PublicInvoice>(`/public/invoices/${encodeURIComponent(token)}`, { signal }),
    retry: false,
  });
  if (q.isPending) return <LoadingState />;
  if (q.isError || !q.data) {
    return (
      <main className="mx-auto mt-24 max-w-md px-4 text-center">
        <h1 className="text-lg font-semibold">Link không còn hiệu lực</h1>
        <p className="mt-2 text-sm text-slate-600">Link có thể đã hết hạn hoặc bị thu hồi. Vui lòng liên hệ chủ nhà trọ để nhận link mới.</p>
      </main>
    );
  }
  const inv = q.data;
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4">
        <p className="text-sm text-slate-500">{inv.workspace_name}</p>
        <h1 className="text-xl font-semibold">
          Thông báo tiền phòng {inv.period ? `tháng ${inv.period.slice(5)}/${inv.period.slice(0, 4)}` : ''}
        </h1>
        <p className="text-sm text-slate-600">
          {inv.building_name} · Phòng {inv.room_code} · Số {inv.number}
        </p>
      </header>
      <section className="rounded-lg border border-slate-200 bg-white">
        {LINE_GROUPS.map((g) => {
          const lines = inv.items.filter((l) => l.group === g);
          if (!lines.length) return null;
          return (
            <div key={g} className="border-b border-slate-100 px-4 py-3 last:border-0">
              <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{LINE_GROUP_LABELS[g]}</p>
              {lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-3 py-0.5 text-sm">
                  <span>{l.label}</span>
                  <span className="tabular whitespace-nowrap">
                    {l.direction === 'CREDIT' ? '− ' : ''}
                    {formatVnd(l.amount_vnd)}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        <dl className="grid grid-cols-2 gap-1 border-t border-slate-200 px-4 py-3 text-sm">
          <dt>Tổng cộng</dt>
          <dd className="text-right font-semibold tabular">{formatVnd(inv.total_vnd)}</dd>
          <dt>Đã thanh toán</dt>
          <dd className="text-right tabular">{formatVnd(inv.settled_vnd)}</dd>
          <dt className="text-base font-semibold">Còn phải thanh toán</dt>
          <dd className="text-right text-base font-bold tabular">{formatVnd(inv.remaining_vnd)}</dd>
          <dt>Hạn thanh toán</dt>
          <dd className="text-right">{formatBusinessDate(inv.due_date)}</dd>
        </dl>
      </section>
      {inv.qr ? (
        <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-3 font-semibold">Quét mã bằng app ngân hàng để chuyển khoản</p>
          <QrTransferInfo qr={inv.qr} />
        </section>
      ) : inv.remaining_vnd === '0' ? (
        <p className="mt-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Thông báo đã được thanh toán đủ. Cảm ơn bạn!</p>
      ) : null}
      <p className="mt-6 text-center text-xs text-slate-500">Chứng từ nội bộ, không phải hóa đơn GTGT.</p>
    </main>
  );
}
