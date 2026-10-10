'use client';

import { FINANCIAL_STATUS_LABELS, PAYMENT_METHOD_LABELS, PERMISSIONS, SETTLEMENT_STATUS_LABELS, type SettlementDto } from '@ql-tro/shared';
import { Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DescriptionList, PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, MoneyInput, Select, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useMoveOutAction, useSettlement } from '@/features/move-out/api';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { ReceiverSelect } from '@/features/payments/receiver-select';

type CashKind = 'receipts' | 'credit-refunds' | 'deposit-refunds';
const CASH_TITLES: Record<CashKind, string> = { receipts: 'Thu khoản khách còn nợ', 'credit-refunds': 'Hoàn tiền dư cho khách', 'deposit-refunds': 'Hoàn cọc cho khách' };
const EVENT_LABELS: Record<string, string> = {
  PAYMENT_REVERSED: 'Đảo phiếu thu',
  DEPOSIT_TX_REVERSED: 'Đảo giao dịch cọc',
  CREDIT_APPLICATION_REVERSED: 'Đảo cấn trừ credit',
  CREDIT_REFUND_REVERSED: 'Đảo hoàn credit',
  LATE_PAYMENT: 'Thu tiền sau quyết toán',
  NOTE: 'Ghi chú',
};
const TX_LABELS: Record<string, string> = {
  RECEIPT: 'Phiếu thu',
  CREDIT_REFUND: 'Hoàn tiền dư',
  DEPOSIT_REFUND: 'Hoàn cọc',
  DEPOSIT_APPLICATION: 'Áp cọc vào nợ',
  CREDIT_APPLICATION: 'Cấn trừ credit',
};

