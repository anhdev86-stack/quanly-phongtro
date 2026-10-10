'use client';

import { type MeResponse, ROLE_LABELS } from '@ql-tro/shared';
import { Building2, LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/api';
import { cn } from '@/lib/utils';
import { CURRENT_PHASE, NAV_ITEMS } from './nav-items';


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
              title={`Sẽ có ở Phase ${phaseLabel(item.availableFromPhase)}`}
              className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-700/50"
            >
              <Icon className="size-4" aria-hidden />
              <span className="flex-1">{item.label}</span>
              <span className="rounded bg-white/40 px-1.5 text-[10px] font-medium">P{phaseLabel(item.availableFromPhase)}</span>
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
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-cream text-brand-900 shadow-sm' : 'text-brand-900 hover:bg-white/45',
            )}
          >
            <Icon className={cn('size-4', active ? 'text-brand-700' : 'text-brand-600')} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-64 shrink-0 bg-gradient-to-b from-brand-200 to-brand-300 lg:block">
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
          <aside className="relative h-full w-72 overflow-y-auto bg-gradient-to-b from-brand-200 to-brand-300 shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <Button variant="ghost" size="sm" className="text-brand-900 hover:bg-white/45" aria-label="Đóng menu" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Mở menu" onClick={() => setOpen(true)}>
              <Menu className="size-5" />
            </Button>
            <span className="truncate text-sm font-medium text-brand-800">{me.workspace.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight" data-testid="current-user">
                {me.display_name}
              </p>
              <p className="text-xs text-slate-500">{me.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</p>
            </div>
            <span
              aria-hidden
              className="hidden size-9 items-center justify-center rounded-full bg-brand-200 text-sm font-semibold text-brand-900 ring-2 ring-white shadow-sm sm:flex"
            >
              {initials(me.display_name)}
            </span>
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
    <div className="flex h-14 items-center gap-2 border-b border-brand-300/70 px-4">
      <span className="flex size-8 items-center justify-center rounded-lg bg-white text-brand-700 shadow-sm">
        <Building2 className="size-4" aria-hidden />
      </span>
      <span className="font-semibold text-brand-900">Quản lý nhà trọ</span>
    </div>
  );
}

/** "Chủ trọ Demo" → "CD": chữ cái đầu của hai từ cuối, làm ảnh đại diện. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(-2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

/** 8.5 là Phase 8B (MASTER_PLAN 16). */
const phaseLabel = (p: number) => (p === 8.5 ? '8B' : String(p));
