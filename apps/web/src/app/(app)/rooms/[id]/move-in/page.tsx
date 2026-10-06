'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { useRoom } from '@/features/property/api';
import { MoveInWizard } from '@/features/tenancy/move-in-wizard';

function MoveInContent() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const reservationId = search.get('reservation');
  const room = useRoom(id);
  if (room.isPending) return <LoadingState />;
  if (room.isError) return <ErrorState error={room.error} onRetry={() => void room.refetch()} />;
  const r = room.data;
  return (
    <>
      <PageHeader
        back={{ href: `/rooms/${r.id}`, label: `Phòng ${r.code}` }}
        title={`Nhận phòng ${r.code}`}
        description={reservationId ? 'Nhận phòng từ lượt giữ chỗ; tiền giữ chỗ (nếu có) được chuyển thành cọc.' : `${r.building_code} — ${r.building_name}`}
      />
      {r.display_status === 'OCCUPIED' ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Phòng đang có khách thuê, không nhận khách mới được.</p>
      ) : r.operational_status === 'MAINTENANCE' ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Phòng đang bảo trì. Hãy chuyển sang “Sẵn sàng cho thuê” trước.</p>
      ) : (
        <MoveInWizard room={r} reservationId={reservationId} />
      )}
    </>
  );
}

export default function MoveInPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<LoadingState />}>
        <MoveInContent />
      </Suspense>
    </div>
  );
}