export default function SettlementPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();
  const st = useSettlement(id);
  const action = useMoveOutAction<SettlementDto>();
  const [cash, setCash] = useState<CashKind | null>(null);
  const [cancelling, setCancelling] = useState(false);
  if (st.isPending) return <LoadingState />;
  if (st.isError) return <ErrorState error={st.error} onRetry={() => void st.refetch()} />;
  const s = st.data;
  const snap = s.approved_snapshot;
  const cur = s.current;
  const completed = s.status === 'COMPLETED';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        back={{ href: `/tenancies/${s.tenancy_id}`, label: `Lần thuê ${s.tenancy_code}` }}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Quyết toán {s.code}
            <Badge tone={completed ? 'green' : s.status === 'CANCELLED' ? 'gray' : 'amber'}>{SETTLEMENT_STATUS_LABELS[s.status]}</Badge>
            {completed ? <Badge tone={cur.financial_status === 'BALANCED' ? 'green' : 'violet'}>{FINANCIAL_STATUS_LABELS[cur.financial_status]}</Badge> : null}
          </span>
        }
        description={`${s.building_code} · Phòng ${s.room_code} · ${s.primary_tenant_name ?? '—'} · bàn giao ${formatBusinessDate(s.handover_date)} · tính tiền phòng hết ngày ${formatBusinessDate(s.last_charge_date)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {!completed && s.status !== 'CANCELLED' ? (
              <Link href={`/tenancies/${s.tenancy_id}/move-out`} className={buttonVariants({ size: 'sm' })}>
                Tiếp tục trả phòng
              </Link>
            ) : null}
            {completed ? (
              <Link href={`/print/settlements/${s.id}`} target="_blank" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                <Printer className="size-4" aria-hidden />
                In biên bản
              </Link>
            ) : null}
            {!completed && s.status !== 'CANCELLED' && can(PERMISSIONS.SETTLEMENT_MANAGE) ? (
              <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setCancelling(true)}>
                Hủy quyết toán
              </Button>
            ) : null}
          </div>
        }
      />

      {completed ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Số liệu hiện tại (tính lại từ sổ)</CardTitle>
            <div className="flex flex-wrap gap-2">
              {cur.receivable_vnd !== '0' && can(PERMISSIONS.PAYMENTS_RECORD) ? (
                <Button size="sm" onClick={() => setCash('receipts')}>
                  Thu nợ
                </Button>
              ) : null}
              {cur.credit_refund_payable_vnd !== '0' && can(PERMISSIONS.CREDIT_REFUND) ? (
                <Button size="sm" variant="outline" onClick={() => setCash('credit-refunds')}>
                  Hoàn tiền dư
                </Button>
              ) : null}
              {cur.deposit_refund_payable_vnd !== '0' && can(PERMISSIONS.DEPOSIT_REFUND) ? (
                <Button size="sm" variant="outline" onClick={() => setCash('deposit-refunds')}>
                  Hoàn cọc
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              {[
                ['Khách còn nợ', cur.receivable_vnd, 'text-red-700'],
                ['Phải hoàn tiền dư', cur.credit_refund_payable_vnd, 'text-violet-700'],
                ['Phải hoàn cọc', cur.deposit_refund_payable_vnd, 'text-violet-700'],
              ].map(([l, v, c]) => (
                <div key={l}>
                  <dt className="text-slate-500">{l}</dt>
                  <dd className={`text-lg font-semibold tabular ${v !== '0' ? c : ''}`}>{formatVnd(v!)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-slate-500">Trả phòng không chờ chuyển tiền: khoản chưa thu/chi vẫn hiện ở đây và trong việc cần xử lý cho tới khi ghi nhận thực tế.</p>
          </CardContent>
        </Card>
      ) : null}

      {snap ? (
        <Card>
          <CardHeader>
            <CardTitle>Số liệu lúc chốt {s.approved_at ? `(${s.approved_by_name ?? ''} duyệt ${formatBusinessDate(s.approved_at.slice(0, 10))})` : ''}</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                { label: 'Thông báo trả phòng', value: formatVnd(snap.final_debit_vnd) },
                { label: 'Giảm do thu trước dư', value: formatVnd(snap.final_credit_vnd) },
                { label: 'Tổng nợ', value: formatVnd(snap.debt_vnd) },
                { label: 'Cấn trừ credit', value: formatVnd(snap.credit_applied_vnd) },
                { label: 'Áp cọc', value: formatVnd(snap.deposit_applied_vnd) },
                { label: 'Khách còn phải trả', value: formatVnd(snap.customer_receivable_vnd) },
                { label: 'Phải hoàn tiền dư', value: formatVnd(snap.credit_refund_payable_vnd) },
                { label: 'Phải hoàn cọc', value: formatVnd(snap.deposit_refund_payable_vnd) },
              ]}
            />
            <p className="mt-3 flex flex-wrap gap-3 text-sm">
              {s.final_invoice_id ? (
                <Link href={`/invoices/${s.final_invoice_id}`} className="font-medium text-brand-600 hover:underline">
                  Thông báo trả phòng
                </Link>
              ) : null}
              {s.credit_invoice_id ? (
                <Link href={`/invoices/${s.credit_invoice_id}`} className="font-medium text-brand-600 hover:underline">
                  Chứng từ điều chỉnh giảm
                </Link>
              ) : null}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Bàn giao</CardTitle>
        </CardHeader>
        <CardContent>
          <DescriptionList
            items={[
              { label: 'Phòng sau bàn giao', value: s.destination_room_status === 'READY' ? 'Sẵn sàng cho thuê' : 'Bảo trì' },
              { label: 'Người bàn giao', value: s.handover_by },
              { label: 'Kiểm kê', value: s.inventory_note },
              {
                label: 'Chỉ số cuối',
                value: s.final_readings.length
                  ? s.final_readings.map((r) => `${r.meter_type === 'ELECTRICITY' ? 'Điện' : 'Nước'} ${r.previous_value ?? '?'} → ${r.value}`).join(' · ')
                  : (s.final_reading_waiver ?? '—'),
              },
              { label: 'Khoản phí', value: s.charges.length ? s.charges.map((c) => `${c.reason}: ${formatVnd(c.amount_vnd)}`).join(' · ') : 'Không' },
            ]}
          />
        </CardContent>
      </Card>

      {s.transactions.length || s.events.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Chứng từ liên kết và sự kiện sau quyết toán</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {s.transactions.map((t) => (
              <p key={`${t.kind}-${t.linked_id}`}>
                {TX_LABELS[t.kind] ?? t.kind} · {formatBusinessDate(t.created_at.slice(0, 10))}
              </p>
            ))}
            {s.events.map((e, i) => (
              <p key={i} className="text-amber-800">
                {EVENT_LABELS[e.kind] ?? e.kind}: {e.note} · {e.created_by_name} · {formatBusinessDate(e.created_at.slice(0, 10))}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={!!cash} onClose={() => setCash(null)} title={cash ? CASH_TITLES[cash] : ''} description="Chỉ ghi khi tiền đã thực nhận/thực chi.">
        {cash ? <CashForm settlement={s} kind={cash} onClose={() => setCash(null)} /> : null}
      </Dialog>
      <ReasonDialog
        open={cancelling}
        title={`Hủy quyết toán ${s.code}`}
        description="Lần thuê quay lại trạng thái trước khi trả phòng (đang báo trả hoặc đang thuê)."
        confirmLabel="Hủy quyết toán"
        pending={action.isPending}
        onClose={() => setCancelling(false)}
        onConfirm={async (reason) => {
          try {
            await action.mutateAsync({ path: `/settlements/${s.id}/cancel`, body: { reason, expected_version: s.version } });
            toast.success('Đã hủy quyết toán.');
            setCancelling(false);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không hủy được.');
          }
        }}
      />
    </div>
  );
}

function CashForm({ settlement, kind, onClose }: { settlement: SettlementDto; kind: CashKind; onClose: () => void }) {
  const toast = useToast();
  const action = useMoveOutAction<SettlementDto>();
  const [key, renew] = useIdempotencyKey();
  const suggested = kind === 'receipts' ? settlement.current.receivable_vnd : kind === 'credit-refunds' ? settlement.current.credit_refund_payable_vnd : settlement.current.deposit_refund_payable_vnd;
  const [v, setV] = useState({ amount_vnd: suggested, paid_at: todayLocal(), method: 'CASH', reference: '', received_by: '' });
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    try {
      // Người nhận tiền chỉ có ý nghĩa khi thu (D-045); hoàn tiền là chi ra.
      const { received_by, ...cash } = v;
      const body = { ...cash, reference: v.reference.trim() || null, ...(kind === 'receipts' ? { received_by: received_by || null } : {}) };
      await action.mutateAsync({ path: `/settlements/${settlement.id}/${kind}`, body, key });
      renew();
      toast.success(`${CASH_TITLES[kind]}: đã ghi ${formatVnd(v.amount_vnd)}.`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không ghi được.');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="cs-amount" label="Số tiền" required>
          <MoneyInput id="cs-amount" value={v.amount_vnd} onChange={(amount_vnd) => setV({ ...v, amount_vnd })} />
        </Field>
        <Field id="cs-date" label={kind === 'receipts' ? 'Ngày thực nhận' : 'Ngày thực chi'} required>
          <TextInput id="cs-date" type="date" max={todayLocal()} value={v.paid_at} onChange={(e) => setV({ ...v, paid_at: e.target.value })} />
        </Field>
        <Field id="cs-method" label="Phương thức">
          <Select id="cs-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cs-ref" label="Tham chiếu">
          <TextInput id="cs-ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
        </Field>
        {kind === 'receipts' ? (
          <ReceiverSelect id="cs-receiver" tenancyId={settlement.tenancy_id} value={v.received_by} onChange={(received_by) => setV({ ...v, received_by })} />
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending || !v.amount_vnd}>
          Ghi {formatVnd(v.amount_vnd || '0')}
        </Button>
      </div>
    </div>
  );
}
