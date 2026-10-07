'use client';

import { OWNER_ONLY_PERMISSIONS, PERMISSION_GROUPS, type PermissionCode, ROLE_LABELS, type UserDto } from '@ql-tro/shared';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useRoles, useSetPermissionOverrides } from './api';

type Mode = 'role' | 'grant' | 'revoke';

/**
 * Quyền riêng theo người dùng (V1.1): mỗi quyền theo vai trò, cấp thêm, hoặc thu hồi. Backend chặn tự sửa quyền của mình
 * và chặn cấp quyền chỉ chủ trọ có; giao diện chỉ phản ánh lại các quy tắc đó.
 */
export function PermissionsDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  return user ? <PermissionsEditor key={`${user.id}:${user.version}`} user={user} onClose={onClose} /> : null;
}

function PermissionsEditor({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const toast = useToast();
  const roles = useRoles();
  const save = useSetPermissionOverrides();
  const [modes, setModes] = useState<Record<string, Mode>>(() =>
    Object.fromEntries(user.permission_overrides.map((o) => [o.permission, o.granted ? 'grant' : 'revoke'])),
  );
  const [error, setError] = useState('');
  const rolePerms = useMemo(() => new Set(roles.data?.filter((r) => user.roles.includes(r.code)).flatMap((r) => r.permissions) ?? []), [roles.data, user.roles]);

  const submit = async () => {
    setError('');
    const overrides = Object.entries(modes)
      .filter(([, m]) => m !== 'role')
      .map(([permission, m]) => ({ permission, granted: m === 'grant' }));
    try {
      await save.mutateAsync({ id: user.id, overrides, expected_version: user.version });
      toast.success('Đã lưu quyền riêng.');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không lưu được.');
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`Quyền của ${user.display_name}`}
      description="Quyền hiệu lực = quyền của vai trò, cộng quyền cấp thêm, trừ quyền thu hồi. Có hiệu lực ngay."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending || roles.isPending}>
            Lưu quyền
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          Vai trò: <strong>{user.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</strong> · Tòa: {user.buildings.map((b) => b.code).join(', ') || 'chưa giao'}
        </p>
        <FormError message={error} />
        <div>
          {PERMISSION_GROUPS.map((g) => (
            <fieldset key={g.label} className="mb-4">
              <legend className="mb-2 text-sm font-semibold text-slate-800">{g.label}</legend>
              <ul className="flex flex-col divide-y divide-slate-100">
                {g.permissions.map(([code, label]) => {
                  const byRole = rolePerms.has(code);
                  const mode = modes[code] ?? 'role';
                  const ownerOnly = OWNER_ONLY_PERMISSIONS.includes(code as PermissionCode);
                  const effective = mode === 'grant' ? true : mode === 'revoke' ? false : byRole;
                  return (
                    <li key={code} className="flex flex-col gap-1 py-1.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-2" data-testid={`perm-${code}`}>
                      <span className="min-w-0">
                        {label}
                        <span className="ml-1 hidden text-xs text-slate-400 sm:inline">{code}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {effective ? <Badge tone="green">Có</Badge> : <Badge tone="gray">Không</Badge>}
                        <Select
                          aria-label={`Quyền ${label}`}
                          className="w-44 max-w-full"
                          value={mode}
                          disabled={ownerOnly && !byRole}
                          onChange={(e) => setModes({ ...modes, [code]: e.target.value as Mode })}
                        >
                          <option value="role">Theo vai trò ({byRole ? 'có' : 'không'})</option>
                          {!byRole && !ownerOnly ? <option value="grant">Cấp thêm</option> : null}
                          {byRole ? <option value="revoke">Thu hồi</option> : null}
                        </Select>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>
        <p className="text-xs text-slate-500">Quyền “Xem mọi tòa”, “Người dùng và phân quyền”, “Toàn bộ nhật ký” chỉ dành cho chủ trọ, không cấp riêng.</p>
      </div>
    </Dialog>
  );
}
