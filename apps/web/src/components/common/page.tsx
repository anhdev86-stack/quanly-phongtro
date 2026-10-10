'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-heading md:text-[26px]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-3 text-sm text-slate-500">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2">
          {page}/{pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function DescriptionList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-slate-900">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Thanh lọc gọn trên điện thoại, dàn hàng trên desktop. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">{children}</div>;
}
