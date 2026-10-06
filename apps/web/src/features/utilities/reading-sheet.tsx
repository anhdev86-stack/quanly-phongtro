'use client';

import { METER_TYPE_LABELS, PERMISSIONS, READING_KIND_LABELS, type ReadingSheet, type SheetMeter, USAGE_WARNING_LABELS } from '@ql-tro/shared';
import { AlertTriangle, Check, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { useCorrectReading, useMeterAction, useSaveReadings } from './api';
import { estimate, fromHundredths, normalizeReading, toHundredths } from './estimate';

const UNIT: Record<SheetMeter['type'], string> = { ELECTRICITY: 'kWh', WATER: 'm³' };
const showNumber = (v: string) => v.replace('.', ',');

type Row = ReadingSheet['rows'][number];

/** Một phòng: hai đồng hồ điện/nước. Trên điện thoại xếp dọc, từ md trở lên thành dòng dạng bảng. */
export function RoomReadingCard({ row, sheet, readOn }: { row: Row; sheet: ReadingSheet; readOn: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white" aria-label={`Phòng ${row.room_code}`} data-testid={`reading-room-${row.room_code}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h2 className="font-semibold">
          <Link href={`/rooms/${row.room_id}`} className="hover:underline">
            Phòng {row.room_code}
          </Link>
        </h2>
        <p className="text-xs text-slate-500">
          {row.primary_tenant_name ?? '—'} · {row.occupants} người
        </p>
      </header>
      <div className="divide-y divide-slate-100">
        {row.meters.map((m) => (
          <MeterEntry key={m.type} meter={m} row={row} sheet={sheet} readOn={readOn} />
        ))}
      </div>
    </section>
  );
}

function MeterEntry({ meter, row, sheet, readOn }: { meter: SheetMeter; row: Row; sheet: ReadingSheet; readOn: string }) {
  const can = useCan();
  const toast = useToast();
  const save = useSaveReadings();
  const [value, setValue] = useState(meter.current ? showNumber(meter.current.value) : '');
  const [error, setError] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const label = METER_TYPE_LABELS[meter.type];
  const unit = UNIT[meter.type];
  const inputId = `rd-${row.room_code}-${meter.type}`;

  if (!meter.meter_id) {
    return (
      <div className="px-3 py-2 text-sm text-slate-500">
        {label}: chưa gắn đồng hồ.{' '}
        {can(PERMISSIONS.SERVICES_MANAGE) ? (
          <Link href={`/rooms/${row.room_id}#meters`} className="text-brand-800 hover:underline">
            Gắn đồng hồ
          </Link>
        ) : null}
      </div>
    );
  }

  const typed = toHundredths(normalizeReading(value));
  const dirty = value.trim() !== '' && (typed === null || !meter.current || typed !== toHundredths(meter.current.value));
  const est = dirty ? estimate(normalizeReading(value), meter.previous?.value ?? null, meter.carried_usage, meter.unit_price, sheet.rounding_unit) : null;
  const typedInvalid = dirty && typed === null;
  const negative = dirty && !typedInvalid && est === null;
  const usage = dirty ? (est ? fromHundredths(est.usage) : null) : meter.usage ? showNumber(meter.usage) : null;
  const amount = dirty ? (est?.amount ?? null) : meter.provisional_vnd;

  const submit = async () => {
    if (!dirty || typedInvalid || negative) return;
    setError('');
    try {
      await save.mutateAsync({
        period: sheet.period,
        read_on: readOn,
        items: [{ meter_id: meter.meter_id!, value: normalizeReading(value), ...(meter.current ? { expected_version: meter.current.version } : {}) }],
      });
      toast.success(`Đã lưu chỉ số ${label.toLowerCase()} phòng ${row.room_code}.`);
      focusNext(inputId);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fieldErrors ?? {})[0]?.[0] ?? e.message) : 'Không lưu được.');
    }
  };

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-3 md:grid-cols-[5rem_9rem_10rem_7rem_9rem_auto] md:items-center">
      <div className="col-span-2 flex items-center gap-2 md:col-span-1">
        <span className="font-medium">{label}</span>
        {meter.current && !dirty ? <Check className="size-4 text-emerald-600" aria-label="Đã nhập" /> : null}
      </div>
      <div className="text-sm">
        <span className="text-xs text-slate-500 md:hidden">Chỉ số trước </span>
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
          value={value}
          aria-invalid={negative || typedInvalid || !!error ? true : undefined}
          onChange={(e) => {
            setValue(e.target.value.replace(/[^\d.,]/g, ''));
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </div>
      <div className="text-sm">
        <span className="text-xs text-slate-500 md:hidden">Tiêu thụ </span>
        <span className="tabular font-medium">{usage !== null ? `${usage} ${unit}` : '—'}</span>
        {meter.carried_usage !== '0' ? <div className="text-xs text-slate-400">gồm {showNumber(meter.carried_usage)} trên đồng hồ cũ</div> : null}
      </div>
      <div className="text-sm">
        <span className="text-xs text-slate-500 md:hidden">Tạm tính </span>
        <span className="tabular font-semibold">{amount !== null ? formatVnd(amount.toString()) : meter.unit_price === null ? 'Chưa có giá' : '—'}</span>
        {meter.unit_price ? <div className="text-xs text-slate-400">{formatVnd(meter.unit_price.split('.')[0]!)}/{unit}</div> : null}
      </div>
      <div className="col-span-2 flex justify-end md:col-span-1">
        <Button size="sm" onClick={() => void submit()} disabled={!dirty || typedInvalid || negative || save.isPending} aria-label={`Lưu chỉ số ${label.toLowerCase()} phòng ${row.room_code}`}>
          {meter.current ? 'Lưu lại' : 'Lưu'}
        </Button>
      </div>
      {negative || typedInvalid || error || (meter.warning && !dirty) || meter.substituted_by ? (
        <div className="col-span-2 flex flex-col gap-1 text-sm md:col-span-6">
          {negative ? <p className="text-red-700">Nhỏ hơn chỉ số trước — tiêu thụ âm. Đồng hồ được thay thì dùng “Thay đồng hồ” ở trang phòng.</p> : null}
          {typedInvalid ? <p className="text-red-700">Chỉ số không hợp lệ (tối đa 2 chữ số thập phân).</p> : null}
          {error ? (
            <p className="text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          {meter.warning && !dirty ? (
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

