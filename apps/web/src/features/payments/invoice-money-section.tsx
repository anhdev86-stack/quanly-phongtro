'use client';

import { type InvoiceDetail, PAYMENT_METHOD_HINT, PAYMENT_METHOD_LABELS, PERMISSIONS } from '@ql-tro/shared';
import { Copy, Link2, Printer, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, MoneyInput, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { useInvoiceQr, useInvoiceSettlements, useMoneyAction, useShareLinkAction, useShareLinks } from './api';
import { QrTransferInfo } from './qr-image';
import { ReceiverSelect } from './receiver-select';

/** Thu tiền của một thông báo (MASTER_PLAN 9.1, 9.6). QR không đổi trạng thái tiền; chỉ “Ghi nhận thu” mới giảm nợ. */
/** `paying`/`onPayingChange`: trang thông báo mở hộp “Ghi nhận thu” từ nút ở đầu trang. */
export function InvoiceMoneySection({ invoice, paying, onPayingChange }: { invoice: InvoiceDetail; paying: boolean; onPayingChange: (v: boolean) => void }) {
  if (invoice.lifecycle !== 'PUBLISHED') return null;
  return invoice.type === 'CREDIT_ADJUSTMENT' ? <CreditSection invoice={invoice} /> : <DebtSection invoice={invoice} paying={paying} setPaying={onPayingChange} />;
}

// ---------------------------------------------------------------- Thông báo loại nợ

function DebtSection({ invoice, paying, setPaying }: { invoice: InvoiceDetail; paying: boolean; setPaying: (v: boolean) => void }) {
  const can = useCan();
  const toast = useToast();
  const settlements = useInvoiceSettlements(invoice.id);
  const owes = invoice.remaining_vnd !== '0';
  const qr = useInvoiceQr(invoice.id, owes);
  const [reversing, setReversing] = useState<{ id: string; number: string; amount: string } | null>(null);
  const reverse = useMoneyAction<unknown>();
  const [key, renew] = useIdempotencyKey();

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Thanh toán</CardTitle>
        <div className="flex flex-wrap gap-2">
          {can(PERMISSIONS.INVOICES_SHARE) ? <ShareLinkButton invoiceId={invoice.id} /> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {owes ? (
          qr.data ? (
            <QrTransferInfo qr={qr.data} />
          ) : qr.isError ? (
            <p className="text-sm text-slate-600">
              Chưa có QR: {qr.error instanceof ApiError ? qr.error.message : ''}{' '}
              {can(PERMISSIONS.PAYMENT_ACCOUNTS_MANAGE) ? (
                <Link href="/settings/payment-account" className="text-brand-800 hover:underline">
                  Cấu hình tài khoản nhận tiền
                </Link>
              ) : null}
            </p>
          ) : null
        ) : (
          <p className="text-sm text-emerald-700">Đã thu đủ — không còn hiển thị QR.</p>
        )}
        <ShareLinks invoiceId={invoice.id} />
      </CardContent>
      {settlements.data && (settlements.data.payments.length || settlements.data.credits_received.length || settlements.data.deposits.length) ? (
        <Table>
          <thead>
            <tr>
              <Th>Khoản</Th>
              <Th className="hidden sm:table-cell">Ngày</Th>
              <Th className="text-right">Số tiền</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {settlements.data.payments.map((p) => (
              <Tr key={p.payment_id} className={p.status === 'REVERSED' ? 'opacity-60' : ''}>
                <Td>
                  Phiếu thu {p.number} · {PAYMENT_METHOD_LABELS[p.method]}
                  {p.reference ? <span className="text-slate-500"> · {p.reference}</span> : null}
                  {p.received_by_name ? <div className="text-xs text-slate-500">Người nhận: {p.received_by_name}</div> : null}
                  {p.status === 'REVERSED' ? (
                    <Badge tone="gray" className="ml-1">
                      Đã đảo
                    </Badge>
                  ) : null}
                </Td>
                <Td className="hidden tabular sm:table-cell">{formatBusinessDate(p.paid_at)}</Td>
                <Td className="text-right tabular">{formatVnd(p.amount_vnd)}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Link href={`/print/payments/${p.payment_id}`} target="_blank" className="inline-flex rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={`In phiếu thu ${p.number}`}>
                    <Printer className="size-4" />
                  </Link>
                  {p.status === 'POSTED' && can(PERMISSIONS.FINANCE_REVERSE) ? (
                    <Button size="sm" variant="ghost" onClick={() => setReversing({ id: p.payment_id, number: p.number, amount: p.amount_vnd })} aria-label={`Đảo phiếu thu ${p.number}`}>
                      <Undo2 className="size-4" />
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
            {settlements.data.credits_received.map((c) => (
              <Tr key={c.id} className={c.status === 'REVERSED' ? 'opacity-60' : ''}>
                <Td>
                  Cấn trừ credit{' '}
                  <Link href={`/invoices/${c.credit_invoice_id}`} className="text-brand-800 hover:underline">
                    {c.credit_invoice_number}
                  </Link>
                  {c.status === 'REVERSED' ? (
                    <Badge tone="gray" className="ml-1">
                      Đã đảo
                    </Badge>
                  ) : null}
                </Td>
                <Td className="hidden sm:table-cell" />
                <Td className="text-right tabular">{formatVnd(c.amount_vnd)}</Td>
                <Td />
              </Tr>
            ))}
            {settlements.data.deposits.map((d) => (
              <Tr key={d.deposit_transaction_id} className={d.active ? '' : 'opacity-60'}>
                <Td>Trừ vào tiền cọc{d.active ? '' : ' (đã đảo)'}</Td>
                <Td className="hidden tabular sm:table-cell">{d.paid_at ? formatBusinessDate(d.paid_at) : ''}</Td>
                <Td className="text-right tabular">{formatVnd(d.amount_vnd)}</Td>
                <Td />
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <PaymentDialog open={paying} onClose={() => setPaying(false)} invoice={invoice} suggestedRef={qr.data?.content ?? null} />
      <ReasonDialog
        open={!!reversing}
        title={`Đảo phiếu thu ${reversing?.number ?? ''}`}
        description={`Đảo toàn bộ ${reversing ? formatVnd(reversing.amount) : ''}: nợ quay lại thông báo này. Phiếu thu không bị xóa.`}
        confirmLabel="Đảo phiếu thu"
        pending={reverse.isPending}
        onClose={() => setReversing(null)}
        onConfirm={async (reason) => {
          if (!reversing) return;
          try {
            await reverse.mutateAsync({ path: `/payments/${reversing.id}/reverse`, body: { reason }, key });
            renew();
            toast.success(`Đã đảo phiếu thu ${reversing.number}.`);
            setReversing(null);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không đảo được.');
          }
        }}
      />
    </Card>
  );
}

function PaymentDialog({ open, onClose, invoice, suggestedRef }: { open: boolean; onClose: () => void; invoice: InvoiceDetail; suggestedRef: string | null }) {
  return (
    <Dialog open={open} onClose={onClose} title={`Ghi nhận thu — ${invoice.number}`} description="Chỉ ghi khi tiền đã thực nhận (tiền mặt hoặc đã thấy tiền vào tài khoản).">
      {open ? <PaymentForm invoice={invoice} onClose={onClose} suggestedRef={suggestedRef} /> : null}
    </Dialog>
  );
}

function PaymentForm({ invoice, onClose, suggestedRef }: { invoice: InvoiceDetail; onClose: () => void; suggestedRef: string | null }) {
  const toast = useToast();
  const action = useMoneyAction<{ number: string }>();
  const [key, renew] = useIdempotencyKey();
  const [v, setV] = useState({ amount_vnd: invoice.remaining_vnd, method: 'BANK_TRANSFER', paid_at: todayLocal(), reference: '', note: '', received_by: '' });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const submit = async () => {
    setError('');
    setFe({});
    try {
      const p = await action.mutateAsync({
        path: '/payments',
        key,
        body: {
          tenancy_id: invoice.tenancy_id,
          amount_vnd: v.amount_vnd,
          method: v.method,
          paid_at: v.paid_at,
          reference: v.reference.trim() || null,
          note: v.note.trim() || null,
          received_by: v.received_by || null,
          allocations: [{ invoice_id: invoice.id, amount_vnd: v.amount_vnd }],
        },
      });
      renew();
      toast.success(`Đã ghi phiếu thu ${p.number}: ${formatVnd(v.amount_vnd)} cho phòng ${invoice.room_code}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFe(e.fieldErrors ?? {});
      } else setError('Không ghi được.');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <p className="text-sm">
        Phòng <strong>{invoice.room_code}</strong> · {invoice.primary_tenant_name ?? '—'} · còn phải thu <strong className="tabular">{formatVnd(invoice.remaining_vnd)}</strong>
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="pm-amount" label="Số tiền thu" required error={fe.amount_vnd?.[0] ?? fe['allocations.0.amount_vnd']?.[0]}>
          <MoneyInput id="pm-amount" value={v.amount_vnd} onChange={(amount_vnd) => setV({ ...v, amount_vnd })} />
        </Field>
        <Field id="pm-date" label="Ngày thực nhận" required error={fe.paid_at?.[0]}>
          <TextInput id="pm-date" type="date" value={v.paid_at} max={todayLocal()} onChange={(e) => setV({ ...v, paid_at: e.target.value })} />
        </Field>
        <Field id="pm-method" label="Phương thức" hint={PAYMENT_METHOD_HINT}>
          <Select id="pm-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="pm-ref" label="Mã giao dịch / tham chiếu" hint={suggestedRef ? `Nội dung chuyển khoản mong đợi: ${suggestedRef}` : undefined}>
          <TextInput id="pm-ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
        </Field>
        <ReceiverSelect id="pm-receiver" tenancyId={invoice.tenancy_id} value={v.received_by} onChange={(received_by) => setV({ ...v, received_by })} error={fe.received_by?.[0]} />
        <Field id="pm-note" label="Ghi chú">
          <TextInput id="pm-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending || !v.amount_vnd}>
          Ghi nhận {formatVnd(v.amount_vnd || '0')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Link gửi khách

function ShareLinkButton({ invoiceId }: { invoiceId: string }) {
  const toast = useToast();
  const create = useShareLinkAction(invoiceId);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={create.isPending}
      onClick={async () => {
        try {
          const r = await create.mutateAsync({ path: `/invoices/${invoiceId}/share-links` });
          const url = `${window.location.origin}${r.path}`;
          await navigator.clipboard?.writeText(url).catch(() => undefined);
          toast.success(`Đã tạo và sao chép link (hạn đến ${formatBusinessDate(r.expires_at.slice(0, 10))}): ${url}`);
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : 'Không tạo được link.');
        }
      }}
    >
      <Copy className="size-4" aria-hidden />
      Sao chép link gửi khách
    </Button>
  );
}

function ShareLinks({ invoiceId }: { invoiceId: string }) {
  const can = useCan();
  const links = useShareLinks(invoiceId, can(PERMISSIONS.INVOICES_SHARE));
  const revoke = useShareLinkAction(invoiceId);
  const active = (links.data ?? []).filter((l) => l.active);
  if (!active.length) return null;
  return (
    <div className="text-sm">
      <p className="mb-1 flex items-center gap-1 font-medium">
        <Link2 className="size-4" aria-hidden /> Link đang hiệu lực
      </p>
      <ul className="flex flex-col gap-1 text-slate-600">
        {active.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2">
            Hạn {formatBusinessDate(l.expires_at.slice(0, 10))} · {l.view_count} lượt xem · {l.created_by_name ?? ''}
            <Button size="sm" variant="ghost" className="text-red-700" onClick={() => void revoke.mutateAsync({ path: `/share-links/${l.id}/revoke` })}>
              Thu hồi
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Chứng từ credit

function CreditSection({ invoice }: { invoice: InvoiceDetail }) {
  const can = useCan();
  const toast = useToast();
  const settlements = useInvoiceSettlements(invoice.id);
  const action = useMoneyAction<unknown>();
  const [key, renew] = useIdempotencyKey();
  const [refunding, setRefunding] = useState(false);
  const [reversing, setReversing] = useState<{ path: string; label: string } | null>(null);
  const available = invoice.remaining_vnd;
  const apply = async () => {
    try {
      await action.mutateAsync({ path: '/credit-applications', body: { credit_invoice_id: invoice.id }, key });
      renew();
      toast.success('Đã cấn trừ credit vào các thông báo còn nợ (đến hạn sớm nhất trước).');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không cấn trừ được.');
    }
  };
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Credit còn lại: {formatVnd(available)}</CardTitle>
        {available !== '0' ? (
          <div className="flex flex-wrap gap-2">
            {can(PERMISSIONS.INVOICES_ADJUST) ? (
              <Button size="sm" onClick={() => void apply()} disabled={action.isPending}>
                Cấn trừ vào nợ
              </Button>
            ) : null}
            {can(PERMISSIONS.CREDIT_REFUND) ? (
              <Button size="sm" variant="outline" onClick={() => setRefunding(true)}>
                Hoàn tiền cho khách (đã chi)
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="text-sm text-slate-600">Credit không tự thành tiền hoàn: ưu tiên cấn trừ vào nợ của cùng lần thuê; phần dư ghi hoàn khi đã thực chi.</CardContent>
      {settlements.data && (settlements.data.credits_given.length || settlements.data.refunds.length) ? (
        <Table>
          <tbody>
            {settlements.data.credits_given.map((c) => (
              <Tr key={c.id} className={c.status === 'REVERSED' ? 'opacity-60' : ''}>
                <Td>
                  Cấn trừ vào{' '}
                  <Link href={`/invoices/${c.target_invoice_id}`} className="text-brand-800 hover:underline">
                    {c.target_invoice_number}
                  </Link>
                  {c.status === 'REVERSED' ? ' (đã đảo)' : ''}
                </Td>
                <Td className="text-right tabular">{formatVnd(c.amount_vnd)}</Td>
                <Td className="text-right">
                  {c.status === 'ACTIVE' && can(PERMISSIONS.FINANCE_REVERSE) ? (
                    <Button size="sm" variant="ghost" onClick={() => setReversing({ path: `/credit-applications/${c.id}/reverse`, label: 'khoản cấn trừ' })} aria-label="Đảo cấn trừ">
                      <Undo2 className="size-4" />
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
            {settlements.data.refunds.map((r) => (
              <Tr key={r.id} className={r.status === 'REVERSED' ? 'opacity-60' : ''}>
                <Td>
                  Hoàn cho khách {formatBusinessDate(r.paid_at)} · {PAYMENT_METHOD_LABELS[r.method]}
                  {r.status === 'REVERSED' ? ' (đã đảo)' : ''}
                </Td>
                <Td className="text-right tabular">{formatVnd(r.amount_vnd)}</Td>
                <Td className="text-right">
                  {r.status === 'POSTED' && can(PERMISSIONS.FINANCE_REVERSE) ? (
                    <Button size="sm" variant="ghost" onClick={() => setReversing({ path: `/credit-refunds/${r.id}/reverse`, label: 'khoản hoàn' })} aria-label="Đảo hoàn tiền">
                      <Undo2 className="size-4" />
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <Dialog open={refunding} onClose={() => setRefunding(false)} title="Ghi hoàn credit" description="Chỉ ghi khi tiền đã thực chi cho khách.">
        {refunding ? <RefundForm invoice={invoice} onClose={() => setRefunding(false)} /> : null}
      </Dialog>
      <ReasonDialog
        open={!!reversing}
        title={`Đảo ${reversing?.label ?? ''}`}
        confirmLabel="Đảo"
        pending={action.isPending}
        onClose={() => setReversing(null)}
        onConfirm={async (reason) => {
          if (!reversing) return;
          try {
            await action.mutateAsync({ path: reversing.path, body: { reason }, key });
            renew();
            toast.success('Đã đảo.');
            setReversing(null);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không đảo được.');
          }
        }}
      />
    </Card>
  );
}

function RefundForm({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const toast = useToast();
  const action = useMoneyAction<unknown>();
  const [key, renew] = useIdempotencyKey();
  const [v, setV] = useState({ amount_vnd: invoice.remaining_vnd, paid_at: todayLocal(), method: 'CASH', reference: '' });
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    try {
      await action.mutateAsync({ path: '/credit-refunds', key, body: { credit_invoice_id: invoice.id, ...v, reference: v.reference.trim() || null } });
      renew();
      toast.success(`Đã ghi hoàn ${formatVnd(v.amount_vnd)} cho khách phòng ${invoice.room_code}.`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không ghi được.');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="rf-amount" label="Số tiền hoàn" required>
          <MoneyInput id="rf-amount" value={v.amount_vnd} onChange={(amount_vnd) => setV({ ...v, amount_vnd })} />
        </Field>
        <Field id="rf-date" label="Ngày chi" required>
          <TextInput id="rf-date" type="date" value={v.paid_at} max={todayLocal()} onChange={(e) => setV({ ...v, paid_at: e.target.value })} />
        </Field>
        <Field id="rf-method" label="Phương thức">
          <Select id="rf-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="rf-ref" label="Tham chiếu">
          <TextInput id="rf-ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending || !v.amount_vnd}>
          Ghi hoàn {formatVnd(v.amount_vnd || '0')}
        </Button>
      </div>
    </div>
  );
}
