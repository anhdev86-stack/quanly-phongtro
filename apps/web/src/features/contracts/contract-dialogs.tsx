'use client';

import type { ContractDto, TenancyDetail } from '@ql-tro/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, MoneyInput, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { addDays, firstOfNextMonth, formatBusinessDate, formatVnd, termEndAfterMonths, todayLocal } from '@/lib/format';
import { useContractAction } from './api';

type FieldErrors = Record<string, string[]>;

function useSubmitState() {
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const capture = (e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      setError(e.message);
      setFieldErrors(e.fieldErrors ?? {});
    } else setError(fallback);
  };
  const reset = () => {
    setError('');
    setFieldErrors({});
  };
  return { error, fieldErrors, capture, reset };
}

function Checkbox({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm">
      <input id={id} type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Ngày giữa tháng (không phải ngày 1) thì tiền phòng tháng đó tính theo hai mức giá. */
const isMidMonth = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.endsWith('-01');

// ---------- Tạo / gia hạn ----------

export function ContractFormDialog({
  open,
  onClose,
  tenancy,
  renewFrom,
}: {
  open: boolean;
  onClose: () => void;
  tenancy: TenancyDetail;
  /** Có giá trị = gia hạn từ kỳ đã ký này (kỳ mới bắt đầu ngay sau ngày kết thúc). */
  renewFrom: ContractDto | null;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={renewFrom ? `Gia hạn hợp đồng ${renewFrom.code}` : 'Tạo hợp đồng'}
      description={
        renewFrom
          ? 'Gia hạn tạo một kỳ hợp đồng mới trong cùng lần thuê. Kỳ cũ giữ nguyên; cọc đang giữ chuyển tiếp, không nhận lại.'
          : 'Hợp đồng có thời hạn. Hết hạn không kết thúc lần thuê — khách tiếp tục thuê theo tháng cho tới khi trả phòng.'
      }
    >
      {open ? <ContractForm tenancy={tenancy} renewFrom={renewFrom} onClose={onClose} /> : null}
    </Dialog>
  );
}

function ContractForm({ tenancy, renewFrom, onClose }: { tenancy: TenancyDetail; renewFrom: ContractDto | null; onClose: () => void }) {
  const toast = useToast();
  const action = useContractAction();
  const state = useSubmitState();
  const start = renewFrom ? addDays(renewFrom.term_end, 1) : tenancy.start_date;
  const [v, setV] = useState({
    term_start: start,
    term_end: termEndAfterMonths(start, 6),
    notice_days: String(renewFrom?.terms.notice_days ?? tenancy.notice_days),
    monthly_rent_vnd: '',
    deposit_required_vnd: '',
    terms_note: '',
    signed: true,
    signed_at: todayLocal(),
    confirm_mid_month_price: false,
  });
  const rentChanges = v.monthly_rent_vnd !== '' && v.monthly_rent_vnd !== tenancy.current_rent_vnd;
  const needsConfirm = v.signed && rentChanges && isMidMonth(v.term_start);

  const submit = async () => {
    state.reset();
    try {
      const c = await action.mutateAsync({
        path: `/tenancies/${tenancy.id}/contracts${renewFrom ? '/renew' : ''}`,
        body: {
          term_start: v.term_start,
          term_end: v.term_end,
          notice_days: Number(v.notice_days) || 0,
          monthly_rent_vnd: v.monthly_rent_vnd || null,
          deposit_required_vnd: v.deposit_required_vnd || null,
          terms_note: v.terms_note.trim() || null,
          signed: v.signed,
          signed_at: v.signed ? v.signed_at : null,
          confirm_mid_month_price: v.confirm_mid_month_price,
        },
      });
      toast.success(`Đã ${renewFrom ? 'gia hạn' : 'tạo'} hợp đồng ${c.code}.`);
      onClose();
    } catch (e) {
      state.capture(e, 'Không lưu được hợp đồng.');
    }
  };
  const fe = state.fieldErrors;

  return (
    <div className="flex flex-col gap-4">
      <FormError message={state.error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="cf-start" label="Từ ngày" required error={fe.term_start?.[0]}>
          <TextInput id="cf-start" type="date" value={v.term_start} onChange={(e) => setV({ ...v, term_start: e.target.value })} />
        </Field>
        <Field id="cf-end" label="Đến hết ngày" required error={fe.term_end?.[0]}>
          <TextInput id="cf-end" type="date" value={v.term_end} onChange={(e) => setV({ ...v, term_end: e.target.value })} />
        </Field>
        <Field id="cf-rent" label="Giá thuê theo kỳ này" hint={`Bỏ trống = giữ giá hiện tại${tenancy.current_rent_vnd ? ` (${formatVnd(tenancy.current_rent_vnd)})` : ''}`} error={fe.monthly_rent_vnd?.[0]}>
          <MoneyInput id="cf-rent" value={v.monthly_rent_vnd} onChange={(monthly_rent_vnd) => setV({ ...v, monthly_rent_vnd })} />
        </Field>
        <Field id="cf-deposit" label="Mức cọc theo kỳ này" hint={`Bỏ trống = giữ mức hiện tại (${formatVnd(tenancy.deposit.required_vnd)})`} error={fe.deposit_required_vnd?.[0]}>
          <MoneyInput id="cf-deposit" value={v.deposit_required_vnd} onChange={(deposit_required_vnd) => setV({ ...v, deposit_required_vnd })} />
        </Field>
        <Field id="cf-notice" label="Số ngày báo trước khi trả phòng" error={fe.notice_days?.[0]}>
          <TextInput id="cf-notice" inputMode="numeric" value={v.notice_days} onChange={(e) => setV({ ...v, notice_days: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-2">
          <Checkbox id="cf-signed" checked={v.signed} onChange={(signed) => setV({ ...v, signed })}>
            Hai bên đã ký giấy tờ
          </Checkbox>
        </div>
        {v.signed ? (
          <Field id="cf-signed-at" label="Ngày ký" required error={fe.signed_at?.[0]}>
            <TextInput id="cf-signed-at" type="date" value={v.signed_at} onChange={(e) => setV({ ...v, signed_at: e.target.value })} />
          </Field>
        ) : (
          <p className="self-end pb-2 text-sm text-slate-500">Lưu nháp: chưa có hiệu lực, chưa đổi giá/cọc cho tới khi xác nhận đã ký.</p>
        )}
        <Field id="cf-terms" label="Điều khoản / ghi chú" className="sm:col-span-2">
          <Textarea id="cf-terms" value={v.terms_note} onChange={(e) => setV({ ...v, terms_note: e.target.value })} />
        </Field>
      </div>
      {needsConfirm || fe.confirm_mid_month_price ? (
        <Checkbox id="cf-confirm-mid" checked={v.confirm_mid_month_price} onChange={(confirm_mid_month_price) => setV({ ...v, confirm_mid_month_price })}>
          Giá mới bắt đầu giữa tháng ({formatBusinessDate(v.term_start)}). Tôi xác nhận tiền phòng tháng đó sẽ tính theo hai mức giá.
          {fe.confirm_mid_month_price ? <span className="block text-red-700">{fe.confirm_mid_month_price[0]}</span> : null}
        </Checkbox>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending}>
          {v.signed ? (renewFrom ? 'Lưu kỳ gia hạn' : 'Lưu hợp đồng đã ký') : 'Lưu nháp'}
        </Button>
      </div>
    </div>
  );
}

// ---------- Ký hợp đồng nháp ----------

export function SignContractDialog({ contract, onClose, currentRent }: { contract: ContractDto | null; onClose: () => void; currentRent: string | null }) {
  return (
    <Dialog open={!!contract} onClose={onClose} title={contract ? `Xác nhận đã ký ${contract.code}` : ''} description="Sau khi ký, hợp đồng có hiệu lực theo kỳ và không sửa được; đổi điều khoản bằng kỳ hợp đồng mới.">
      {contract ? <SignForm contract={contract} onClose={onClose} currentRent={currentRent} /> : null}
    </Dialog>
  );
}

function SignForm({ contract, onClose, currentRent }: { contract: ContractDto; onClose: () => void; currentRent: string | null }) {
  const toast = useToast();
  const action = useContractAction();
  const state = useSubmitState();
  const [signedAt, setSignedAt] = useState(todayLocal());
  const [confirm, setConfirm] = useState(false);
  const rent = contract.terms.monthly_rent_vnd;
  const needsConfirm = !!rent && rent !== currentRent && isMidMonth(contract.term_start);

  const submit = async () => {
    state.reset();
    try {
      await action.mutateAsync({
        path: `/contracts/${contract.id}/sign`,
        body: { signed_at: signedAt, confirm_mid_month_price: confirm, expected_version: contract.version },
      });
      toast.success(`Đã xác nhận ký ${contract.code}.`);
      onClose();
    } catch (e) {
      state.capture(e, 'Không xác nhận được.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FormError message={state.error} />
      <p className="text-sm">
        Kỳ {formatBusinessDate(contract.term_start)} → {formatBusinessDate(contract.term_end)}
        {rent ? ` · giá ${formatVnd(rent)}` : ''}
        {contract.terms.deposit_required_vnd ? ` · cọc ${formatVnd(contract.terms.deposit_required_vnd)}` : ''}
      </p>
      <Field id="sg-date" label="Ngày ký" required error={state.fieldErrors.signed_at?.[0]}>
        <TextInput id="sg-date" type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
      </Field>
      {needsConfirm || state.fieldErrors.confirm_mid_month_price ? (
        <Checkbox id="sg-confirm" checked={confirm} onChange={setConfirm}>
          Giá mới bắt đầu giữa tháng. Tôi xác nhận tiền phòng tháng đó sẽ tính theo hai mức giá.
        </Checkbox>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending}>
          Xác nhận đã ký
        </Button>
      </div>
    </div>
  );
}

// ---------- Đổi giá thuê ----------

export function RentPriceDialog({ open, onClose, tenancy }: { open: boolean; onClose: () => void; tenancy: TenancyDetail }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Đổi giá thuê"
      description="Giá mới có hiệu lực từ ngày chọn; các tháng trước giữ nguyên. Nên đổi từ ngày 1 để tiền phòng mỗi tháng chỉ có một mức giá."
    >
      {open ? <RentPriceForm tenancy={tenancy} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RentPriceForm({ tenancy, onClose }: { tenancy: TenancyDetail; onClose: () => void }) {
  const toast = useToast();
  const action = useContractAction<unknown>();
  const state = useSubmitState();
  const [v, setV] = useState({ effective_from: firstOfNextMonth(todayLocal()), monthly_rent_vnd: '', reason: '', only_month: false, confirm_mid_month: false });
  const mid = isMidMonth(v.effective_from);

  const submit = async () => {
    state.reset();
    try {
      await action.mutateAsync({
        path: `/tenancies/${tenancy.id}/rent-prices`,
        body: { ...v, reason: v.reason.trim(), confirm_mid_month: mid && v.confirm_mid_month },
      });
      toast.success(`Đã đặt giá ${formatVnd(v.monthly_rent_vnd || '0')} từ ${formatBusinessDate(v.effective_from)}${v.only_month ? ' (chỉ tháng này)' : ''}.`);
      onClose();
    } catch (e) {
      state.capture(e, 'Không đổi được giá.');
    }
  };
  const fe = state.fieldErrors;

  return (
    <div className="flex flex-col gap-4">
      <FormError message={state.error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="rp-from" label="Có hiệu lực từ" required error={fe.effective_from?.[0]}>
          <TextInput id="rp-from" type="date" value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value })} />
        </Field>
        <Field id="rp-amount" label="Giá thuê mỗi tháng" required error={fe.monthly_rent_vnd?.[0]}>
          <MoneyInput id="rp-amount" value={v.monthly_rent_vnd} onChange={(monthly_rent_vnd) => setV({ ...v, monthly_rent_vnd })} />
        </Field>
        <Field id="rp-reason" label="Lý do" required className="sm:col-span-2" error={fe.reason?.[0]}>
          <TextInput id="rp-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="VD: Tăng giá theo thỏa thuận, giảm giá tháng sửa chữa…" />
        </Field>
      </div>
      <Checkbox id="rp-only-month" checked={v.only_month} onChange={(only_month) => setV({ ...v, only_month })}>
        Chỉ áp dụng cho tháng này — từ ngày 1 tháng sau tự quay về giá trước đó (giảm giá một tháng).
      </Checkbox>
      {mid || fe.confirm_mid_month ? (
        <Checkbox id="rp-confirm-mid" checked={v.confirm_mid_month} onChange={(confirm_mid_month) => setV({ ...v, confirm_mid_month })}>
          Ngày hiệu lực giữa tháng. Tôi xác nhận tiền phòng tháng đó sẽ tính theo hai mức giá.
          {fe.confirm_mid_month ? <span className="block text-red-700">{fe.confirm_mid_month[0]}</span> : null}
        </Checkbox>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending}>
          Lưu giá mới
        </Button>
      </div>
    </div>
  );
}
