'use client';

import { Search, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form';
import { useTenants } from './api';
import { emptyTenantDraft, TenantFields, type TenantDraft } from './tenant-fields';

export type PersonChoice = { kind: 'existing'; tenant_id: string; label: string } | { kind: 'new'; draft: TenantDraft };

export const newPerson = (): PersonChoice => ({ kind: 'new', draft: emptyTenantDraft() });

export function personLabel(p: PersonChoice): string {
  return p.kind === 'existing' ? p.label : p.draft.full_name || '(chưa nhập tên)';
}

export function personToRef(p: PersonChoice) {
  if (p.kind === 'existing') return { tenant_id: p.tenant_id };
  const d = p.draft;
  const blank = (v: string) => (v.trim() ? v.trim() : null);
  return {
    new_tenant: {
      full_name: d.full_name.trim(),
      phone: blank(d.phone),
      identity_number: blank(d.identity_number),
      birth_date: blank(d.birth_date),
      gender: (blank(d.gender) as 'MALE' | 'FEMALE' | 'OTHER' | null) ?? null,
      email: blank(d.email),
      issue_date: blank(d.issue_date),
      issue_place: blank(d.issue_place),
      permanent_address: blank(d.permanent_address),
      hometown: blank(d.hometown),
      note: blank(d.note),
    },
  };
}

/** Chọn người thuê đã có (tìm theo tên/SĐT) hoặc nhập người mới. */
export function PersonPicker({
  value,
  onChange,
  prefix,
  errors,
}: {
  value: PersonChoice;
  onChange: (p: PersonChoice) => void;
  prefix: string;
  errors?: Record<string, string>;
}) {
  const [q, setQ] = useState('');
  const results = useTenants({ q: q.trim() || undefined, page: 1, page_size: 5 });

  if (value.kind === 'existing') {
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <span>
          Người đã có: <strong>{value.label}</strong>
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChange(newPerson())} aria-label="Bỏ chọn">
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" aria-hidden />
        <TextInput
          aria-label="Tìm người thuê đã có"
          placeholder="Tìm người đã từng thuê (tên, SĐT)…"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q.trim() && results.data?.items.length ? (
          <ul className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
            {results.data.items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    onChange({ kind: 'existing', tenant_id: t.id, label: t.full_name });
                    setQ('');
                  }}
                >
                  <span>{t.full_name}</span>
                  <span className="text-slate-500">{t.phone ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="flex items-center gap-1 text-xs text-slate-500">
        <UserPlus className="size-3" aria-hidden /> Hoặc nhập người mới:
      </p>
      <TenantFields prefix={prefix} value={value.draft} onChange={(draft) => onChange({ kind: 'new', draft })} errors={errors} compact />
    </div>
  );
}
