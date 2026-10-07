'use client';

import { type MeterDto, METER_TYPE_LABELS, PERMISSIONS, READING_KIND_LABELS, type ReadingDto } from '@ql-tro/shared';
import { Pencil, Plus, Repeat } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, todayLocal } from '@/lib/format';
import { useCorrectReading, useMeterAction, useRoomMeters } from './api';
import { normalizeReading } from './estimate';

const show = (v: string) => v.replace('.', ',');
const clean = (v: string) => v.replace(/[^\d.,]/g, '');

type Mode = { kind: 'attach'; type: 'ELECTRICITY' | 'WATER' } | { kind: 'replace'; meter: MeterDto } | { kind: 'initial'; meter: MeterDto } | { kind: 'reading'; reading: ReadingDto };

function useFormState() {
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  return {
    error,
    fe: fieldErrors,
    reset: () => {
      setError('');
      setFieldErrors({});
    },
    capture: (e: unknown) => {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors ?? {});
      } else setError('Không lưu được.');
    },
  };
}

/** Đồng hồ điện nước của phòng (MASTER_PLAN 8.5): chỉ số ban đầu nhập một lần; thay đồng hồ chốt chỉ số cũ. */
export function MetersSection({ roomId }: { roomId: string }) {
  const can = useCan();
  const meters = useRoomMeters(roomId);
  const [mode, setMode] = useState<Mode | null>(null);
  // Thay đồng hồ, sửa chỉ số ban đầu: chủ trọ. Gắn đồng hồ + chỉ số nền là thiết lập phòng: cả quản lý.
  const manage = can(PERMISSIONS.SERVICES_MANAGE);
  const canAttach = can(PERMISSIONS.ROOMS_MANAGE);
  const record = can(PERMISSIONS.METER_READINGS_RECORD);

  return (
    <Card id="meters">
      <CardHeader>
        <CardTitle>Đồng hồ điện nước</CardTitle>
      </CardHeader>
      {meters.isPending ? (
        <LoadingState />
      ) : meters.isError ? (
        <ErrorState error={meters.error} onRetry={() => void meters.refetch()} />
      ) : (
        <>
          <CardContent className="grid gap-3 border-b border-slate-100 sm:grid-cols-2">
            {(['ELECTRICITY', 'WATER'] as const).map((type) => {
              const m = meters.data.meters.find((x) => x.type === type && !x.retired_on);
              return (
                <div key={type} className="rounded-md border border-slate-200 p-3 text-sm" data-testid={`meter-${type}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{METER_TYPE_LABELS[type]}</p>
                    {m && manage ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setMode({ kind: 'initial', meter: m })} aria-label={`Sửa chỉ số ban đầu ${METER_TYPE_LABELS[type].toLowerCase()}`}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setMode({ kind: 'replace', meter: m })}>
                          <Repeat className="size-4" aria-hidden />
                          Thay đồng hồ
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {m ? (
                    <dl className="mt-1 grid grid-cols-2 gap-1 text-slate-600">
                      <dt>Số seri</dt>
                      <dd>{m.serial ?? '—'}</dd>
                      <dt>Lắp ngày</dt>
                      <dd>{formatBusinessDate(m.installed_on)}</dd>
                      <dt>Chỉ số ban đầu</dt>
                      <dd className="tabular">{show(m.initial_reading)}</dd>
                      <dt>Lần đọc gần nhất</dt>
                      <dd className="tabular">{m.last_reading ? `${show(m.last_reading.value)} (${formatBusinessDate(m.last_reading.read_on)})` : '—'}</dd>
                    </dl>
                  ) : (
                    <div className="mt-1 flex items-center justify-between gap-2 text-slate-500">
                      Chưa gắn đồng hồ.
                      {canAttach ? (
                        <Button size="sm" variant="outline" onClick={() => setMode({ kind: 'attach', type })}>
                          <Plus className="size-4" aria-hidden />
                          Gắn đồng hồ
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
          {meters.data.readings.length === 0 ? (
            <EmptyState title="Chưa có chỉ số" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Ngày đọc</Th>
                  <Th>Loại</Th>
                  <Th className="text-right">Chỉ số</Th>
                  <Th className="hidden sm:table-cell">Ghi chú</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {meters.data.readings.map((r) => (
                  <Tr key={r.id}>
                    <Td className="tabular whitespace-nowrap">{formatBusinessDate(r.read_on)}</Td>
                    <Td>
                      {METER_TYPE_LABELS[r.meter_type]} · {READING_KIND_LABELS[r.kind]}
                      {r.period ? <span className="text-xs text-slate-500"> kỳ {r.period.slice(5)}/{r.period.slice(0, 4)}</span> : null}
                    </Td>
                    <Td className="text-right tabular">{show(r.value)}</Td>
                    <Td className="hidden text-slate-600 sm:table-cell">
                      {r.note ?? ''}
                      {r.created_by_name ? <div className="text-xs text-slate-400">{r.created_by_name}</div> : null}
                    </Td>
                    <Td className="text-right">
                      {record ? (
                        <Button size="sm" variant="ghost" onClick={() => setMode({ kind: 'reading', reading: r })} aria-label={`Sửa chỉ số ngày ${formatBusinessDate(r.read_on)}`}>
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {meters.data.events.length ? (
            <CardContent className="border-t border-slate-100 text-sm">
              <p className="mb-1 font-medium">Lịch sử thay/sửa</p>
              <ul className="flex flex-col gap-1 text-slate-600">
                {meters.data.events.map((e) => (
                  <li key={e.id}>
                    <Badge tone={e.kind === 'REPLACEMENT' ? 'violet' : 'amber'}>{e.kind === 'REPLACEMENT' ? 'Thay đồng hồ' : 'Sửa chỉ số'}</Badge> {METER_TYPE_LABELS[e.meter_type]}:{' '}
                    {e.old_value !== null ? show(e.old_value) : '—'} → {e.new_value !== null ? show(e.new_value) : '—'} · {e.reason} · {e.created_by_name ?? ''}{' '}
                    {formatBusinessDate(e.created_at.slice(0, 10))}
                  </li>
                ))}
              </ul>
            </CardContent>
          ) : null}
        </>
      )}
      <Dialog open={!!mode} onClose={() => setMode(null)} title={mode ? TITLES[mode.kind] : ''}>
        {mode ? <MeterForm mode={mode} roomId={roomId} onClose={() => setMode(null)} /> : null}
      </Dialog>
    </Card>
  );
}

const TITLES: Record<Mode['kind'], string> = {
  attach: 'Gắn đồng hồ',
  replace: 'Thay đồng hồ',
  initial: 'Sửa chỉ số ban đầu',
  reading: 'Sửa chỉ số',
};

function MeterForm({ mode, roomId, onClose }: { mode: Mode; roomId: string; onClose: () => void }) {
  const toast = useToast();
  const action = useMeterAction(roomId);
  const correct = useCorrectReading();
  const f = useFormState();
  const [v, setV] = useState({
    type: mode.kind === 'attach' ? mode.type : 'ELECTRICITY',
    date: todayLocal(),
    value: mode.kind === 'reading' ? show(mode.reading.value) : mode.kind === 'initial' ? show(mode.meter.initial_reading) : '',
    newInitial: '0',
    serial: '',
    reason: '',
    confirm: false,
  });

  const submit = async () => {
    f.reset();
    try {
      if (mode.kind === 'attach') {
        await action.mutateAsync({
          path: `/rooms/${roomId}/meters`,
          body: { type: v.type, serial: v.serial.trim() || null, installed_on: v.date, initial_reading: normalizeReading(v.value), confirm_dual_utility: v.confirm },
        });
      } else if (mode.kind === 'replace') {
        await action.mutateAsync({
          path: `/meters/${mode.meter.id}/replace`,
          body: { replaced_on: v.date, closing_value: normalizeReading(v.value), new_serial: v.serial.trim() || null, new_initial_reading: normalizeReading(v.newInitial), reason: v.reason.trim() },
        });
      } else if (mode.kind === 'initial') {
        await action.mutateAsync({ path: `/meters/${mode.meter.id}/correct-initial`, body: { initial_reading: normalizeReading(v.value), reason: v.reason.trim() } });
      } else {
        await correct.mutateAsync({ id: mode.reading.id, value: normalizeReading(v.value), reason: v.reason.trim(), expected_version: mode.reading.version });
      }
      toast.success(`${TITLES[mode.kind]}: đã lưu.`);
      onClose();
    } catch (e) {
      f.capture(e);
    }
  };
  const fe = f.fe;

  return (
    <div className="flex flex-col gap-4">
      <FormError message={f.error} />
      {mode.kind === 'replace' ? (
        <p className="text-sm text-slate-600">
          Đồng hồ cũ ngưng tại ngày thay với chỉ số chốt; đồng hồ mới bắt đầu từ chỉ số ban đầu riêng. Tiêu thụ trong kỳ = phần đồng hồ cũ + phần đồng hồ mới.
        </p>
      ) : null}
      {mode.kind === 'reading' ? (
        <p className="text-sm text-slate-600">
          {METER_TYPE_LABELS[mode.reading.meter_type]} · {READING_KIND_LABELS[mode.reading.kind]} ngày {formatBusinessDate(mode.reading.read_on)}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {mode.kind === 'attach' ? (
          <Field id="mt-type" label="Loại">
            <Select id="mt-type" value={v.type} disabled>
              <option value="ELECTRICITY">Điện</option>
              <option value="WATER">Nước</option>
            </Select>
          </Field>
        ) : null}
        {mode.kind === 'attach' || mode.kind === 'replace' ? (
          <Field id="mt-date" label={mode.kind === 'attach' ? 'Ngày lắp' : 'Ngày thay'} required error={fe.installed_on?.[0] ?? fe.replaced_on?.[0]}>
            <TextInput id="mt-date" type="date" value={v.date} max={todayLocal()} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
        ) : null}
        <Field
          id="mt-value"
          label={mode.kind === 'replace' ? 'Chỉ số chốt đồng hồ cũ' : mode.kind === 'reading' ? 'Chỉ số đúng' : 'Chỉ số ban đầu'}
          required
          error={fe.initial_reading?.[0] ?? fe.closing_value?.[0] ?? fe.value?.[0]}
        >
          <TextInput id="mt-value" inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: clean(e.target.value) })} />
        </Field>
        {mode.kind === 'replace' ? (
          <Field id="mt-new-initial" label="Chỉ số ban đầu đồng hồ mới" required error={fe.new_initial_reading?.[0]}>
            <TextInput id="mt-new-initial" inputMode="decimal" value={v.newInitial} onChange={(e) => setV({ ...v, newInitial: clean(e.target.value) })} />
          </Field>
        ) : null}
        {mode.kind === 'attach' || mode.kind === 'replace' ? (
          <Field id="mt-serial" label={mode.kind === 'replace' ? 'Số seri đồng hồ mới (không bắt buộc)' : 'Số seri (không bắt buộc)'}>
            <TextInput id="mt-serial" value={v.serial} onChange={(e) => setV({ ...v, serial: e.target.value })} />
          </Field>
        ) : null}
        {mode.kind !== 'attach' ? (
          <Field id="mt-reason" label="Lý do" required className="sm:col-span-2" error={fe.reason?.[0]}>
            <TextInput id="mt-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          </Field>
        ) : null}
      </div>
      {mode.kind === 'attach' && fe.confirm_dual_utility ? (
        <Checkbox id="mt-confirm" checked={v.confirm} onChange={(confirm) => setV({ ...v, confirm })}>
          Tôi xác nhận tính cả tiền theo đồng hồ và dịch vụ đang dùng thay đồng hồ (hai khoản độc lập).
        </Checkbox>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending || correct.isPending || !v.value}>
          Lưu
        </Button>
      </div>
    </div>
  );
}
