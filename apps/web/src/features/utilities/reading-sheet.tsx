'use client';

import { METER_TYPE_LABELS, PERMISSIONS, READING_KIND_LABELS, type ReadingSheet, type SheetMeter, USAGE_WARNING_LABELS } from '@ql-tro/shared';
import { AlertTriangle, Pencil, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';
import { useCorrectReading, useMeterAction } from './api';
import { estimate, fromHundredths, normalizeReading, toHundredths } from './estimate';

const UNIT: Record<SheetMeter['type'], string> = { ELECTRICITY: 'kWh', WATER: 'm³' };
const showNumber = (v: string) => v.replace('.', ',');

export type Row = ReadingSheet['rows'][number];
export const ROW_STATUS: Record<Row['status'], { label: string; tone: BadgeTone }> = {
  DONE: { label: 'Đã đủ', tone: 'green' },
  PARTIAL: { label: 'Nhập dở', tone: 'amber' },
  TODO: { label: 'Chưa nhập', tone: 'gray' },
  NEEDS_SETUP: { label: 'Cần thiết lập', tone: 'red' },
};

/** Trạng thái một ô nhập (chưa lưu) — tính từ giá trị gõ và chỉ số đã lưu của kỳ. */
export function entryState(meter: SheetMeter, typedRaw: string | undefined, roundingUnit: number) {
  const value = typedRaw ?? (meter.current ? showNumber(meter.current.value) : '');
  const typed = toHundredths(normalizeReading(value));
  const dirty = value.trim() !== '' && (typed === null || !meter.current || typed !== toHundredths(meter.current.value));
  const est = dirty ? estimate(normalizeReading(value), meter.previous?.value ?? null, meter.carried_usage, meter.unit_price, roundingUnit) : null;
  const invalid = dirty && typed === null;
  const negative = dirty && !invalid && est === null;
  return { value, dirty, invalid, negative, est, savable: dirty && !invalid && !negative };
}

export interface SheetEntries {
  values: Record<string, string>;
  errors: Record<string, string>;
  setValue: (meterId: string, v: string) => void;
}

/**
 * Một phòng: điện, nước. Chỉ số cũ tự lấy từ lần chốt trước; nhập số mới → tiêu thụ, đơn giá, thành tiền tạm tính ngay.
 * “Lưu phòng” lưu cả hai đồng hồ của phòng một lần. Phòng thiếu đồng hồ: thiết lập chỉ số nền ngay tại đây.
 */
export function RoomReadingCard({
  row,
  sheet,
  entries,
  onSaveRoom,
  saving,
}: {
  row: Row;
  sheet: ReadingSheet;
  entries: SheetEntries;
  onSaveRoom: (row: Row) => void;
  saving: boolean;
}) {
  const metered = row.meters.filter((m) => m.meter_id);
  const states = metered.map((m) => entryState(m, entries.values[m.meter_id!], sheet.rounding_unit));
  const savable = states.some((s) => s.savable) && !states.some((s) => s.dirty && !s.savable);
  const st = ROW_STATUS[row.status];
  return (
    <section className="rounded-lg border border-slate-200 bg-white" aria-label={`Phòng ${row.room_code}`} data-testid={`reading-room-${row.room_code}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Link href={`/rooms/${row.room_id}`} className="hover:underline">
            Phòng {row.room_code}
          </Link>
          <Badge tone={st.tone}>{st.label}</Badge>
        </h2>
        <p className="text-xs text-slate-500">
          {row.primary_tenant_name ?? '—'} · {row.occupants} người
        </p>
      </header>
      <div className="divide-y divide-slate-100">
        {row.meters.map((m) =>
          m.meter_id ? (
            <MeterEntry key={m.type} meter={m} row={row} sheet={sheet} entries={entries} onEnter={() => savable && onSaveRoom(row)} />
          ) : m.needs_setup ? (
            <MeterSetup key={m.type} meter={m} row={row} />
          ) : (
            <div key={m.type} className="px-3 py-2 text-sm text-slate-500">
              {METER_TYPE_LABELS[m.type]}: không dùng đồng hồ — tính theo “{m.substituted_by}”.
            </div>
          ),
        )}
      </div>
      {metered.length ? (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
          <RoomTotal row={row} metered={metered} states={states} />
          <Button size="sm" onClick={() => onSaveRoom(row)} disabled={!savable || saving} aria-label={`Lưu chỉ số phòng ${row.room_code}`}>
            {row.status === 'DONE' && !savable ? 'Đã lưu' : 'Lưu phòng'}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

/** Tiền điện nước tạm tính của riêng phòng này: từng đồng hồ của phòng × đơn giá của tòa, cộng lại (không chia từ công tơ tổng). */
function RoomTotal({ row, metered, states }: { row: Row; metered: SheetMeter[]; states: ReturnType<typeof entryState>[] }) {
  const parts = metered.map((m, i) => {
    const s = states[i]!;
    const amount = s.dirty ? (s.est?.amount ?? null) : m.provisional_vnd === null ? null : BigInt(m.provisional_vnd);
    return { label: METER_TYPE_LABELS[m.type].toLowerCase(), amount };
  });
  const known = parts.filter((p): p is { label: string; amount: bigint } => p.amount !== null);
  if (!known.length) return <span className="text-sm text-slate-400">Nhập số mới để xem tiền điện nước của phòng</span>;
  const total = known.reduce((sum, p) => sum + p.amount, 0n);
  return (
    <p className="text-sm" data-testid={`room-total-${row.room_code}`}>
      <span className="text-slate-500">Phòng {row.room_code}: </span>
      {known.map((p, i) => (
        <span key={p.label}>
          {i ? ' + ' : ''}
          {p.label} {formatVnd(p.amount.toString())}
        </span>
      ))}
      {' = '}
      <strong className="tabular">{formatVnd(total.toString())}</strong>
      {known.length < parts.length ? <span className="text-slate-500"> (còn thiếu {parts.filter((p) => p.amount === null).map((p) => p.label).join(', ')})</span> : null}
    </p>
  );
}

function MeterEntry({ meter, row, sheet, entries, onEnter }: { meter: SheetMeter; row: Row; sheet: ReadingSheet; entries: SheetEntries; onEnter: () => void }) {
  const [correcting, setCorrecting] = useState(false);
  const label = METER_TYPE_LABELS[meter.type];
  const unit = UNIT[meter.type];
  const inputId = `rd-${row.room_code}-${meter.type}`;
  const s = entryState(meter, entries.values[meter.meter_id!], sheet.rounding_unit);
  const usage = s.dirty ? (s.est ? fromHundredths(s.est.usage) : null) : meter.usage ? showNumber(meter.usage) : null;
  const amount = s.dirty ? (s.est?.amount ?? null) : meter.provisional_vnd;
  const error = entries.errors[meter.meter_id!];

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-3 md:grid-cols-[4rem_8rem_9rem_6.5rem_7rem_8rem] md:items-center">
      <div className="col-span-2 font-medium md:col-span-1">{label}</div>
      <div className="text-sm">
        <span className="text-xs text-slate-500 md:hidden">Chỉ số cũ </span>
        {meter.previous ? (
          <span className="inline-flex items-center gap-1">
            <span className="tabular font-medium" data-testid={`${inputId}-previous`}>
              {showNumber(meter.previous.value)}
            </span>
            <PreviousCorrect meter={meter} roomId={row.room_id} open={correcting} setOpen={setCorrecting} />
          </span>
        ) : (
          '—'
        )}
        {meter.previous ? (
          <div className="text-xs text-slate-400">
            {READING_KIND_LABELS[meter.previous.kind as keyof typeof READING_KIND_LABELS] ?? ''} {formatBusinessDate(meter.previous.read_on)}
          </div>
        ) : null}
      </div>
      <div>
        <label htmlFor={inputId} className="text-xs text-slate-500 md:sr-only">
          Chỉ số mới {label.toLowerCase()} phòng {row.room_code}
        </label>
        <TextInput
          id={inputId}
          data-reading-input
          inputMode="decimal"
          autoComplete="off"
          className="h-11 text-right text-base tabular md:h-10"
          value={s.value}
          aria-invalid={s.negative || s.invalid || !!error ? true : undefined}
          onChange={(e) => entries.setValue(meter.meter_id!, e.target.value.replace(/[^\d.,]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onEnter();
              focusNext(inputId);
            }
          }}
        />
      </div>
      <div className="text-sm">
        <span className="text-xs text-slate-500 md:hidden">Tiêu thụ </span>
        <span className="tabular font-medium">{usage !== null ? `${usage} ${unit}` : '—'}</span>
        {meter.carried_usage !== '0' ? <div className="text-xs text-slate-400">gồm {showNumber(meter.carried_usage)} trên đồng hồ cũ</div> : null}
      </div>
      <div className="text-sm">
        <span className="text-xs text-slate-500 md:hidden">Đơn giá </span>
        <span className="tabular">{meter.unit_price ? `${formatVnd(meter.unit_price.split('.')[0]!)}/${unit}` : 'Chưa có giá'}</span>
      </div>
      <div className="text-sm md:text-right">
        <span className="text-xs text-slate-500 md:hidden">Thành tiền </span>
        <span className="tabular font-semibold">{amount !== null ? formatVnd(amount.toString()) : '—'}</span>
      </div>
      {s.negative || s.invalid || error || (meter.warning && !s.dirty) || meter.substituted_by ? (
        <div className="col-span-2 flex flex-col gap-1 text-sm md:col-span-6">
          {s.negative ? <p className="text-red-700">Nhỏ hơn chỉ số cũ — tiêu thụ âm. Đồng hồ được thay thì dùng “Thay đồng hồ” ở trang phòng.</p> : null}
          {s.invalid ? <p className="text-red-700">Chỉ số không hợp lệ (tối đa 2 chữ số thập phân).</p> : null}
          {error ? (
            <p className="text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          {meter.warning && !s.dirty ? (
            <p className="flex items-center gap-1 text-amber-800">
              <AlertTriangle className="size-4" aria-hidden /> {USAGE_WARNING_LABELS[meter.warning]} — kiểm tra lại, vẫn lưu được.
            </p>
          ) : null}
          {meter.substituted_by ? (
            <p>
              <Badge tone="violet">Đang dùng “{meter.substituted_by}”</Badge>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Phòng đang thuê chưa có đồng hồ loại này: nhập chỉ số nền (số đang hiện trên đồng hồ ở ngày bắt đầu tính) để bắt đầu chốt. */
function MeterSetup({ meter, row }: { meter: SheetMeter; row: Row }) {
  const can = useCan();
  const toast = useToast();
  const action = useMeterAction(row.room_id);
  const label = METER_TYPE_LABELS[meter.type];
  const [value, setValue] = useState('');
  const [date, setDate] = useState(row.setup_date);
  const [error, setError] = useState('');
  const id = `setup-${row.room_code}-${meter.type}`;
  if (!can(PERMISSIONS.ROOMS_MANAGE)) {
    return (
      <p className="flex items-center gap-2 px-3 py-3 text-sm text-red-800">
        <Wrench className="size-4" aria-hidden /> {label}: phòng chưa có chỉ số nền. Nhờ chủ trọ hoặc quản lý thiết lập để chốt được tháng này.
      </p>
    );
  }
  const submit = async () => {
    setError('');
    try {
      await action.mutateAsync({ path: `/rooms/${row.room_id}/meters`, body: { type: meter.type, installed_on: date, initial_reading: normalizeReading(value) } });
      toast.success(`Đã thiết lập đồng hồ ${label.toLowerCase()} phòng ${row.room_code}.`);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors ?? {})[0]?.[0] ?? e.message) : 'Không lưu được.');
    }
  };
  return (
    <div className="flex flex-col gap-2 bg-red-50/60 px-3 py-3 text-sm" data-testid={`setup-${row.room_code}-${meter.type}`}>
      <p className="flex items-center gap-2 font-medium text-red-900">
        <Wrench className="size-4" aria-hidden /> {label}: chưa có chỉ số nền — thiết lập để chốt được tháng này
      </p>
      <p className="text-xs text-slate-600">Ghi số đang hiện trên đồng hồ vào ngày bắt đầu tính tiền điện nước của phòng. Số seri không bắt buộc.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field id={id} label={`Chỉ số nền ${label.toLowerCase()}`} className="w-40">
          <TextInput id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))} />
        </Field>
        <Field id={`${id}-date`} label="Tính từ ngày" className="w-40">
          <TextInput id={`${id}-date`} type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button size="sm" onClick={() => void submit()} disabled={toHundredths(normalizeReading(value)) === null || action.isPending}>
          Thiết lập
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

/** Đưa con trỏ tới ô nhập kế tiếp để nhập lần lượt từng phòng. */
function focusNext(currentId: string) {
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-reading-input]')];
  const i = inputs.findIndex((el) => el.id === currentId);
  inputs[i + 1]?.focus();
}

// ---------- “Sửa chỉ số” trước ----------

function PreviousCorrect({ meter, roomId, open, setOpen }: { meter: SheetMeter; roomId: string; open: boolean; setOpen: (v: boolean) => void }) {
  const can = useCan();
  const prev = meter.previous!;
  // Chỉ số ban đầu của đồng hồ (chưa có lần đọc) sửa ở trang phòng, cần quyền quản lý đồng hồ.
  const isInstall = !prev.reading_id;
  if (isInstall ? !can(PERMISSIONS.SERVICES_MANAGE) : !can(PERMISSIONS.METER_READINGS_RECORD)) return null;
  return (
    <>
      <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={() => setOpen(true)} aria-label="Sửa chỉ số trước">
        <Pencil className="size-3.5" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Sửa chỉ số" description="Chỉ số trước được hệ thống tự lấy. Sửa khi nhập nhầm; bắt buộc ghi lý do, có lưu lịch sử.">
        {open ? <CorrectForm meter={meter} roomId={roomId} onClose={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  );
}

function CorrectForm({ meter, roomId, onClose }: { meter: SheetMeter; roomId: string; onClose: () => void }) {
  const toast = useToast();
  const correct = useCorrectReading();
  const meterAction = useMeterAction(roomId);
  const prev = meter.previous!;
  const [value, setValue] = useState(showNumber(prev.value));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const submit = async () => {
    setError('');
    setFieldErrors({});
    try {
      if (prev.reading_id) {
        await correct.mutateAsync({ id: prev.reading_id, value: normalizeReading(value), reason: reason.trim(), expected_version: prev.version ?? 1 });
      } else {
        await meterAction.mutateAsync({ path: `/meters/${meter.meter_id}/correct-initial`, body: { initial_reading: normalizeReading(value), reason: reason.trim() } });
      }
      toast.success('Đã sửa chỉ số.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors ?? {});
      } else setError('Không sửa được.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <p className="text-sm">
        Đang là <strong className="tabular">{showNumber(prev.value)}</strong> ({formatBusinessDate(prev.read_on)})
      </p>
      <Field id="cr-value" label="Chỉ số đúng" required error={fieldErrors.value?.[0] ?? fieldErrors.initial_reading?.[0]}>
        <TextInput id="cr-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))} />
      </Field>
      <Field id="cr-reason" label="Lý do" required error={fieldErrors.reason?.[0]}>
        <TextInput id="cr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Đọc nhầm số" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={correct.isPending || meterAction.isPending}>
          Lưu chỉ số đã sửa
        </Button>
      </div>
    </div>
  );
}

