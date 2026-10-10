'use client';

import type { ReadingSheet } from '@ql-tro/shared';
import { Save } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox, Field, Select, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useBuildings } from '@/features/property/api';
import { useReadingSheet, useSaveReadings } from '@/features/utilities/api';
import { meterPricesHref } from '@/features/utilities/meter-prices-section';
import { normalizeReading } from '@/features/utilities/estimate';
import { entryState, type Row, RoomReadingCard, type SheetEntries } from '@/features/utilities/reading-sheet';
import { ApiError } from '@/lib/api-client';
import { formatVnd, todayLocal } from '@/lib/format';

const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const shiftMonth = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** Tháng tiêu thụ mặc định: từ ngày 25 chốt tháng này, trước đó chốt tháng trước. */
function defaultConsumptionMonth(today: string): string {
  return Number(today.slice(8, 10)) >= 25 ? today.slice(0, 7) : shiftMonth(today.slice(0, 7), -1);
}

function ReadingsContent() {
  const search = useSearchParams();
  const buildings = useBuildings();
  const today = todayLocal();
  const [chosenBuilding, setBuilding] = useState(search.get('building_id') ?? '');
  const [month, setMonth] = useState(search.get('month') ?? defaultConsumptionMonth(today));
  const [readOn, setReadOn] = useState(today);
  const [onlyPending, setOnlyPending] = useState(false);
  const buildingId = chosenBuilding || buildings.data?.[0]?.id || '';
  const sheet = useReadingSheet(buildingId, month);
  const data = sheet.data;
  const missingPrice = data ? (['ELECTRICITY', 'WATER'] as const).filter((t) => data.unit_prices[t] === null) : [];

  return (
    <>
      <PageHeader
        title="Chốt chỉ số điện nước"
        description="Chọn tòa và tháng tiêu thụ. Chỉ số cũ tự lấy từ lần chốt trước; chỉ cần nhập số mới. Tiền ở đây là tạm tính — tiền chính thức tính khi lập thông báo."
      />
      <FilterBar>
        <Field id="rd-building" label="Tòa" className="sm:w-56">
          <Select id="rd-building" value={buildingId} onChange={(e) => setBuilding(e.target.value)}>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="rd-month" label="Tháng tiêu thụ" className="sm:w-48">
          <TextInput id="rd-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </Field>
        <Field id="rd-date" label="Ngày đọc đồng hồ" className="sm:w-44">
          <TextInput id="rd-date" type="date" value={readOn} max={today} onChange={(e) => setReadOn(e.target.value)} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox id="rd-pending" checked={onlyPending} onChange={setOnlyPending}>
            Chỉ hiện phòng chưa xong
          </Checkbox>
        </div>
      </FilterBar>

      {data ? (
        <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <p data-testid="billing-target">
            Điện nước <strong>tháng {monthLabel(data.consumption_month)}</strong> → vào thông báo <strong>tháng {monthLabel(data.period)}</strong>, cùng tiền phòng tháng{' '}
            {monthLabel(data.period)} (tiền phòng thu trước, điện nước thu sau).
          </p>
          <ul className="mt-1 list-disc pl-5 text-sky-800" data-testid="sheet-explain">
            <li>Chọn tòa chỉ để lọc danh sách: chỉ hiện các phòng của tòa {data.building_code}.</li>
            <li>
              Đơn giá đặt theo tòa, dùng chung cho mọi phòng trong tòa: điện {data.unit_prices.ELECTRICITY ? `${formatVnd(data.unit_prices.ELECTRICITY.split('.')[0]!)}/kWh` : 'chưa có giá'}, nước{' '}
              {data.unit_prices.WATER ? `${formatVnd(data.unit_prices.WATER.split('.')[0]!)}/m³` : 'chưa có giá'} (
              <Link href={meterPricesHref(data.building_id)} className="underline">
                đặt/đổi giá ở trang tòa
              </Link>
              ).
            </li>
            <li>Mỗi phòng có đồng hồ riêng: tiền = (số mới − số cũ) × đơn giá, tính riêng từng phòng. Không dùng công tơ tổng để chia tiền.</li>
          </ul>
        </div>
      ) : null}

      {missingPrice.length && data ? (
        <p role="status" className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Tòa {data.building_code} chưa có giá {missingPrice.map((t) => (t === 'ELECTRICITY' ? 'điện' : 'nước')).join(' và ')}: vẫn nhập được chỉ số nhưng chưa tạm tính được.{' '}
          <Link href={meterPricesHref(data.building_id)} className="font-medium underline">
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
        <EmptyState title={`Không có phòng cần chốt điện nước tháng ${monthLabel(data!.consumption_month)}`}>
          Chỉ liệt kê phòng có khách ở trong tháng này. Khách nhận phòng từ tháng sau sẽ chốt từ tháng nhận phòng.
        </EmptyState>
      ) : (
        <SheetBody key={`${buildingId}-${data!.consumption_month}`} sheet={data!} readOn={readOn} onlyPending={onlyPending} />
      )}
    </>
  );
}

