'use client';

import { ASSIGNABLE_ROLES, ROLE_LABELS, type UserDto } from '@ql-tro/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Select, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useBuildings } from '@/features/property/api';
import { ApiError } from '@/lib/api-client';
import { useCreateUser, useResetPassword, useSetUserScopes, useUpdateUser } from './api';

/** Vai trò gán được: Chủ trọ, Quản lý (D-041). Tài khoản mang vai trò cũ vẫn hiện vai trò đó (không chọn lại được). */
export const ROLE_OPTIONS = ASSIGNABLE_ROLES;

function BuildingChecklist({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const buildings = useBuildings();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-slate-700">Tòa được giao</legend>
      {buildings.data?.map((b) => (
        <label key={b.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={value.includes(b.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, b.id] : value.filter((x) => x !== b.id))}
          />
          {b.code} — {b.name}
        </label>
      ))}
    </fieldset>
  );
}

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Đã có lỗi xảy ra.');

function RoleSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {!(ROLE_OPTIONS as readonly string[]).includes(value) ? (
        <option value={value} disabled>
          {ROLE_LABELS[value] ?? value}
        </option>
      ) : null}
      {ROLE_OPTIONS.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </Select>
  );
}

export function UserCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onClose={onClose} title="Thêm tài khoản">{open ? <UserCreateForm onClose={onClose} /> : null}</Dialog>;
}

function UserCreateForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const create = useCreateUser();
  const [v, setV] = useState({ email: '', display_name: '', password: '', role: 'MANAGER', building_ids: [] as string[] });
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    try {
      await create.mutateAsync(v);
      toast.success(`Đã tạo tài khoản ${v.email}.`);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Field id="u-email" label="Email đăng nhập" required>
        <TextInput id="u-email" type="email" autoComplete="off" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      </Field>
      <Field id="u-name" label="Tên hiển thị" required>
        <TextInput id="u-name" value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} />
      </Field>
      <Field id="u-pass" label="Mật khẩu ban đầu" required hint="Tối thiểu 8 ký tự.">
        <TextInput id="u-pass" type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
      </Field>
      <Field id="u-role" label="Vai trò" required>
        <RoleSelect id="u-role" value={v.role} onChange={(role) => setV({ ...v, role })} />
      </Field>
      {v.role !== 'OWNER' ? <BuildingChecklist value={v.building_ids} onChange={(building_ids) => setV({ ...v, building_ids })} /> : null}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={() => void submit()} disabled={create.isPending}>
          Tạo
        </Button>
      </div>
    </div>
  );
}

export function UserEditDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  return (
    <Dialog open={!!user} onClose={onClose} title={user ? `Tài khoản ${user.email}` : ''}>
      {user ? <UserEditForm key={`${user.id}:${user.version}`} user={user} onClose={onClose} /> : null}
    </Dialog>
  );
}

function UserEditForm({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateUser();
  const scopes = useSetUserScopes();
  const reset = useResetPassword();
  const [name, setName] = useState(user.display_name);
  const [role, setRole] = useState(user.roles[0] ?? 'MANAGER');
  const [buildingIds, setBuildingIds] = useState(user.buildings.map((b) => b.id));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const pending = update.isPending || scopes.isPending || reset.isPending;

  const save = async () => {
    setError('');
    try {
      let version = user.version;
      if (name !== user.display_name || role !== (user.roles[0] ?? '')) {
        version = (await update.mutateAsync({ id: user.id, display_name: name, role, expected_version: version })).version;
      }
      const current = user.buildings.map((b) => b.id).sort().join();
      if (role !== 'OWNER' && [...buildingIds].sort().join() !== current) {
        version = (await scopes.mutateAsync({ id: user.id, building_ids: buildingIds, expected_version: version })).version;
      }
      if (password) await reset.mutateAsync({ id: user.id, new_password: password, expected_version: version });
      toast.success('Đã lưu tài khoản.');
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const toggleActive = async () => {
    setError('');
    try {
      await update.mutateAsync({ id: user.id, is_active: !user.is_active, expected_version: user.version });
      toast.success(user.is_active ? 'Đã vô hiệu hóa tài khoản và thu hồi phiên đăng nhập.' : 'Đã kích hoạt lại tài khoản.');
      onClose();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Field id="ue-name" label="Tên hiển thị" required>
        <TextInput id="ue-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="ue-role" label="Vai trò">
        <RoleSelect id="ue-role" value={role} onChange={setRole} />
      </Field>
      {role !== 'OWNER' ? <BuildingChecklist value={buildingIds} onChange={setBuildingIds} /> : null}
      <Field id="ue-pass" label="Đặt lại mật khẩu" hint="Để trống nếu không đổi. Đặt lại sẽ đăng xuất người dùng khỏi mọi thiết bị.">
        <TextInput id="ue-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="outline" onClick={() => void toggleActive()} disabled={pending} className={user.is_active ? 'text-red-700' : ''}>
          {user.is_active ? 'Vô hiệu hóa' : 'Kích hoạt lại'}
        </Button>
        <Button onClick={() => void save()} disabled={pending}>
          Lưu
        </Button>
      </div>
    </div>
  );
}
