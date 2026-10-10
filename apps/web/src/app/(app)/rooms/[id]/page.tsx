'use client';

import { PERMISSIONS } from '@ql-tro/shared';
import { Archive, CalendarPlus, DoorOpen, KeyRound, Pencil, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DescriptionList, PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useArchiveRoom, useReservations, useRoom, useSetRoomStatus } from '@/features/property/api';
import { RoomFormDialog } from '@/features/property/room-form';
import { ReasonDialog, ReservationCreateDialog } from '@/features/property/reservation-forms';
import { ReservationTable } from '@/features/property/reservation-table';
import { RoomStatusBadge } from '@/features/property/status';
import { MetersSection } from '@/features/utilities/meters-section';
import { ApiError } from '@/lib/api-client';
import { formatVnd } from '@/lib/format';

export default function RoomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();
  const room = useRoom(id);
  const reservations = useReservations({ room_id: id, page: 1, page_size: 50 });
  const setStatus = useSetRoomStatus(id);
  const archive = useArchiveRoom(id);
  const [editing, setEditing] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [maintenance, setMaintenance] = useState(false);

  if (room.isPending) return <LoadingState />;
  if (room.isError) return <ErrorState error={room.error} onRetry={() => void room.refetch()} />;
  const r = room.data;
  const canManage = can(PERMISSIONS.ROOMS_MANAGE);

  const markReady = async () => {
    try {
      await setStatus.mutateAsync({ status: 'READY', note: null, expected_version: r.version });
      toast.success(`Phòng ${r.code} đã sẵn sàng cho thuê.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không cập nhật được.');
    }
  };
  const doArchive = async () => {
    try {
      await archive.mutateAsync({ archive: !r.archived_at, expected_version: r.version });
      toast.success(r.archived_at ? 'Đã bỏ lưu trữ phòng.' : 'Đã lưu trữ phòng.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không thực hiện được.');
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        back={{ href: '/rooms', label: 'Danh sách phòng' }}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            Phòng {r.code}
            <RoomStatusBadge status={r.display_status} maintenance={r.maintenance_badge} />
          </span>
        }
        description={`${r.building_code} — ${r.building_name}${r.floor !== null ? ` · Tầng ${r.floor}` : ''}`}
        actions={
          <>
            {canManage ? (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden />
                  Sửa
                </Button>
                {r.operational_status === 'READY' ? (
                  <Button variant="outline" onClick={() => setMaintenance(true)}>
                    <Wrench className="size-4" aria-hidden />
                    Chuyển bảo trì
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => void markReady()} disabled={setStatus.isPending}>
                    <Wrench className="size-4" aria-hidden />
                    Sẵn sàng cho thuê
                  </Button>
                )}
              </>
            ) : null}
            {r.current_tenancy && can(PERMISSIONS.SETTLEMENT_MANAGE) ? (
              // Vào thẳng trang trả phòng của khách đang thuê, không phải qua trang lần thuê.
              <Link href={`/tenancies/${r.current_tenancy.id}/move-out`} className={buttonVariants()}>
                <DoorOpen className="size-4" aria-hidden />
                Trả phòng
              </Link>
            ) : null}
            {canManage ? (
              <Button variant="outline" onClick={() => void doArchive()} disabled={archive.isPending}>
                <Archive className="size-4" aria-hidden />
                {r.archived_at ? 'Bỏ lưu trữ' : 'Lưu trữ'}
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <CardTitle>Khách đang thuê</CardTitle>
          {!r.current_tenancy && !r.archived_at && r.operational_status === 'READY' && can(PERMISSIONS.TENANCIES_MOVE_IN) ? (
            <Link href={`/rooms/${r.id}/move-in`} className="inline-flex h-8 items-center gap-2 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
              <KeyRound className="size-4" aria-hidden />
              Nhận phòng
            </Link>
          ) : null}
        </CardHeader>
        <CardContent>
          {r.current_tenancy ? (
            <p className="text-sm">
              <Link href={`/tenancies/${r.current_tenancy.id}`} className="font-medium text-brand-800 hover:underline">
                {r.current_tenancy.code}
              </Link>{' '}
              · Đại diện: <strong>{r.current_tenancy.primary_tenant_name ?? '—'}</strong>
            </p>
          ) : (
            <p className="text-sm text-slate-500">Phòng chưa có khách.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thông tin phòng</CardTitle>
        </CardHeader>
        <CardContent>
          <DescriptionList
            items={[
              { label: 'Giá thuê mặc định', value: <span className="tabular">{formatVnd(r.default_rent_vnd)}</span> },
              { label: 'Số người tối đa', value: r.max_occupants },
              { label: 'Diện tích', value: r.area_m2 ? `${r.area_m2} m²` : null },
              { label: 'Tiện nghi', value: r.amenities.length ? r.amenities.join(', ') : null },
              { label: 'Bảo trì', value: r.operational_status === 'MAINTENANCE' ? r.maintenance_note || 'Đang bảo trì' : 'Không' },
              { label: 'Ghi chú', value: r.note },
            ]}
          />
        </CardContent>
      </Card>

      <MetersSection roomId={r.id} />

      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <CardTitle>Giữ phòng</CardTitle>
          {can(PERMISSIONS.RESERVATIONS_MANAGE) && !r.archived_at ? (
            <Button size="sm" onClick={() => setReserving(true)}>
              <CalendarPlus className="size-4" aria-hidden />
              Giữ phòng
            </Button>
          ) : null}
        </CardHeader>
        {reservations.isPending ? (
          <LoadingState />
        ) : reservations.isError ? (
          <ErrorState error={reservations.error} onRetry={() => void reservations.refetch()} />
        ) : reservations.data.items.length === 0 ? (
          <EmptyState title="Chưa có lượt giữ phòng" />
        ) : (
          <ReservationTable items={reservations.data.items} showRoom={false} />
        )}
      </Card>

      <RoomFormDialog open={editing} onClose={() => setEditing(false)} room={r} />
      <ReservationCreateDialog open={reserving} onClose={() => setReserving(false)} roomId={r.id} roomLabel={r.code} />
      <ReasonDialog
        open={maintenance}
        title={`Chuyển phòng ${r.code} sang bảo trì`}
        description="Phòng bảo trì không nhận khách mới. Khách đang ở (nếu có) không bị ảnh hưởng."
        confirmLabel="Chuyển bảo trì"
        pending={setStatus.isPending}
        onClose={() => setMaintenance(false)}
        onConfirm={async (note) => {
          try {
            await setStatus.mutateAsync({ status: 'MAINTENANCE', note, expected_version: r.version });
            toast.success(`Phòng ${r.code} đang bảo trì.`);
            setMaintenance(false);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không cập nhật được.');
          }
        }}
      />
    </div>
  );
}
