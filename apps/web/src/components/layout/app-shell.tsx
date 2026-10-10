'use client';

import { type MeResponse, ROLE_LABELS } from '@ql-tro/shared';
import { Building2, LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/api';
import { cn } from '@/lib/utils';
import { CURRENT_PHASE, NAV_GROUP_LABELS, NAV_ITEMS, type NavGroup } from './nav-items';

/**
 * Khung ứng dụng — Dark Sidebar + Light Content.
 * Sidebar: ≥1024px đầy đủ 256px; 768–1023px thu gọn thành cột biểu tượng 72px; <768px ẩn, mở dạng ngăn kéo từ nút menu.
 * Header: trắng, cao 64px, chỉ có thông tin tài khoản gọn bên phải (và nút menu trên điện thoại).
 */
export function AppShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const [open, setOpen] = useState(false);

  const onLogout = () => logout.mutate(undefined, { onSettled: () => router.replace('/login') });
  const items = NAV_ITEMS.filter((item) => !item.anyPermission || item.anyPermission.some((p) => me.permissions.includes(p)));
  const groups = [...new Set(items.map((i) => i.group))] as NavGroup[];
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href) || (href === '/rooms' && pathname.startsWith('/buildings')));

  /** `compact`: chỉ biểu tượng (máy tính bảng); tên mục nằm ở aria-label và tooltip. */
  const nav = (compact: boolean) => (
    <nav aria-label="Điều hướng chính" className={cn('flex flex-col gap-4 py-4', compact ? 'px-2' : 'px-3')}>
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1">
          {NAV_GROUP_LABELS[g] ? (
            compact ? (
              <div className="mx-auto my-1 h-px w-6 bg-white/10" aria-hidden />
            ) : (
              <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{NAV_GROUP_LABELS[g]}</p>
            )
          ) : null}
          {items
            .filter((i) => i.group === g)
            .map((item) => {
              const Icon = item.icon;
              const available = item.availableFromPhase <= CURRENT_PHASE;
              const active = available && isActive(item.href);
              if (!available) {
                return (
                  <span
                    key={item.href}
                    aria-disabled="true"
                    title={`Sẽ có ở Phase ${phaseLabel(item.availableFromPhase)}`}
                    className={cn('flex h-10 cursor-not-allowed items-center gap-3 rounded-lg text-sm text-slate-600', compact ? 'justify-center' : 'px-3')}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
                    {compact ? null : <span className="flex-1">{item.label}</span>}
                  </span>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={compact ? item.label : undefined}
                  title={compact ? item.label : undefined}
                  className={cn(
                    'relative flex h-10 items-center gap-3 rounded-lg text-sm font-medium transition-colors',
                    compact ? 'justify-center' : 'px-3',
                    active ? 'bg-sidebar-active text-white' : 'text-sidebar-text hover:bg-white/5 hover:text-white',
                  )}
                >
                  {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-400" aria-hidden /> : null}
                  <Icon className={cn('size-[18px] shrink-0', active ? 'text-brand-400' : 'text-slate-400')} aria-hidden />
                  {compact ? null : <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-full">
      {/* Máy tính: đầy đủ; máy tính bảng: thu gọn. Cố định khi cuộn trang. */}
      <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col overflow-y-auto bg-sidebar md:flex lg:w-64">
        <div className="lg:hidden">
          <Brand compact />
        </div>
        <div className="hidden lg:block">
          <Brand />
        </div>
        <div className="lg:hidden">{nav(true)}</div>
        <div className="hidden lg:block">{nav(false)}</div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Lớp nền chỉ để bấm ra ngoài; ẩn khỏi trình đọc màn hình (đã có nút X "Đóng menu"). */}
          <button className="absolute inset-0 bg-slate-900/50" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
          <aside className="relative h-full w-72 overflow-y-auto bg-sidebar shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pr-2">
              <Brand bordered={false} />
              <Button variant="ghost" size="sm" className="text-slate-300 hover:bg-white/5 hover:text-white" aria-label="Đóng menu" onClick={() => setOpen(false)}>
                <X className="size-5" />
              </Button>
            </div>
            {nav(false)}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="sm" className="md:hidden" aria-label="Mở menu" onClick={() => setOpen(true)}>
              <Menu className="size-5" />
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 rounded-lg py-1 pr-1 pl-1">
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 ring-1 ring-brand-100">
                {initials(me.display_name)}
              </span>
              <div className="hidden leading-tight sm:block">
                <p className="text-sm font-semibold text-heading" data-testid="current-user">
                  {me.display_name}
                </p>
                <p className="text-xs text-muted">{me.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</p>
              </div>
            </div>
            <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />
            <Button variant="ghost" size="sm" onClick={onLogout} disabled={logout.isPending} className="text-muted hover:text-heading">
              <LogOut className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Đăng xuất</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function Brand({ compact = false, bordered = true }: { compact?: boolean; bordered?: boolean }) {
  return (
    <div className={cn('flex h-16 shrink-0 items-center gap-3', bordered && 'border-b border-white/10', compact ? 'justify-center' : 'px-5')}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-500 text-brand-950">
        <Building2 className="size-5" aria-hidden />
      </span>
      {compact ? null : (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold text-white">Quản lý nhà trọ</span>
          <span className="block text-xs text-slate-400">Bảng điều khiển</span>
        </span>
      )}
    </div>
  );
}

/** "Chủ trọ Demo" → "CD": chữ cái đầu của từ đầu và từ cuối, làm ảnh đại diện. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** 8.5 là Phase 8B (MASTER_PLAN 16). */
const phaseLabel = (p: number) => (p === 8.5 ? '8B' : String(p));
