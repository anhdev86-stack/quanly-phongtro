'use client';

import { PERMISSIONS, ROOM_DISPLAY_STATUSES, ROOM_STATUS_LABELS } from '@ql-tro/shared';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { useCan } from '@/features/auth/permissions';
import { useBuildings, useRooms } from '@/features/property/api';
import { RoomGrid, RoomTable } from '@/features/property/room-list';
import { PropertyTabs } from '@/features/property/property-tabs';
import { RoomFormDialog } from '@/features/property/room-form';

function RoomsContent() {
  const can = useCan();
  const search = useSearchParams();
  const buildings = useBuildings();
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({ building_id: search.get('building_id') ?? '', status: search.get('status') ?? '', floor: '', q: '', page: 1, page_size: 60 });
  const rooms = useRooms(filters);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <div className="mx-auto max-w-7xl">
      <PropertyTabs active="rooms" />
      <PageHeader
        title="Phòng"
        description="Trạng thái phòng được tính từ khách đang thuê, bảo trì và lịch giữ phòng."
        actions={
          <>
            {can(PERMISSIONS.ROOMS_MANAGE) ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                Thêm phòng
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <Field id="f-building" label="Tòa" className="sm:w-56">
          <Select id="f-building" value={filters.building_id} onChange={(e) => set({ building_id: e.target.value })}>
            <option value="">Tất cả tòa</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-status" label="Trạng thái" className="sm:w-40">
          <Select id="f-status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Tất cả</option>
            {ROOM_DISPLAY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ROOM_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-floor" label="Tầng" className="sm:w-24">
          <TextInput id="f-floor" inputMode="numeric" value={filters.floor} onChange={(e) => set({ floor: e.target.value.replace(/[^\d-]/g, '') })} />
        </Field>
        <Field id="f-q" label="Tìm mã phòng / tên khách" className="sm:w-64">
          <TextInput id="f-q" type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        </Field>
        <div className="flex gap-1 sm:ml-auto" role="group" aria-label="Kiểu hiển thị">
          <Button variant={view === 'grid' ? 'default' : 'outline'} size="sm" onClick={() => setView('grid')} aria-pressed={view === 'grid'} aria-label="Dạng lưới">
            <LayoutGrid className="size-4" />
          </Button>
          <Button variant={view === 'table' ? 'default' : 'outline'} size="sm" onClick={() => setView('table')} aria-pressed={view === 'table'} aria-label="Dạng bảng">
            <List className="size-4" />
          </Button>
        </div>
      </FilterBar>

      <Card>
        {rooms.isPending ? (
          <LoadingState />
        ) : rooms.isError ? (
          <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />
        ) : rooms.data.items.length === 0 ? (
          <EmptyState title="Không có phòng phù hợp" />
        ) : view === 'grid' ? (
          <RoomGrid rooms={rooms.data.items} />
        ) : (
          <RoomTable rooms={rooms.data.items} />
        )}
        {rooms.data ? (
          <div className="px-3 pb-3">
            <Pagination page={filters.page} pageSize={filters.page_size} total={rooms.data.total} onPage={(page) => set({ page })} />
          </div>
        ) : null}
      </Card>
      <RoomFormDialog open={creating} onClose={() => setCreating(false)} defaultBuildingId={filters.building_id || undefined} />
    </div>
  );
}

export default function RoomsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RoomsContent />
    </Suspense>
  );
}
