'use client';

import { Building2, DoorOpen } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Chuyển qua lại giữa danh sách Phòng và Tòa/khu (cùng mục “Tòa/khu & Phòng” ở menu). */
export function PropertyTabs({ active }: { active: 'rooms' | 'buildings' }) {
  const tabs = [
    { key: 'rooms', href: '/rooms', label: 'Phòng', icon: DoorOpen },
    { key: 'buildings', href: '/buildings', label: 'Tòa/khu', icon: Building2 },
  ] as const;
  return (
    <nav aria-label="Tòa/khu và phòng" className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? 'page' : undefined}
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium',
            active === t.key ? 'bg-brand-200 text-brand-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          )}
        >
          <t.icon className="size-4" aria-hidden />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
