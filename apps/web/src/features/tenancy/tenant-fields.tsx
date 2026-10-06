'use client';

import { GENDER_LABELS, type TenantInput } from '@ql-tro/shared';
import { Field, Select, TextInput } from '@/components/ui/form';

export type TenantDraft = {
  full_name: string;
  phone: string;
  identity_number: string;
  birth_date: string;
  gender: string;
  email: string;
  issue_date: string;
  issue_place: string;
  permanent_address: string;
  hometown: string;
  note: string;
};

export const emptyTenantDraft = (): TenantDraft => ({
  full_name: '',
  phone: '',
  identity_number: '',
  birth_date: '',
  gender: '',
  email: '',
  issue_date: '',
  issue_place: '',
  permanent_address: '',
  hometown: '',
  note: '',
});

const blank = (v: string) => (v.trim() ? v.trim() : null);

export function draftToInput(d: TenantDraft): TenantInput {
  return {
    full_name: d.full_name.trim(),
    phone: blank(d.phone),
    identity_number: blank(d.identity_number),
    birth_date: blank(d.birth_date),
    gender: (blank(d.gender) as TenantInput['gender']) ?? null,
    email: blank(d.email),
    issue_date: blank(d.issue_date),
    issue_place: blank(d.issue_place),
    permanent_address: blank(d.permanent_address),
    hometown: blank(d.hometown),
    note: blank(d.note),
  };
}

/** Các ô nhập thông tin người thuê. `errors` theo tên field (từ field_errors của API). */
export function TenantFields({
  value,
  onChange,
  errors = {},
  prefix,
  compact = false,
}: {
  value: TenantDraft;
  onChange: (v: TenantDraft) => void;
  errors?: Record<string, string | undefined>;
  prefix: string;
  compact?: boolean;
}) {
  const f = (name: keyof TenantDraft) => ({
    id: `${prefix}-${name}`,
    value: value[name],
    'aria-invalid': errors[name] ? true : undefined,
    onChange: (e: { target: { value: string } }) => onChange({ ...value, [name]: e.target.value }),
  });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field id={`${prefix}-full_name`} label="Họ tên" required error={errors.full_name}>
        <TextInput {...f('full_name')} />
      </Field>
      <Field id={`${prefix}-phone`} label="Số điện thoại" error={errors.phone}>
        <TextInput inputMode="tel" {...f('phone')} />
      </Field>
      <Field id={`${prefix}-identity_number`} label="Số CCCD" error={errors.identity_number} hint="9 hoặc 12 chữ số">
        <TextInput inputMode="numeric" {...f('identity_number')} />
      </Field>
      <Field id={`${prefix}-birth_date`} label="Ngày sinh" error={errors.birth_date}>
        <TextInput type="date" {...f('birth_date')} />
      </Field>
      {compact ? null : (
        <>
          <Field id={`${prefix}-gender`} label="Giới tính">
            <Select {...f('gender')}>
              <option value="">—</option>
              {Object.entries(GENDER_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`${prefix}-email`} label="Email" error={errors.email}>
            <TextInput type="email" {...f('email')} />
          </Field>
          <Field id={`${prefix}-issue_date`} label="Ngày cấp CCCD" error={errors.issue_date}>
            <TextInput type="date" {...f('issue_date')} />
          </Field>
          <Field id={`${prefix}-issue_place`} label="Nơi cấp">
            <TextInput {...f('issue_place')} />
          </Field>
          <Field id={`${prefix}-permanent_address`} label="Địa chỉ thường trú" className="sm:col-span-2">
            <TextInput {...f('permanent_address')} />
          </Field>
          <Field id={`${prefix}-hometown`} label="Quê quán">
            <TextInput {...f('hometown')} />
          </Field>
          <Field id={`${prefix}-note`} label="Ghi chú">
            <TextInput {...f('note')} />
          </Field>
        </>
      )}
    </div>
  );
}

/** Lấy lỗi theo field từ field_errors có tiền tố (vd: "primary.new_tenant.full_name"). */
export function scopedErrors(fieldErrors: Record<string, string[]> | undefined, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldErrors ?? {})) {
    if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v[0] ?? '';
  }
  return out;
}
