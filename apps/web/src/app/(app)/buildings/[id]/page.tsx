'use client';

import { PERMISSIONS } from '@ql-tro/shared';
import { DoorOpen, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DescriptionList, PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCan } from '@/features/auth/permissions';
import { useBuilding, useRooms } from '@/features/property/api';
import { BuildingFormDialog } from '@/features/property/building-form';
import { RoomGrid } from '@/features/property/room-list';
import { RoomFormDialog } from '@/features/property/room-form';
import { BuildingExtraSections } from '@/features/property/building-extra-sections';

export default function BuildingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const building = useBuilding(id);
  const rooms = useRooms({ building_id: id, page: 1, page_size: 100 });
  const [editing, setEditing] = useState(false);
  const [addingRoom, setAddingRoom] = useState(false);

  if (building.isPending) return <LoadingState />;
  if (building.isError) return <ErrorState error={building.error} onRetry={() => void building.refetch()} />;
  const b = building.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        back={{ href: '/buildings', label: 'Tòa/khu' }}
        title={
          <span className="inline-flex items-center gap-2">
            Tòa {b.code} — {b.name}
            {b.archived_at ? <Badge>Đã lưu trữ</Badge> : null}
          </span>
        }
        actions={
          <>
            <Link href={`/rooms?building_id=${b.id}`} className={buttonVariants({ variant: 'outline' })}>
              <DoorOpen className="size-4" aria-hidden />
              Xem phòng của tòa
            </Link>
            {can(PERMISSIONS.BUILDINGS_MANAGE) ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                Sửa
              </Button>
            ) : null}
          </>
        }
      />
      <Card>
        <CardContent>
          <DescriptionList
            items={[
              { label: 'Địa chỉ', value: b.address },
              {
                label: 'Quản lý phụ trách',
                value: (
                  <span data-testid="building-managers">
                    {b.managers.length ? b.managers.map((m) => m.display_name).join(', ') : 'Chưa giao quản lý — chủ trọ phụ trách'}
                    {can(PERMISSIONS.USERS_MANAGE) ? (
                      <>
                        {' · '}
                        <Link href="/settings/users" className="text-brand-800 hover:underline">
                          Giao quản lý
                        </Link>
                      </>
                    ) : null}
                  </span>
                ),
              },
              { label: 'Số tầng', value: b.floors },
              { label: 'Liên hệ', value: [b.contact_name, b.contact_phone].filter(Boolean).join(' · ') || null },
              { label: 'Ghi chú', value: b.note },
            ]}
          />
        </CardContent>
      </Card>

      <BuildingExtraSections building={b} />

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Phòng ({rooms.data?.total ?? '…'})</CardTitle>
          {can(PERMISSIONS.ROOMS_MANAGE) && !b.archived_at ? (
            <Button size="sm" onClick={() => setAddingRoom(true)}>
              <Plus className="size-4" aria-hidden />
              Thêm phòng
            </Button>
          ) : null}
        </CardHeader>
        {rooms.isPending ? (
          <LoadingState />
        ) : rooms.isError ? (
          <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />
        ) : rooms.data.items.length === 0 ? (
          <EmptyState title="Tòa chưa có phòng" />
        ) : (
          <RoomGrid rooms={rooms.data.items} />
        )}
      </Card>
      <BuildingFormDialog open={editing} onClose={() => setEditing(false)} building={b} />
      <RoomFormDialog open={addingRoom} onClose={() => setAddingRoom(false)} defaultBuildingId={b.id} />
    </div>
  );
}
