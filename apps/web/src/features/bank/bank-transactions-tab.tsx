'use client';

import { BANK_TRANSACTION_STATUS_LABELS, type BankConfigDto, type BankTransactionDto, type BankTransactionStatus, PERMISSIONS } from '@ql-tro/shared';
import { FlaskConical, RefreshCw, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FilterBar, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, MoneyInput, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useInvoices } from '@/features/billing/api';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { useBankAction, useBankConfig, useBankOptions, useBankResend, useBankRetry, useBankSimulate, useBankSync, useBankTransaction, useBankTransactions } from './api';

const STATUS_TONE: Record<BankTransactionStatus, BadgeTone> = { RECEIVED: 'blue', MATCHED: 'green', PENDING_REVIEW: 'amber', ERROR: 'red', NOT_APPLICABLE: 'gray' };
const MODE_LABEL: Record<BankConfigDto['mode'], string> = { off: 'Tắt', mock: 'Giả lập (mock)', test: 'Thử nghiệm', live: 'Thật' };

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const resolvable = (t: BankTransactionDto) => t.direction === 'IN' && ['PENDING_REVIEW', 'ERROR', 'RECEIVED'].includes(t.status) && BigInt(t.unallocated_vnd) > 0n;

/** Tab “Giao dịch ngân hàng” (D-047): giao dịch nhận qua webhook/đồng bộ, trạng thái đối chiếu, đối chiếu tay, công cụ giả lập (mock). */
export function BankTransactionsTab() {
  const can = useCan();
  const reconcile = can(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE);
  const config = useBankConfig();
  const [f, setF] = useState({ status: '', q: '', page: 1, page_size: 50 });
  const list = useBankTransactions(f);
  const [openId, setOpenId] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const sync = useBankSync();
  const toast = useToast();
  const cfg = config.data;

  const runSync = async () => {
    try {
      const r = await sync.mutateAsync();
      toast.success(`Đồng bộ xong: lấy ${r.fetched} giao dịch, mới ${r.created}, trùng (bỏ qua) ${r.duplicates}.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không đồng bộ được.');
    }
  };

  return (
    <>
      {cfg ? <ModeBanner cfg={cfg} /> : null}
      <FilterBar>
        <Field id="bank-status" label="Trạng thái" className="sm:w-48">
          <Select id="bank-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>
            <option value="">Tất cả</option>
            {(Object.keys(BANK_TRANSACTION_STATUS_LABELS) as BankTransactionStatus[]).map((s) => (
              <option key={s} value={s}>
                {BANK_TRANSACTION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="bank-q" label="Tìm nội dung, mã giao dịch" className="sm:w-60">
          <TextInput id="bank-q" type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
        </Field>
        <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
          {reconcile && cfg?.sync_supported ? (
            <Button variant="outline" onClick={() => void runSync()} disabled={sync.isPending}>
              <RefreshCw className="size-4" aria-hidden />
              Đồng bộ giao dịch
            </Button>
          ) : null}
          {reconcile && cfg?.simulator_enabled ? (
            <Button onClick={() => setSimulating(true)}>
              <FlaskConical className="size-4" aria-hidden />
              Giả lập giao dịch
            </Button>
          ) : null}
        </div>
      </FilterBar>

      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.items.length ? (
        <EmptyState title="Chưa có giao dịch ngân hàng">Giao dịch chuyển khoản sẽ hiện ở đây khi nhà cung cấp gửi webhook hoặc khi đồng bộ.</EmptyState>
      ) : (
        <>
          <Table aria-label="Giao dịch ngân hàng">
            <thead>
              <tr>
                <Th>Thời gian</Th>
                <Th className="text-right">Số tiền</Th>
                <Th>Nội dung</Th>
                <Th>Mã giao dịch</Th>
                <Th>Nguồn</Th>
                <Th>Trạng thái</Th>
                <Th>Liên quan</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((t) => (
                <Tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(t.id)}>
                  <Td className="whitespace-nowrap tabular">{dateTime(t.occurred_at)}</Td>
                  <Td className={`text-right font-medium tabular ${t.direction === 'OUT' ? 'text-red-700' : ''}`}>
                    {t.direction === 'OUT' ? '−' : '+'}
                    {formatVnd(t.amount_vnd)}
                  </Td>
                  <Td className="max-w-72 truncate" title={t.content}>
                    {t.content || '—'}
                  </Td>
                  <Td className="tabular text-slate-600">{t.provider_transaction_id}</Td>
                  <Td className="text-slate-600">{t.source === 'WEBHOOK' ? 'Webhook' : 'Đồng bộ'}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[t.status]}>{BANK_TRANSACTION_STATUS_LABELS[t.status]}</Badge>
                  </Td>
                  <Td className="text-sm">
                    {t.invoice ? (
                      <span>
                        {t.invoice.number} · {t.invoice.room_code}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                    {t.payments.length ? <span className="block text-xs text-slate-500">{t.payments.map((p) => p.number).join(', ')}</span> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={f.page} pageSize={f.page_size} total={list.data.total} onPage={(page) => setF({ ...f, page })} />
        </>
      )}
      <BankDetailDialog id={openId} onClose={() => setOpenId(null)} cfg={cfg} />
      {cfg?.simulator_enabled ? <SimulateDialog open={simulating} onClose={() => setSimulating(false)} cfg={cfg} onCreated={(id) => setOpenId(id)} /> : null}
    </>
  );
}

function ModeBanner({ cfg }: { cfg: BankConfigDto }) {
  if (cfg.mode === 'off') {
    return (
      <p className="mb-4 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm text-slate-700">
        Chưa bật tự động ghi nhận chuyển khoản. Vẫn ghi nhận thu thủ công ở trang thông báo như bình thường.
      </p>
    );
  }
  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${cfg.mode === 'live' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <p className="font-medium">
        {cfg.mode === 'live' ? 'Tự động ghi nhận chuyển khoản đang bật' : 'Môi trường thử nghiệm — không chuyển tiền thật'} · Nhà cung cấp: {cfg.provider} ({MODE_LABEL[cfg.mode]})
      </p>
      <p className="mt-1 text-xs opacity-90">
        Tài khoản đối chiếu: {cfg.account_number ?? 'chưa cấu hình'}
        {cfg.last_synced_at ? ` · Đồng bộ lần cuối: ${dateTime(cfg.last_synced_at)}` : ''}
        {cfg.last_sync_error ? ` · Lỗi đồng bộ gần nhất: ${cfg.last_sync_error}` : ''}. Khi dịch vụ ngân hàng gặp sự cố, vẫn ghi nhận thu thủ công ở trang thông báo.
      </p>
    </div>
  );
}

function BankDetailDialog({ id, onClose, cfg }: { id: string | null; onClose: () => void; cfg: BankConfigDto | undefined }) {
  const can = useCan();
  const reconcile = can(PERMISSIONS.BANK_TRANSACTIONS_RECONCILE);
  const q = useBankTransaction(id);
  const t = q.data;
  const toast = useToast();
  const retry = useBankRetry();
  const resend = useBankResend();
  const action = useBankAction();
  const [mode, setMode] = useState<'allocate' | 'link' | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [key, renew] = useIdempotencyKey();

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không thực hiện được.');
    }
  };

  return (
    <Dialog open={!!id} onClose={onClose} size="lg" title="Chi tiết giao dịch ngân hàng" description={t ? `${t.provider} · ${t.environment} · mã ${t.provider_transaction_id}` : undefined}>
      {!t ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {(
              [
                ['Thời gian', dateTime(t.occurred_at)],
                ['Số tiền', `${t.direction === 'OUT' ? 'Tiền ra −' : 'Tiền vào +'}${formatVnd(t.amount_vnd)}`],
                ['Tài khoản', t.account_number],
                ['Mã tham chiếu', t.reference_code ?? '—'],
                ['Nguồn', t.source === 'WEBHOOK' ? 'Webhook' : 'Đồng bộ (lấy bù)'],
                ['Mã thanh toán nhận ra', t.payment_code ?? '—'],
                ['Đã phân bổ', formatVnd(t.allocated_vnd)],
                ['Chưa phân bổ', formatVnd(t.unallocated_vnd)],
              ] as const
            ).map(([l, v]) => (
              <div key={l}>
                <dt className="text-xs text-slate-500">{l}</dt>
                <dd className="font-medium tabular">{v}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Nội dung chuyển khoản</dt>
              <dd className="font-medium break-words">{t.content || '—'}</dd>
            </div>
          </dl>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[t.status]}>{BANK_TRANSACTION_STATUS_LABELS[t.status]}</Badge>
            {t.invoice ? (
              <Link href={`/invoices/${t.invoice.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                Thông báo {t.invoice.number} · {t.invoice.building_code} {t.invoice.room_code}
              </Link>
            ) : null}
          </div>
          {t.reason ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t.reason}</p> : null}
          {t.resolution_note ? (
            <p className="text-sm text-slate-600">
              Ghi chú xử lý: {t.resolution_note}
              {t.resolved_by_name ? ` — ${t.resolved_by_name}` : ''}
            </p>
          ) : null}
          {t.payments.length ? (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Phiếu thu liên quan</h3>
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {t.payments.map((p) => (
                  <li key={p.payment_id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>
                      {p.number} · {p.link === 'CREATED' ? 'tạo từ giao dịch này' : 'phiếu ghi tay đã liên kết'}
                      {p.status === 'REVERSED' ? <Badge className="ml-2">Đã đảo</Badge> : null}
                    </span>
                    <span className="font-medium tabular">{formatVnd(p.amount_vnd)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {reconcile ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {resolvable(t) ? (
                <>
                  <Button size="sm" onClick={() => setMode('allocate')}>
                    Ghi nhận vào thông báo
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setMode('link')}>
                    Liên kết phiếu thu có sẵn
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDismissing(true)}>
                    Không áp dụng
                  </Button>
                </>
              ) : null}
              {t.status === 'ERROR' || t.status === 'RECEIVED' ? (
                <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => void run(() => retry.mutateAsync(t.id), 'Đã xử lý lại giao dịch.')}>
                  Xử lý lại
                </Button>
              ) : null}
              {cfg?.simulator_enabled && t.mock_id ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={resend.isPending}
                  onClick={() =>
                    void run(async () => {
                      const r = await resend.mutateAsync(t.mock_id!);
                      if (r.webhook_status !== 200) throw new ApiError(r.webhook_status ?? 0, 'INTERNAL_ERROR', `Webhook trả HTTP ${r.webhook_status}.`);
                    }, 'Đã gửi lại webhook — giao dịch không bị ghi trùng.')
                  }
                >
                  <Send className="size-4" aria-hidden />
                  Gửi lại webhook (mock)
                </Button>
              ) : null}
              {!resolvable(t) && t.status !== 'ERROR' && t.status !== 'RECEIVED' ? <p className="text-sm text-slate-500">Giao dịch đã xử lý xong — không xử lý lại.</p> : null}
            </div>
          ) : null}

          {mode && resolvable(t) ? <ResolveForm t={t} mode={mode} onDone={() => setMode(null)} /> : null}
        </div>
      )}
      <ReasonDialog
        open={dismissing}
        title="Phần chưa phân bổ không áp dụng"
        description="VD: giao dịch không liên quan tiền phòng, đã trả lại người gửi. Không tạo phiếu thu."
        confirmLabel="Xác nhận"
        pending={action.isPending}
        onClose={() => setDismissing(false)}
        onConfirm={async (reason) => {
          await action.mutateAsync({ path: `/bank-transactions/${id}/dismiss`, body: { reason }, key });
          renew();
          setDismissing(false);
          toast.success('Đã đánh dấu không áp dụng.');
        }}
      />
    </Dialog>
  );
}

