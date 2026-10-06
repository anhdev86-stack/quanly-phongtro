'use client';

import { PERMISSIONS } from '@ql-tro/shared';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/common/page';
import { Card, CardContent } from '@/components/ui/card';
import { useCan } from '@/features/auth/permissions';
import { SETTINGS_SECTIONS } from '@/features/settings/sections';

export default function SettingsPage() {
  const can = useCan();
  const sections = [
    { href: '/settings/users', title: 'Người dùng & phân quyền', description: 'Tài khoản, vai trò, tòa được giao.', icon: Users, perm: PERMISSIONS.USERS_MANAGE },
    ...SETTINGS_SECTIONS,
  ].filter((s) => can(s.perm));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Cấu hình" />
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="h-full hover:border-brand-600">
              <CardContent className="flex gap-3">
                <s.icon className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-slate-500">{s.description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {sections.length === 0 ? <p className="text-sm text-slate-500">Bạn không có quyền cấu hình.</p> : null}
      </div>
    </div>
  );
}
