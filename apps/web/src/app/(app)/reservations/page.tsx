'use client';

import { RESERVATION_DISPLAY_STATUSES, RESERVATION_STATUS_LABELS } from '@ql-tro/shared';
import { useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { useBuildings, useReservations } from '@/features/property/api';
import { ReservationTable } from '@/features/property/reservation-table';

export default function ReservationsPage() {
  const buildings = useBuildings();
  const [filters, setFilters] = useState({ building_id: '', status: 'ACTIVE', page: 1, page_size: 30 });
  const list = useReservations(filters);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Giữ phòng" description="Tạo lượt giữ phòng từ trang chi tiết phòng. Lịch giữ của cùng một phòng không được chồng nhau." />
      <FilterBar>
        <Field id="rf-building" label="Tòa" className="sm:w-48">
          <Select id="rf-building" value={filters.building_id} onChange={(e) => set({ building_id: e.target.value })}>
            <option value="">Tất cả tòa</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="rf-status" label="Trạng thái" className="sm:w-44">
          <Select id="rf-status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Tất cả</option>
            {RESERVATION_DISPLAY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RESERVATION_STATUS_LABELS[s]}
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
          <EmptyState title="Không có lượt giữ phòng" />
        ) : (
          <ReservationTable items={list.data.items} />
        )}
        {list.data ? (
          <div className="px-3 pb-3">
            <Pagination page={filters.page} pageSize={filters.page_size} total={list.data.total} onPage={(page) => set({ page })} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
