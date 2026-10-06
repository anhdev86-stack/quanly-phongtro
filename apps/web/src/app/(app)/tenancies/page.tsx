'use client';

import { TENANCY_STATUS_LABELS } from '@ql-tro/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { useBuildings } from '@/features/property/api';
import { useTenancies } from '@/features/tenancy/api';
import { TenancyTable } from '@/features/tenancy/tenancy-table';

function TenanciesContent() {
  const search = useSearchParams();
  const buildings = useBuildings();
  const [filters, setFilters] = useState({
    status: 'OPEN',
    building_id: '',
    room_id: search.get('room_id') ?? '',
    q: '',
    page: 1,
    page_size: 30,
  });
  const list = useTenancies(filters);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <>
      <PageHeader
        title="Lần thuê"
        description="Nhận phòng từ trang chi tiết phòng. Hết hạn hợp đồng không kết thúc lần thuê; chỉ trả phòng mới kết thúc."
        actions={
          <div className="flex gap-2">
            <Link href="/contracts?expiring_within_days=30" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Hợp đồng sắp hết hạn
            </Link>
            <Link href="/contracts" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Tất cả hợp đồng
            </Link>
          </div>
        }
      />
      <FilterBar>
        <Field id="tf-status" label="Trạng thái" className="sm:w-48">
          <Select id="tf-status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="OPEN">Đang thuê (chưa kết thúc)</option>
            {Object.entries(TENANCY_STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
            <option value="">Tất cả</option>
          </Select>
        </Field>
        <Field id="tf-building" label="Tòa" className="sm:w-48">
          <Select id="tf-building" value={filters.building_id} onChange={(e) => set({ building_id: e.target.value })}>
            <option value="">Tất cả tòa</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="tf-q" label="Tìm mã, phòng, tên khách" className="sm:w-64">
          <TextInput id="tf-q" type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        </Field>
      </FilterBar>
      <Card>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Không có lần thuê phù hợp" />
        ) : (
          <TenancyTable items={list.data.items} />
        )}
        {list.data ? (
          <div className="px-3 pb-3">
            <Pagination page={filters.page} pageSize={filters.page_size} total={list.data.total} onPage={(page) => set({ page })} />
          </div>
        ) : null}
      </Card>
    </>
  );
}

export default function TenanciesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<LoadingState />}>
        <TenanciesContent />
      </Suspense>
    </div>
  );
}
