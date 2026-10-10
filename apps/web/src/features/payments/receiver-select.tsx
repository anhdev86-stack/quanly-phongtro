'use client';

import { Field, Select } from '@/components/ui/form';
import { useMe } from '@/features/auth/api';
import { usePaymentReceivers } from './api';

/**
 * “Người nhận tiền” khi ghi nhận thu (D-045): chủ trọ hoặc quản lý có quyền thu tiền ở tòa của phòng. Giá trị rỗng = người đang
 * đăng nhập (mặc định). Tiền mặt: người cầm tiền; chuyển khoản: người quản lý tài khoản nhận.
 */
export function ReceiverSelect({ id, tenancyId, value, onChange, error }: { id: string; tenancyId: string; value: string; onChange: (v: string) => void; error?: string }) {
  const me = useMe();
  const receivers = usePaymentReceivers(tenancyId);
  const myId = me.data?.id ?? '';
  const selected = value || myId;
  const options = receivers.data ?? (me.data ? [{ id: me.data.id, display_name: me.data.display_name }] : []);
  return (
    <Field id={id} label="Người nhận tiền" required error={error} hint="Người cầm tiền mặt hoặc quản lý tài khoản nhận chuyển khoản.">
      <Select id={id} value={selected} onChange={(e) => onChange(e.target.value === myId ? '' : e.target.value)}>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.display_name}
            {r.id === myId ? ' (tôi)' : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
}
