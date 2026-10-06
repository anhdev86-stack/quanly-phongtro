'use client';

import { Field, TextInput, Textarea } from '@/components/ui/form';
import { termEndAfterMonths } from '@/lib/format';

export interface ContractDraft {
  enabled: boolean;
  term_start: string;
  term_end: string;
  signed: boolean;
  signed_at: string;
  notice_days: string;
  terms_note: string;
}

export const emptyContract = (start: string): ContractDraft => ({
  enabled: false,
  term_start: start,
  term_end: termEndAfterMonths(start, 6),
  signed: true,
  signed_at: start,
  notice_days: '30',
  terms_note: '',
});

export function contractToInput(c: ContractDraft) {
  if (!c.enabled) return null;
  return {
    term_start: c.term_start,
    term_end: c.term_end,
    signed: c.signed,
    signed_at: c.signed ? c.signed_at || c.term_start : null,
    notice_days: Number(c.notice_days) || 0,
    terms_note: c.terms_note.trim() || null,
  };
}

export function ContractStep({
  value,
  onChange,
  startDate,
  errors,
}: {
  value: ContractDraft;
  onChange: (v: ContractDraft) => void;
  startDate: string;
  errors: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-brand-600"
          checked={value.enabled}
          onChange={(e) =>
            onChange(
              // Ngày nhận phòng có thể đã đổi ở bước 1: lấy lại kỳ mặc định theo ngày mới.
              e.target.checked && value.term_start !== startDate ? { ...emptyContract(startDate), enabled: true } : { ...value, enabled: e.target.checked },
            )
          }
        />
        Tạo hợp đồng có thời hạn
      </label>
      {value.enabled ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="ct-start" label="Từ ngày" required error={errors.term_start}>
            <TextInput id="ct-start" type="date" value={value.term_start} onChange={(e) => onChange({ ...value, term_start: e.target.value })} />
          </Field>
          <Field id="ct-end" label="Đến hết ngày" required error={errors.term_end}>
            <TextInput id="ct-end" type="date" value={value.term_end} onChange={(e) => onChange({ ...value, term_end: e.target.value })} />
          </Field>
          <Field id="ct-notice" label="Số ngày báo trước khi trả phòng">
            <TextInput id="ct-notice" inputMode="numeric" value={value.notice_days} onChange={(e) => onChange({ ...value, notice_days: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={value.signed} onChange={(e) => onChange({ ...value, signed: e.target.checked })} />
            Hai bên đã ký giấy tờ
          </label>
          {value.signed ? (
            <Field id="ct-signed" label="Ngày ký">
              <TextInput id="ct-signed" type="date" value={value.signed_at} onChange={(e) => onChange({ ...value, signed_at: e.target.value })} />
            </Field>
          ) : null}
          <Field id="ct-terms" label="Điều khoản / ghi chú" className="sm:col-span-2">
            <Textarea id="ct-terms" value={value.terms_note} onChange={(e) => onChange({ ...value, terms_note: e.target.value })} />
          </Field>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Không tạo hợp đồng: lần thuê là thuê theo tháng. Có thể tạo hợp đồng sau.</p>
      )}
    </div>
  );
}
