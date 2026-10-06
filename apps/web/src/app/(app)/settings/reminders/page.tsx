'use client';

import { PERMISSIONS, REMINDER_CHANNEL_LABELS, type ReminderSettingsDto } from '@ql-tro/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, FormError, Select, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useReminderSettings, useSaveReminderSettings } from '@/features/reminders/api';
import { ApiError } from '@/lib/api-client';

export default function ReminderSettingsPage() {
  const settings = useReminderSettings();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        back={{ href: '/settings', label: 'Cấu hình' }}
        title="Nhắc đóng tiền"
        description="Tự động nhắc người thuê đã đồng ý nhận tin, theo các mốc trước hạn / đúng hạn / quá hạn. Gửi tin không thay đổi công nợ."
      />
      {settings.isPending ? (
        <LoadingState />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <SettingsForm key={settings.data.version} current={settings.data} />
      )}
    </div>
  );
}

const hours = Array.from({ length: 24 }, (_, h) => h);

function SettingsForm({ current }: { current: ReminderSettingsDto }) {
  const toast = useToast();
  const can = useCan();
  const canManage = can(PERMISSIONS.REMINDERS_MANAGE);
  const save = useSaveReminderSettings();
  const [v, setV] = useState({
    enabled: current.enabled,
    primary: (current.channel_order[0] ?? 'ZALO_ZNS') as string,
    fallback: current.channel_order[1] ?? '',
    before: String(-(current.offsets_days.find((o) => o < 0) ?? -3)),
    due: current.offsets_days.includes(0),
    after: String(current.offsets_days.find((o) => o > 0) ?? 3),
    send_hour: current.send_hour,
    quiet_start: current.quiet_start,
    quiet_end: current.quiet_end,
    send_to_ended: current.send_to_ended,
  });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});

  const submit = async () => {
    setError('');
    setFe({});
    const offsets = [...(v.before ? [-Number(v.before)] : []), ...(v.due ? [0] : []), ...(v.after ? [Number(v.after)] : [])];
    try {
      await save.mutateAsync({
        enabled: v.enabled,
        channel_order: [v.primary, ...(v.fallback && v.fallback !== v.primary ? [v.fallback] : [])],
        offsets_days: offsets,
        send_hour: v.send_hour,
        quiet_start: v.quiet_start,
        quiet_end: v.quiet_end,
        send_to_ended: v.send_to_ended,
        ...(current.version ? { expected_version: current.version } : {}),
      });
      toast.success('Đã lưu cấu hình nhắc đóng tiền.');
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFe(e.fieldErrors ?? {});
      } else setError('Không lưu được.');
    }
  };

  return (
    <>
      <p
        role="status"
        data-testid="reminder-sending-mode"
        className={`rounded-md border px-4 py-3 text-sm ${current.real_sending ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
      >
        {current.note}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Kênh gửi</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1">
            {current.channels.map((c) => (
              <li key={c.code} className="flex items-center gap-2">
                <span className="w-32">{c.label}</span>
                {c.configured ? <Badge tone="green">Sẵn sàng</Badge> : <Badge tone="gray">Chưa cấu hình / chưa kiểm chứng</Badge>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            Khóa API của nhà cung cấp do chủ trọ tự đăng ký và đặt trong biến môi trường của server (ZALO_ZNS_*, SMS_*), không nhập ở đây và không lưu trong cơ sở dữ liệu.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lịch nhắc</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormError message={error} />
          <Checkbox id="rm-enabled" checked={v.enabled} onChange={(enabled) => setV({ ...v, enabled })}>
            Bật nhắc đóng tiền tự động
          </Checkbox>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="rm-primary" label="Kênh chính" error={fe.channel_order?.[0]}>
              <Select id="rm-primary" value={v.primary} onChange={(e) => setV({ ...v, primary: e.target.value })}>
                {(['ZALO_ZNS', 'SMS'] as const).map((c) => (
                  <option key={c} value={c}>
                    {REMINDER_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="rm-fallback" label="Kênh dự phòng (khi kênh chính lỗi)">
              <Select id="rm-fallback" value={v.fallback} onChange={(e) => setV({ ...v, fallback: e.target.value })}>
                <option value="">Không dùng</option>
                {(['ZALO_ZNS', 'SMS'] as const)
                  .filter((c) => c !== v.primary)
                  .map((c) => (
                    <option key={c} value={c}>
                      {REMINDER_CHANNEL_LABELS[c]}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium">Mốc nhắc (để trống để bỏ mốc)</legend>
            <Field id="rm-before" label="Trước hạn (ngày)" error={fe.offsets_days?.[0]}>
              <TextInput id="rm-before" type="number" min={1} max={15} value={v.before} onChange={(e) => setV({ ...v, before: e.target.value })} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox id="rm-due" checked={v.due} onChange={(due) => setV({ ...v, due })}>
                Đúng ngày đến hạn
              </Checkbox>
            </div>
            <Field id="rm-after" label="Quá hạn (ngày)">
              <TextInput id="rm-after" type="number" min={1} max={30} value={v.after} onChange={(e) => setV({ ...v, after: e.target.value })} />
            </Field>
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(
              [
                ['send_hour', 'Giờ gửi'],
                ['quiet_start', 'Không gửi từ'],
                ['quiet_end', 'Đến'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} id={`rm-${k}`} label={label} error={fe[k]?.[0]}>
                <Select id={`rm-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}>
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <Checkbox id="rm-ended" checked={v.send_to_ended} onChange={(send_to_ended) => setV({ ...v, send_to_ended })}>
            Vẫn nhắc nợ của người đã trả phòng
          </Checkbox>
          {canManage ? (
            <div className="flex justify-end">
              <Button onClick={() => void submit()} disabled={save.isPending}>
                Lưu cấu hình
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Bạn chỉ có quyền xem cấu hình.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