function ResolveForm({ t, mode, onDone }: { t: BankTransactionDto; mode: 'allocate' | 'link'; onDone: () => void }) {
  const options = useBankOptions(t.id, true);
  const action = useBankAction();
  const toast = useToast();
  const [key, renew] = useIdempotencyKey();
  const [invoiceId, setInvoiceId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  if (options.isPending) return <LoadingState />;
  if (options.isError) return <ErrorState error={options.error} />;
  const invoices = options.data.open_invoices;
  const selected = invoices.find((i) => i.id === invoiceId);
  const left = BigInt(t.unallocated_vnd);
  const suggest = (remaining: string) => (BigInt(remaining) < left ? remaining : t.unallocated_vnd);

  const submit = async () => {
    setError('');
    try {
      if (mode === 'allocate') {
        await action.mutateAsync({ path: `/bank-transactions/${t.id}/allocate`, body: { invoice_id: invoiceId, amount_vnd: amount }, key });
        toast.success(`Đã ghi phiếu thu ${formatVnd(amount)} vào ${selected?.number ?? 'thông báo'}.`);
      } else {
        await action.mutateAsync({ path: `/bank-transactions/${t.id}/link-payment`, body: { payment_id: paymentId }, key });
        toast.success('Đã liên kết với phiếu thu có sẵn — không tạo khoản thu mới.');
      }
      renew();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không thực hiện được.');
    }
  };

  return (
    <div className="rounded-lg border border-line bg-slate-50 p-3">
      {mode === 'allocate' ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field id="bank-invoice" label="Thông báo còn nợ (khớp mã lên đầu)">
            <Select
              id="bank-invoice"
              value={invoiceId}
              onChange={(e) => {
                setInvoiceId(e.target.value);
                const inv = invoices.find((i) => i.id === e.target.value);
                if (inv) setAmount(suggest(inv.remaining_vnd));
              }}
            >
              <option value="">— Chọn thông báo —</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.matches_code ? '★ ' : ''}
                  {i.number} · {i.building_code} {i.room_code} · {i.primary_tenant_name ?? '—'} · còn {formatVnd(i.remaining_vnd)} · hạn {formatBusinessDate(i.due_date)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="bank-amount" label="Số tiền ghi nhận">
            <MoneyInput id="bank-amount" value={amount} onChange={setAmount} />
          </Field>
        </div>
      ) : (
        <Field id="bank-payment" label="Phiếu thu chuyển khoản ghi tay chưa liên kết">
          <Select id="bank-payment" value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
            <option value="">— Chọn phiếu thu —</option>
            {options.data.unlinked_payments.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number} · {p.room_code} · {formatVnd(p.amount_vnd)} · {formatBusinessDate(p.paid_at)}
                {p.reference ? ` · ${p.reference}` : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <FormError message={error} />
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDone}>
          Hủy
        </Button>
        <Button size="sm" disabled={action.isPending || (mode === 'allocate' ? !invoiceId || !amount : !paymentId)} onClick={() => void submit()}>
          {mode === 'allocate' ? 'Ghi phiếu thu' : 'Liên kết'}
        </Button>
      </div>
    </div>
  );
}

function SimulateDialog({ open, onClose, cfg, onCreated }: { open: boolean; onClose: () => void; cfg: BankConfigDto; onCreated: (id: string) => void }) {
  const invoices = useInvoices({ lifecycle: 'PUBLISHED', page: 1, page_size: 100 }, open);
  const simulate = useBankSimulate();
  const toast = useToast();
  const [v, setV] = useState({ invoice: '', content: '', amount_vnd: '', direction: 'IN', account_number: '', delivery: 'WEBHOOK' });
  const [error, setError] = useState('');
  const open_ = (invoices.data?.items ?? []).filter((i) => i.number && BigInt(i.remaining_vnd) > 0n);

  const submit = async () => {
    setError('');
    try {
      const r = await simulate.mutateAsync({
        amount_vnd: v.amount_vnd,
        content: v.content,
        direction: v.direction,
        account_number: v.account_number.trim() || null,
        delivery: v.delivery,
      });
      const msg =
        r.delivery === 'LOST'
          ? `Đã tạo giao dịch #${r.mock_id} trong ngân hàng giả nhưng KHÔNG gửi webhook. Bấm “Đồng bộ giao dịch” để lấy bù.`
          : r.delivery === 'BAD_SIGNATURE'
            ? `Webhook gửi kèm khóa sai → máy chủ trả HTTP ${r.webhook_status}, không ghi nhận.`
            : `Webhook trả HTTP ${r.webhook_status}. Trạng thái: ${r.transaction ? BANK_TRANSACTION_STATUS_LABELS[r.transaction.status] : 'chưa có'}.`;
      toast.success(msg);
      onClose();
      if (r.transaction) onCreated(r.transaction.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không giả lập được.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Giả lập giao dịch chuyển khoản (mock)"
      description="Môi trường thử nghiệm — không chuyển tiền thật. Giao dịch đi qua đúng endpoint webhook như nhà cung cấp thật."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button disabled={simulate.isPending || !v.content.trim() || !v.amount_vnd} onClick={() => void submit()}>
            Tạo giao dịch
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="sim-invoice" label="Lấy theo thông báo (điền sẵn nội dung và số tiền)" className="sm:col-span-2">
          <Select
            id="sim-invoice"
            value={v.invoice}
            onChange={(e) => {
              const inv = open_.find((i) => i.id === e.target.value);
              setV({ ...v, invoice: e.target.value, ...(inv ? { content: `${inv.number!.replace(/-/g, '')} ${inv.room_code}`, amount_vnd: inv.remaining_vnd } : {}) });
            }}
          >
            <option value="">— Không chọn (tự nhập) —</option>
            {open_.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · {i.room_code} · còn {formatVnd(i.remaining_vnd)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="sim-content" label="Nội dung chuyển khoản" className="sm:col-span-2">
          <TextInput id="sim-content" value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} placeholder="VD: TB2026100001 A101" />
        </Field>
        <Field id="sim-amount" label="Số tiền">
          <MoneyInput id="sim-amount" value={v.amount_vnd} onChange={(amount_vnd) => setV({ ...v, amount_vnd })} />
        </Field>
        <Field id="sim-direction" label="Chiều giao dịch">
          <Select id="sim-direction" value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value })}>
            <option value="IN">Tiền vào</option>
            <option value="OUT">Tiền ra</option>
          </Select>
        </Field>
        <Field id="sim-account" label="Tài khoản nhận" hint={`Bỏ trống = ${cfg.account_number ?? 'tài khoản đang dùng'}`}>
          <TextInput id="sim-account" value={v.account_number} onChange={(e) => setV({ ...v, account_number: e.target.value })} />
        </Field>
        <Field id="sim-delivery" label="Cách gửi">
          <Select id="sim-delivery" value={v.delivery} onChange={(e) => setV({ ...v, delivery: e.target.value })}>
            <option value="WEBHOOK">Gửi webhook ngay</option>
            <option value="LOST">Mất webhook (lấy bù bằng Đồng bộ)</option>
            <option value="BAD_SIGNATURE">Khóa sai (thử bảo mật)</option>
          </Select>
        </Field>
      </div>
      <FormError message={error} />
    </Dialog>
  );
}
