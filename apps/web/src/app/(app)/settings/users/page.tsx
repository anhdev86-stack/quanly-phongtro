'use client';

import { ROLE_LABELS, type UserDto } from '@ql-tro/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useMe } from '@/features/auth/api';
import { useUsers } from '@/features/users/api';
import { PermissionsDialog } from '@/features/users/permissions-dialog';
import { UserCreateDialog, UserEditDialog } from '@/features/users/user-dialogs';

export default function UsersPage() {
  const users = useUsers();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [perms, setPerms] = useState<UserDto | null>(null);
  const me = useMe();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        back={{ href: '/settings', label: 'Cấu hình' }}
        title="Người dùng & phân quyền"
        description="Hai vai trò: Chủ trọ (mọi tòa, mọi quyền) và Quản lý (trong tòa được giao). Cần khác mặc định thì bấm “Quyền” để cấp thêm hoặc thu hồi quyền cho từng người."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            Thêm tài khoản
          </Button>
        }
      />
      <Card>
        {users.isPending ? (
          <LoadingState />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tên</Th>
                <Th>Email</Th>
                <Th>Vai trò</Th>
                <Th className="hidden sm:table-cell">Tòa được giao</Th>
                <Th>Trạng thái</Th>
                <Th className="text-right">
                  <span className="sr-only">Quyền</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <Tr key={u.id} className="cursor-pointer" onClick={() => setEditing(u)}>
                  <Td className="font-medium">
                    <button type="button" className="text-left font-medium text-brand-600 hover:underline" onClick={() => setEditing(u)}>
                      {u.display_name}
                    </button>
                  </Td>
                  <Td className="text-slate-600">{u.email}</Td>
                  <Td>
                    {u.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}
                    {u.permission_overrides.length ? <div className="text-xs text-amber-700">{u.permission_overrides.length} quyền riêng</div> : null}
                  </Td>
                  <Td className="hidden text-slate-600 sm:table-cell">
                    {u.roles.includes('OWNER') ? 'Mọi tòa' : u.buildings.map((b) => b.code).join(', ') || 'Chưa giao'}
                  </Td>
                  <Td>{u.is_active ? <Badge tone="green">Hoạt động</Badge> : <Badge tone="gray">Đã khóa</Badge>}</Td>
                  <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {!u.roles.includes('OWNER') && u.id !== me.data?.id ? (
                      <Button variant="outline" size="sm" onClick={() => setPerms(u)}>
                        Quyền
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <UserCreateDialog open={creating} onClose={() => setCreating(false)} />
      <UserEditDialog user={editing} onClose={() => setEditing(null)} />
      <PermissionsDialog user={perms} onClose={() => setPerms(null)} />
    </div>
  );
}
