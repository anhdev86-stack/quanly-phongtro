'use client';

import { INVOICE_TYPE_LABELS, type InvoiceDetail, PERMISSIONS } from '@ql-tro/shared';
import { Printer, RefreshCw, Scale, Send } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DescriptionList, PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useInvoice, useInvoiceAction } from '@/features/billing/api';
import { InvoiceLines } from '@/features/billing/invoice-lines';
import { InvoiceStatusBadges, invoiceTitle, periodText } from '@/features/billing/invoice-status';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd } from '@/lib/format';

const money = (v: string) => (v.startsWith('-') ? `− ${formatVnd(v.slice(1))}` : formatVnd(v));

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();
  const invoice = useInvoice(id);
  const action = useInvoiceAction<unknown>();
  const [publishing, setPublishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState('');

  if (invoice.isPending) return <LoadingState />;
  if (invoice.isError) return <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />;
  const inv = invoice.data;
  const draft = inv.lifecycle === 'DRAFT';
  const isCredit = inv.type === 'CREDIT_ADJUSTMENT';

  const recalc = async () => {
    setError('');
    try {
      const r = (await action.mutateAsync({ path: `/invoices/${id}/recalculate`, body: { expected_version: inv.version } })) as { changed: boolean; before_total_vnd: string; after_total_vnd: string };
      toast.success(r.changed ? `Đã tính lại: ${money(r.before_total_vnd)} → ${money(r.after_total_vnd)}.` : 'Đã tính lại: dữ liệu không đổi.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tính lại được.');
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        back={{ href: `/invoices${inv.period ? `?period=${inv.period}` : ''}`, label: 'Thông báo tiền phòng' }}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {invoiceTitle(inv)}
            <InvoiceStatusBadges invoice={inv} />
          </span>
        }
        description={`${INVOICE_TYPE_LABELS[inv.type]} · ${inv.building_code} · Phòng ${inv.room_code} · ${inv.primary_tenant_name ?? '—'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {draft && can(PERMISSIONS.BILLING_GENERATE) ? (
              <Button size="sm" variant="outline" onClick={() => void recalc()} disabled={action.isPending}>
                <RefreshCw className="size-4" aria-hidden />
                Tính lại
              </Button>
            ) : null}
            {draft && can(PERMISSIONS.INVOICES_PUBLISH) ? (
              <Button size="sm" onClick={() => setPublishing(true)} disabled={inv.blocking_errors.length > 0}>
                <Send className="size-4" aria-hidden />
                Phát hành
              </Button>
            ) : null}
            {inv.lifecycle === 'PUBLISHED' && can(PERMISSIONS.INVOICES_ADJUST) ? (
              <Button size="sm" variant="outline" onClick={() => setAdjusting(true)}>
                <Scale className="size-4" aria-hidden />
                Điều chỉnh ngay
              </Button>
            ) : null}
            {inv.lifecycle !== 'CANCELLED' ? (
              <Link href={`/print/invoices/${inv.id}`} target="_blank" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Printer className="size-4" aria-hidden />
                In
              </Link>
            ) : null}
            {inv.lifecycle !== 'CANCELLED' && can(PERMISSIONS.INVOICES_PUBLISH) && inv.settled_vnd === '0' ? (
              <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setCancelling(true)}>
                {draft ? 'Hủy nháp' : 'Hủy thông báo'}
              </Button>
            ) : null}
          </div>
        }
      />
      <FormError message={error} />
      {inv.blocking_errors.length ? (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Chưa phát hành được:</p>
          <ul className="mt-1 list-disc pl-5">
            {inv.blocking_errors.map((e) => (
              <li key={e.code + e.message}>{e.message}</li>
            ))}
          </ul>
          <p className="mt-1">Khắc phục (nhập chỉ số, đặt giá…) rồi bấm “Tính lại”.</p>
        </div>
      ) : null}

      <Card>
        <CardContent>
          <DescriptionList
            items={[
              { label: 'Kỳ', value: periodText(inv.period) },
              { label: 'Ngày lập', value: formatBusinessDate(inv.issue_date) },
              { label: 'Hạn thanh toán', value: formatBusinessDate(inv.due_date) },
              { label: isCredit ? 'Tổng credit' : 'Tổng cộng', value: <span className="tabular text-base font-semibold">{money(inv.total_vnd)}</span> },
              ...(inv.lifecycle === 'PUBLISHED' && !isCredit
                ? [
                    { label: 'Đã thu', value: <span className="tabular">{formatVnd(inv.settled_vnd)}</span> },
                    { label: 'Còn phải thu', value: <span className="tabular font-semibold">{formatVnd(inv.remaining_vnd)}</span> },
                  ]
                : []),
              {
                label: 'Lần thuê',
                value: (
                  <Link href={`/tenancies/${inv.tenancy_id}`} className="text-brand-800 hover:underline">
                    {inv.tenancy_code}
                  </Link>
                ),
              },
              ...(inv.source_invoice_id
                ? [
                    {
                      label: 'Chứng từ gốc',
                      value: (
                        <Link href={`/invoices/${inv.source_invoice_id}`} className="text-brand-800 hover:underline">
                          {inv.source_invoice_number ?? 'Xem'}
                        </Link>
                      ),
                    },
                  ]
                : []),
              ...(inv.cancel_reason ? [{ label: 'Lý do hủy', value: inv.cancel_reason }] : []),
            ]}
          />
          {inv.adjustments.length ? (
            <p className="mt-3 text-sm">
              Chứng từ liên quan:{' '}
              {inv.adjustments.map((a, i) => (
                <span key={a.id}>
                  {i ? ', ' : ''}
                  <Link href={`/invoices/${a.id}`} className="text-brand-800 hover:underline">
                    {a.number ?? INVOICE_TYPE_LABELS[a.type]}
                  </Link>{' '}
                  <Badge tone="violet">{INVOICE_TYPE_LABELS[a.type]}</Badge> {formatVnd(a.total_vnd)}
                </span>
              ))}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <InvoiceLines items={inv.items} />
        <CardContent className="flex justify-end border-t border-slate-100 text-base">
          <span>
            {isCredit ? 'Tổng credit' : 'Tổng cộng'}: <strong className="tabular">{money(inv.total_vnd)}</strong>
          </span>
        </CardContent>
      </Card>

      <PublishDialog open={publishing} onClose={() => setPublishing(false)} invoice={inv} />
      <AdjustDialog open={adjusting} onClose={() => setAdjusting(false)} invoice={inv} />
      <ReasonDialog
        open={cancelling}
        title={draft ? 'Hủy nháp thông báo' : `Hủy thông báo ${inv.number ?? ''}`}
        description={
          draft
            ? 'Nháp bị hủy; các khoản trong nháp sẽ được tính lại ở lần tạo nháp sau.'
            : 'Chỉ hủy được khi chưa có khoản thu hay cấn trừ. Các khoản trong thông báo sẽ được lập lại ở thông báo sau.'
        }
        confirmLabel={draft ? 'Hủy nháp' : 'Hủy thông báo'}
        pending={action.isPending}
        onClose={() => setCancelling(false)}
        onConfirm={async (reason) => {
          try {
            await action.mutateAsync({ path: `/invoices/${id}/cancel`, body: { reason, expected_version: inv.version } });
            toast.success('Đã hủy.');
            setCancelling(false);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không hủy được.');
          }
        }}
      />
    </div>
  );
}

function PublishDialog({ open, onClose, invoice }: { open: boolean; onClose: () => void; invoice: InvoiceDetail }) {
  const toast = useToast();
  const action = useInvoiceAction<{ invoice: InvoiceDetail; credit_invoice: { number: string; total_vnd: string } | null }>();
  const [error, setError] = useState('');
  const negative = invoice.total_vnd.startsWith('-');
  const submit = async () => {
    setError('');
    try {
      const r = await action.mutateAsync({ path: `/invoices/${invoice.id}/publish`, body: { expected_version: invoice.version, source_hash: invoice.source_hash } });
      toast.success(
        `Đã phát hành ${r.invoice.number}${r.credit_invoice ? ` và chứng từ credit ${r.credit_invoice.number} (${formatVnd(r.credit_invoice.total_vnd)})` : ''}.`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không phát hành được.');
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Phát hành thông báo" description="Sau khi phát hành, nội dung bị khóa và được cấp số chứng từ; không sửa được.">
      {open ? (
        <div className="flex flex-col gap-4">
          <FormError message={error} />
          <p className="text-sm">
            Phòng <strong>{invoice.room_code}</strong> · {invoice.primary_tenant_name ?? '—'} · kỳ {periodText(invoice.period)}
          </p>
          <p className="text-sm">
            Tổng: <strong className="tabular">{money(invoice.total_vnd)}</strong> · hạn {formatBusinessDate(invoice.due_date)}
          </p>
          {negative ? (
            <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900">
              Tổng âm: các dòng giảm trừ sẽ được tách sang một chứng từ credit riêng (phát hành cùng lúc); thông báo này chỉ giữ các khoản phải thu.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Đóng
            </Button>
            <Button onClick={() => void submit()} disabled={action.isPending}>
              Phát hành
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function AdjustDialog({ open, onClose, invoice }: { open: boolean; onClose: () => void; invoice: InvoiceDetail }) {
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Điều chỉnh ngay" description="Đối soát các khoản đã phát hành của lần thuê với dữ liệu hiện tại; xem trước không ghi gì.">
      {open ? <AdjustForm invoice={invoice} onClose={onClose} /> : null}
    </Dialog>
  );
}

interface AdjustResult {
  confirmed: boolean;
  lines: InvoiceDetail['items'];
  debit_total_vnd: string;
  credit_total_vnd: string;
  open_draft_id: string | null;
  debit_invoice: { number: string } | null;
  credit_invoice: { number: string } | null;
}

function AdjustForm({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const toast = useToast();
  const action = useInvoiceAction<AdjustResult>();
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<AdjustResult | null>(null);
  const [error, setError] = useState('');
  const call = async (confirm: boolean) => {
    setError('');
    try {
      const r = await action.mutateAsync({ path: `/invoices/${invoice.id}/adjustments`, body: { confirm, reason: reason.trim() } });
      if (!confirm) setPreview(r);
      else {
        toast.success(`Đã phát hành ${[r.debit_invoice?.number, r.credit_invoice?.number].filter(Boolean).join(' và ')}.`);
        onClose();
      }
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors ?? {})[0]?.[0] ?? e.message) : 'Không điều chỉnh được.');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Field id="adj-reason" label="Lý do" required>
        <TextInput id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Sửa giá thuê tháng trước" />
      </Field>
      {preview ? (
        preview.lines.length ? (
          <>
            <InvoiceLines items={preview.lines} />
            <p className="text-sm">
              Tăng: <strong className="tabular">{formatVnd(preview.debit_total_vnd)}</strong> · Giảm (credit): <strong className="tabular">{formatVnd(preview.credit_total_vnd)}</strong>
            </p>
            {preview.open_draft_id ? <p className="text-sm text-amber-800">Lần thuê đang có nháp: nháp sẽ được hủy và tạo lại sau khi phát hành điều chỉnh.</p> : null}
          </>
        ) : (
          <p className="text-sm text-slate-600">Không có chênh lệch nào cần điều chỉnh.</p>
        )
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button variant="outline" onClick={() => void call(false)} disabled={action.isPending || reason.trim().length < 3}>
          Xem trước
        </Button>
        <Button onClick={() => void call(true)} disabled={action.isPending || !preview?.lines.length}>
          Phát hành điều chỉnh
        </Button>
      </div>
    </div>
  );
}
