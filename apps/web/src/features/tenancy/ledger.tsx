'use client';

import { DEPOSIT_TX_LABELS, HOLDING_TX_LABELS, type LedgerTxDto, PAYMENT_METHOD_LABELS } from '@ql-tro/shared';
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, MoneyInput, Select, TextInput, Textarea } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { useLedgerPost } from './api';

export type LedgerKind = 'deposit' | 'holding';

const LABELS: Record<LedgerKind, Record<string, string>> = { deposit: DEPOSIT_TX_LABELS, holding: HOLDING_TX_LABELS };

export function SignedMoney({ value }: { value: string }) {
  const negative = value.startsWith('-');
  return <span className={`tabular ${negative ? 'text-red-700' : 'text-emerald-700'}`}>{negative ? `− ${formatVnd(value.slice(1))}` : `+ ${formatVnd(value)}`}</span>;
}

export function LedgerTable({ kind, txs, canReverse }: { kind: LedgerKind; txs: LedgerTxDto[]; canReverse: boolean }) {
  const toast = useToast();
  const post = useLedgerPost();
  const [key, renew] = useIdempotencyKey();
  const [reversing, setReversing] = useState<LedgerTxDto | null>(null);
  if (txs.length === 0) return <EmptyState title="Chưa có giao dịch" />;
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Ngày</Th>
            <Th>Loại</Th>
            <Th className="text-right">Số tiền</Th>
            <Th className="hidden md:table-cell">Phương thức</Th>
            <Th className="hidden md:table-cell">Ghi chú</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {txs.map((t) => (
            <Tr key={t.id} className={t.reversed ? 'opacity-60' : ''}>
              <Td className="tabular whitespace-nowrap">{t.paid_at ? formatBusinessDate(t.paid_at) : '—'}</Td>
              <Td>
                {LABELS[kind][t.type] ?? t.type}
                {t.reversed ? (
                  <Badge tone="gray" className="ml-1">
                    Đã đảo
                  </Badge>
                ) : null}
                {t.linked_transaction_id && t.type !== 'REVERSAL' ? (
                  <Badge tone="violet" className="ml-1">
                    Liên kết
                  </Badge>
                ) : null}
              </Td>
              <Td className="text-right whitespace-nowrap">
                <SignedMoney value={t.signed_amount_vnd} />
              </Td>
              <Td className="hidden md:table-cell">{t.method ? PAYMENT_METHOD_LABELS[t.method as keyof typeof PAYMENT_METHOD_LABELS] : '—'}</Td>
              <Td className="hidden max-w-xs text-slate-600 md:table-cell">
                {[t.reason, t.reference].filter(Boolean).join(' · ') || '—'}
                {t.created_by_name ? <div className="text-xs text-slate-400">{t.created_by_name}</div> : null}
              </Td>
              <Td className="text-right">
                {canReverse && !t.reversed && t.type !== 'REVERSAL' ? (
                  <Button variant="ghost" size="sm" onClick={() => setReversing(t)} aria-label="Đảo giao dịch">
                    <Undo2 className="size-4" />
                  </Button>
                ) : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <ReasonDialog
        open={!!reversing}
        title="Đảo giao dịch"
        description={
          reversing?.linked_transaction_id
            ? 'Giao dịch này thuộc một cặp liên kết (giữ chỗ ↔ cọc). Hệ thống sẽ đảo cả hai phía cùng lúc.'
            : 'Đảo giao dịch không xóa dữ liệu; một giao dịch đảo ngược dấu sẽ được ghi thêm.'
        }
        confirmLabel="Đảo giao dịch"
        pending={post.isPending}
        onClose={() => setReversing(null)}
        onConfirm={async (reason) => {
          if (!reversing) return;
          const path = kind === 'deposit' ? `/deposit-transactions/${reversing.id}/reverse` : `/holding-transactions/${reversing.id}/reverse`;
          try {
            await post.mutateAsync({ path, body: { reason }, key });
            renew();
            toast.success('Đã đảo giao dịch.');
            setReversing(null);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không đảo được.');
          }
        }}
      />
    </>
  );
}

const TYPE_OPTIONS: Record<LedgerKind, { value: string; label: string }[]> = {
  deposit: [
    { value: 'RECEIVED', label: 'Nhận cọc' },
    { value: 'TOP_UP', label: 'Nhận thêm cọc' },
    { value: 'REFUND', label: 'Hoàn cọc (đã chi thật)' },
    { value: 'DEDUCTION', label: 'Khấu trừ theo thỏa thuận' },
  ],
  holding: [
    { value: 'RECEIVED', label: 'Nhận tiền giữ chỗ' },
    { value: 'REFUND', label: 'Hoàn tiền giữ chỗ (đã chi thật)' },
    { value: 'FORFEIT', label: 'Giữ lại theo thỏa thuận' },
  ],
};

/** Ghi một giao dịch tiền thực tế. Chỉ ghi khi tiền đã thực nhận/thực chi. */
export function LedgerTxDialog({ open, onClose, kind, path, allowed }: { open: boolean; onClose: () => void; kind: LedgerKind; path: string; allowed: string[] }) {
  return (
    <Dialog open={open} onClose={onClose} title={kind === 'deposit' ? 'Ghi giao dịch cọc' : 'Ghi tiền giữ chỗ'} description="Chỉ ghi khi tiền đã thực nhận hoặc thực chi.">
      {open ? <LedgerTxForm kind={kind} path={path} allowed={allowed} onClose={onClose} /> : null}
    </Dialog>
  );
}

function LedgerTxForm({ kind, path, allowed, onClose }: { kind: LedgerKind; path: string; allowed: string[]; onClose: () => void }) {
  const toast = useToast();
  const post = useLedgerPost();
  const [key, renew] = useIdempotencyKey();
  const options = TYPE_OPTIONS[kind].filter((o) => allowed.includes(o.value));
  const [v, setV] = useState({ type: options[0]?.value ?? 'RECEIVED', amount_vnd: '', paid_at: todayLocal(), method: 'CASH', reference: '', reason: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const needsMethod = !(v.type === 'DEDUCTION' || v.type === 'FORFEIT');
  const needsReason = v.type !== 'RECEIVED' && v.type !== 'TOP_UP';

  const submit = async () => {
    setError('');
    setFieldErrors({});
    try {
      await post.mutateAsync({
        path,
        key,
        body: {
          type: v.type,
          amount_vnd: v.amount_vnd,
          paid_at: v.paid_at,
          method: needsMethod ? v.method : null,
          reference: v.reference.trim() || null,
          reason: v.reason.trim() || null,
        },
      });
      renew();
      toast.success(`Đã ghi ${options.find((o) => o.value === v.type)?.label.toLowerCase()} ${formatVnd(v.amount_vnd || '0')}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors ?? {});
      } else setError('Không ghi được.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Field id="lt-type" label="Loại giao dịch" required>
        <Select id="lt-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="lt-amount" label="Số tiền" required error={fieldErrors.amount_vnd?.[0]}>
          <MoneyInput id="lt-amount" value={v.amount_vnd} onChange={(amount_vnd) => setV({ ...v, amount_vnd })} />
        </Field>
        <Field id="lt-date" label={needsMethod ? 'Ngày thực nhận/chi' : 'Ngày'} required error={fieldErrors.paid_at?.[0]}>
          <TextInput id="lt-date" type="date" value={v.paid_at} onChange={(e) => setV({ ...v, paid_at: e.target.value })} />
        </Field>
        {needsMethod ? (
          <Field id="lt-method" label="Phương thức" required error={fieldErrors.method?.[0]}>
            <Select id="lt-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {needsMethod ? (
          <Field id="lt-ref" label="Mã giao dịch / tham chiếu">
            <TextInput id="lt-ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
          </Field>
        ) : null}
      </div>
      <Field id="lt-reason" label="Lý do" required={needsReason} error={fieldErrors.reason?.[0]}>
        <Textarea id="lt-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={() => void submit()} disabled={post.isPending || !v.amount_vnd}>
          {post.isPending ? 'Đang ghi…' : 'Ghi giao dịch'}
        </Button>
      </div>
    </div>
  );
}
