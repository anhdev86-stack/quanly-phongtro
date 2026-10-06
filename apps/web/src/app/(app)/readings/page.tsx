'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Field, Select, TextInput } from '@/components/ui/form';
import { useBuildings } from '@/features/property/api';
import { useReadingSheet } from '@/features/utilities/api';
import { periodLabel } from '@/features/utilities/meter-prices-section';
import { RoomReadingCard } from '@/features/utilities/reading-sheet';
import { formatVnd, todayLocal } from '@/lib/format';

/** Kỳ mặc định: cuối tháng (từ ngày 25) nhập cho kỳ tháng sau, còn lại kỳ tháng này. */
function defaultPeriod(today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const next = d >= 25 ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y, m - 1, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ReadingsContent() {
  const search = useSearchParams();
  const buildings = useBuildings();
  const today = todayLocal();
  const [chosenBuilding, setBuilding] = useState(search.get('building_id') ?? '');
  const [period, setPeriod] = useState(search.get('period') ?? defaultPeriod(today));
  const [readOn, setReadOn] = useState(today);
  const buildingId = chosenBuilding || buildings.data?.[0]?.id || '';
  const sheet = useReadingSheet(buildingId, period);
  const data = sheet.data;
  const missingPrice = data ? (['ELECTRICITY', 'WATER'] as const).filter((t) => data.unit_prices[t] === null) : [];

  return (
    <>
      <PageHeader
        title="Nhập chỉ số điện nước"
        description="Chỉ số trước được tự điền; chỉ cần nhập chỉ số mới. Tiền hiển thị là tạm tính — tiền chính thức tính khi tạo thông báo."
      />
      <FilterBar>
        <Field id="rd-building" label="Tòa" className="sm:w-48">
          <Select id="rd-building" value={buildingId} onChange={(e) => setBuilding(e.target.value)}>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="rd-period" label="Kỳ (tháng phát hành)" className="sm:w-44">
          <TextInput id="rd-period" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        </Field>
        <Field id="rd-date" label="Ngày đọc" className="sm:w-44">
          <TextInput id="rd-date" type="date" value={readOn} max={today} onChange={(e) => setReadOn(e.target.value)} />
        </Field>
      </FilterBar>

      {missingPrice.length && data ? (
        <p role="status" className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Tòa {data.building_code} chưa có giá {missingPrice.map((t) => (t === 'ELECTRICITY' ? 'điện' : 'nước')).join(' và ')} cho {periodLabel(data.month_start)}: vẫn nhập được chỉ số nhưng
          chưa tạm tính được.{' '}
          <Link href={`/buildings/${data.building_id}`} className="font-medium underline">
            Đặt giá ở trang tòa
          </Link>
        </p>
      ) : null}

      {!buildingId && buildings.isSuccess ? (
        <EmptyState title="Bạn chưa được giao tòa nào" />
      ) : sheet.isPending ? (
        <LoadingState />
      ) : sheet.isError ? (
        <ErrorState error={sheet.error} onRetry={() => void sheet.refetch()} />
      ) : data!.rows.length === 0 ? (
        <EmptyState title="Tòa này chưa có phòng đang thuê" />
      ) : (
        <>
          <div className="mb-2 hidden grid-cols-[5rem_9rem_10rem_7rem_9rem_auto] gap-x-3 px-6 text-xs font-medium text-slate-500 md:grid">
            <span>Loại</span>
            <span>Chỉ số trước</span>
            <span>Chỉ số mới</span>
            <span>Tiêu thụ</span>
            <span>Tạm tính</span>
            <span />
          </div>
          <div className="flex flex-col gap-3 pb-20">
            {data!.rows.map((row) => (
              <RoomReadingCard key={`${data!.period}-${row.room_id}`} row={row} sheet={data!} readOn={readOn} />
            ))}
          </div>
          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mt-2 md:rounded-lg md:border">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 text-sm">
              <span>
                Đã nhập <strong>{data!.totals.entered}</strong>/{data!.totals.expected} đồng hồ · {periodLabel(data!.month_start)}
              </span>
              <span>
                Tổng tạm tính <strong className="tabular" data-testid="sheet-total">{formatVnd(data!.totals.provisional_vnd)}</strong>
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function ReadingsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <Suspense fallback={<LoadingState />}>
        <ReadingsContent />
      </Suspense>
    </div>
  );
}
