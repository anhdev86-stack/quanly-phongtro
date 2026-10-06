'use client';

import type { MeResponse } from '@ql-tro/shared';
import { Building2, LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/api';
import { cn } from '@/lib/utils';
import { CURRENT_PHASE, NAV_ITEMS } from './nav-items';

const ROLE_LABELS: Record<string, string> = { OWNER: 'Chủ trọ', STAFF: 'Nhân viên' };

export function AppShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const [open, setOpen] = useState(false);

  const onLogout = () => logout.mutate(undefined, { onSettled: () => router.replace('/login') });

  const nav = (
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-0.5 p-3">
      {NAV_ITEMS.filter((item) => !item.anyPermission || item.anyPermission.some((p) => me.permissions.includes(p))).map((item) => {
        const Icon = item.icon;
        const available = item.availableFromPhase <= CURRENT_PHASE;
        const active =
          available &&
          (item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href) || (item.href === '/rooms' && pathname.startsWith('/buildings')));
        if (!available) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              title={`Sẽ có ở Phase ${item.availableFromPhase}`}
              className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-400"
            >
              <Icon className="size-4" aria-hidden />
              <span className="flex-1">{item.label}</span>
              <span className="rounded bg-slate-100 px-1.5 text-[10px] font-medium text-slate-400">P{item.availableFromPhase}</span>
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
              active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <Brand />
        {nav}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Lớp nền chỉ để bấm ra ngoài; ẩn khỏi trình đọc màn hình (đã có nút X "Đóng menu"). */}
          <button
            className="absolute inset-0 bg-slate-900/40"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <aside className="relative h-full w-72 bg-white shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <Button variant="ghost" size="sm" aria-label="Đóng menu" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Mở menu" onClick={() => setOpen(true)}>
              <Menu className="size-5" />
            </Button>
            <span className="truncate text-sm text-slate-500">{me.workspace.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight" data-testid="current-user">
                {me.display_name}
              </p>
              <p className="text-xs text-slate-500">{me.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onLogout} disabled={logout.isPending}>
              <LogOut className="size-4" aria-hidden />
              Đăng xuất
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-4">
      <span className="flex size-8 items-center justify-center rounded-md bg-brand-600 text-white">
        <Building2 className="size-4" aria-hidden />
      </span>
      <span className="font-semibold">Quản lý nhà trọ</span>
    </div>
  );
}