function SheetBody({ sheet, readOn, onlyPending }: { sheet: ReadingSheet; readOn: string; onlyPending: boolean }) {
  const toast = useToast();
  const save = useSaveReadings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const entries: SheetEntries = {
    values,
    errors,
    setValue: (id, v) => {
      setValues((x) => ({ ...x, [id]: v }));
      setErrors((x) => ({ ...x, [id]: '' }));
    },
  };
  const savableMeters = (rows: Row[]) =>
    rows.flatMap((r) => r.meters.filter((m) => m.meter_id).map((m) => ({ m, s: entryState(m, values[m.meter_id!], sheet.rounding_unit) }))).filter((x) => x.s.savable);
  const pendingAll = savableMeters(sheet.rows);
  const r = sheet.totals.rooms;

  /** Lưu một nhóm đồng hồ trong một lần (cả phòng hoặc cả danh sách). Lỗi gắn về đúng ô. */
  const saveRows = async (rows: Row[], label: string) => {
    const batch = savableMeters(rows);
    if (!batch.length) return;
    try {
      await save.mutateAsync({
        period: sheet.period,
        read_on: readOn,
        items: batch.map(({ m, s }) => ({ meter_id: m.meter_id!, value: normalizeReading(s.value), ...(m.current ? { expected_version: m.current.version } : {}) })),
      });
      setValues((x) => {
        const next = { ...x };
        for (const { m } of batch) delete next[m.meter_id!];
        return next;
      });
      toast.success(`Đã lưu chỉ số ${label}.`);
    } catch (e) {
      const fe = e instanceof ApiError ? (e.fieldErrors ?? {}) : {};
      const next: Record<string, string> = {};
      batch.forEach(({ m }, i) => {
        const msg = fe[`items.${i}.value`]?.[0];
        if (msg) next[m.meter_id!] = msg;
      });
      if (!Object.keys(next).length) next[batch[0]!.m.meter_id!] = e instanceof ApiError ? e.message : 'Không lưu được.';
      setErrors((x) => ({ ...x, ...next }));
      toast.error(`Chưa lưu được chỉ số ${label}: kiểm tra ô báo lỗi.`);
    }
  };

  const visible = onlyPending ? sheet.rows.filter((row) => row.status !== 'DONE') : sheet.rows;
  const pct = r.total ? Math.round((r.done * 100) / r.total) : 0;

  return (
    <>
      {r.needs_setup ? (
        <p role="status" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {r.needs_setup} phòng chưa có chỉ số nền điện/nước nên chưa chốt được — thiết lập ngay ở thẻ phòng (ô màu đỏ) bên dưới.
        </p>
      ) : null}
      <div className="mb-2 hidden grid-cols-[4rem_8rem_9rem_6.5rem_7rem_8rem] gap-x-3 px-6 text-xs font-medium text-slate-500 md:grid">
        <span>Loại</span>
        <span>Chỉ số cũ</span>
        <span>Chỉ số mới</span>
        <span>Tiêu thụ</span>
        <span>Đơn giá</span>
        <span className="text-right">Thành tiền</span>
      </div>
      <div className="flex flex-col gap-3 pb-28">
        {visible.length ? (
          visible.map((row) => <RoomReadingCard key={row.room_id} row={row} sheet={sheet} entries={entries} saving={save.isPending} onSaveRoom={(x) => void saveRows([x], `phòng ${x.room_code}`)} />)
        ) : (
          <EmptyState title="Mọi phòng đã chốt đủ chỉ số" />
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mt-2 md:rounded-lg md:border">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span data-testid="sheet-progress">
              Đã chốt <strong>{r.done}</strong>/{r.total} phòng
              {r.todo ? ` · chưa nhập ${r.todo}` : ''}
              {r.partial ? ` · nhập dở ${r.partial}` : ''}
              {r.needs_setup ? <span className="text-red-700"> · cần thiết lập {r.needs_setup}</span> : null}
            </span>
            <span>
              Tạm tính các chỉ số đã lưu <strong className="tabular" data-testid="sheet-total">{formatVnd(sheet.totals.provisional_vnd)}</strong>
            </span>
          </div>
          <div className="h-2 rounded bg-slate-100" aria-hidden>
            <div className={`h-2 rounded ${r.done === r.total ? 'bg-emerald-600' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {r.done === r.total ? (
              <Link href={`/invoices?period=${sheet.period}&building_id=${sheet.building_id}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                Lập thông báo tháng {monthLabel(sheet.period)}
              </Link>
            ) : null}
            <Button size="sm" onClick={() => void saveRows(sheet.rows, 'cả danh sách')} disabled={!pendingAll.length || save.isPending}>
              <Save className="size-4" aria-hidden />
              Lưu tất cả{pendingAll.length ? ` (${pendingAll.length})` : ''}
            </Button>
          </div>
        </div>
      </div>
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
