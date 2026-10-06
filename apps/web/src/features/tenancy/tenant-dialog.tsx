'use client';

import type { TenantDto } from '@ql-tro/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useCreateTenant, useUpdateTenant } from './api';
import { draftToInput, emptyTenantDraft, TenantFields, type TenantDraft } from './tenant-fields';

export function TenantDialog({ open, onClose, tenant }: { open: boolean; onClose: () => void; tenant?: TenantDto }) {
  return (
    <Dialog open={open} onClose={onClose} title={tenant ? `Sửa ${tenant.full_name}` : 'Thêm người thuê'} size="lg">
      {open ? <TenantForm tenant={tenant} onClose={onClose} /> : null}
    </Dialog>
  );
}

function fromDto(t?: TenantDto): TenantDraft {
  if (!t) return emptyTenantDraft();
  return {
    full_name: t.full_name,
    phone: t.phone ?? '',
    // Số CCCD bị che thì để trống: không sửa sẽ giữ nguyên giá trị cũ.
    identity_number: t.identity_masked ? '' : (t.identity_number ?? ''),
    birth_date: t.birth_date ?? '',
    gender: t.gender ?? '',
    email: t.email ?? '',
    issue_date: t.issue_date ?? '',
    issue_place: t.issue_place ?? '',
    permanent_address: t.permanent_address ?? '',
    hometown: t.hometown ?? '',
    note: t.note ?? '',
  };
}

function TenantForm({ tenant, onClose }: { tenant?: TenantDto; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateTenant();
  const update = useUpdateTenant(tenant?.id ?? '');
  const [draft, setDraft] = useState(() => fromDto(tenant));
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setError('');
    setFieldErrors({});
    const input = draftToInput(draft);
    try {
      if (tenant) {
        const body: Record<string, unknown> = { ...input, expected_version: tenant.version };
        // Người không có quyền xem CCCD: không gửi các trường nhạy cảm để tránh xóa dữ liệu không nhìn thấy.
        if (tenant.identity_masked) {
          if (!draft.identity_number) delete body.identity_number;
          delete body.issue_date;
          delete body.issue_place;
          delete body.permanent_address;
        }
        await update.mutateAsync(body as never);
        toast.success('Đã lưu thông tin người thuê.');
      } else {
        const created = await create.mutateAsync(input);
        toast.success(
          created.duplicate_identity.length
            ? `Đã thêm ${created.full_name}. Lưu ý: số CCCD trùng với ${created.duplicate_identity.map((d) => d.full_name).join(', ')} — hãy xác minh.`
            : `Đã thêm ${created.full_name}.`,
        );
      }
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(Object.fromEntries(Object.entries(e.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ''])));
      } else setError('Không lưu được.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <TenantFields prefix="tn" value={draft} onChange={setDraft} errors={fieldErrors} />
      {tenant?.identity_masked ? <p className="text-xs text-slate-500">Bạn không có quyền xem CCCD và địa chỉ thường trú; để trống thì giữ nguyên.</p> : null}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={() => void submit()} disabled={create.isPending || update.isPending}>
          Lưu
        </Button>
      </div>
    </div>
  );
}
