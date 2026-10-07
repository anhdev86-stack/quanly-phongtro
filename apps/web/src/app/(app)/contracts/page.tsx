'use client';

import { CONTRACT_STATUS_LABELS } from '@ql-tro/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { ContractAlertsCard } from '@/features/contracts/alerts';
import { useContracts } from '@/features/contracts/api';
import { ContractTable } from '@/features/contracts/contract-table';
import { useBuildings } from '@/features/property/api';

function ContractsContent() {
  const search = useSearchParams();
  const buildings = useBuildings();
  const expiring = search.get('expiring_within_days');
  const [filters, setFilters] = useState({
    building_id: '',
    status: '',
    expiring_within_days: expiring ? Number(expiring) : ('' as number | ''),
    page: 1,
    page_size: 30,
  });
  const list = useContracts(filters);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <>
      <PageHeader
        back={{ href: '/tenancies', label: 'Lần thuê' }}
        title="Hợp đồng"
        description="Tạo, ký, gia hạn hợp đồng ở trang chi tiết lần thuê. Hết hạn hợp đồng không kết thúc lần thuê — khách tiếp tục thuê theo tháng."
      />
      <ContractAlertsCard />
      <FilterBar>
        <Field id="cf-expiring" label="Sắp hết hạn" className="sm:w-48">
          <Select
            id="cf-expiring"
            value={String(filters.expiring_within_days)}
            onChange={(e) => set({ expiring_within_days: e.target.value ? Number(e.target.value) : '', status: '' })}
          >
            <option value="">Không lọc</option>
            <option value="7">Trong 7 ngày</option>
            <option value="30">Trong 30 ngày</option>
            <option value="60">Trong 60 ngày</option>
          </Select>
        </Field>
        <Field id="cf-status" label="Trạng thái" className="sm:w-48">
          <Select id="cf-status" value={filters.status} disabled={filters.expiring_within_days !== ''} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Tất cả</option>
            {Object.entries(CONTRACT_STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="cf-building" label="Tòa" className="sm:w-48">
          <Select id="cf-building" value={filters.building_id} onChange={(e) => set({ building_id: e.target.value })}>
            <option value="">Tất cả tòa</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <Card>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState title={filters.expiring_within_days !== '' ? 'Không có hợp đồng sắp hết hạn' : 'Chưa có hợp đồng'}>
            {filters.expiring_within_days !== '' ? 'Hợp đồng đã có kỳ gia hạn không nằm trong danh sách này.' : null}
          </EmptyState>
        ) : (
          <ContractTable items={list.data.items} showTenancy />
        )}
        {list.data ? (
          <div className="px-3 pb-3">
            <Pagination page={filters.page} pageSize={filters.page_size} total={list.data.total} onPage={(page) => set({ page })} />
          </div>
        ) : null}
      </Card>
      <p className="mt-3 text-sm text-slate-500">
        <Link href="/tenancies" className="text-brand-800 hover:underline">
          Về danh sách lần thuê
        </Link>
      </p>
    </>
  );
}

export default function ContractsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<LoadingState />}>
        <ContractsContent />
      </Suspense>
    </div>
  );
}
