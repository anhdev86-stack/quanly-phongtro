'use client';

import { PERMISSIONS, REMINDER_CHANNEL_LABELS, REMINDER_MILESTONE_LABELS, REMINDER_STATUS_LABELS, type ReminderDto, SKIP_REASON_LABELS } from '@ql-tro/shared';
import { Play, RotateCw, Settings } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useBuildings } from '@/features/property/api';
import { useReminders, useReminderSettings, useResendReminder, useRunReminders } from '@/features/reminders/api';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd } from '@/lib/format';

const STATUS_TONE: Record<ReminderDto['status'], BadgeTone> = { PENDING: 'blue', SENDING: 'blue', SENT: 'green', FAILED: 'red', SKIPPED: 'gray', CANCELLED: 'gray' };
const channelLabel = (c: string) => REMINDER_CHANNEL_LABELS[c as keyof typeof REMINDER_CHANNEL_LABELS] ?? c;
const dateTime = (v: string) => new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

function RemindersContent() {
  const search = useSearchParams();
  const can = useCan();
  const toast = useToast();
  const canManage = can(PERMISSIONS.REMINDERS_MANAGE);
  const buildings = useBuildings();
  const settings = useReminderSettings();
  const [f, setF] = useState({ status: search.get('status') ?? '', building_id: '', page: 1, page_size: 50 });
  const list = useReminders(f);
  const runNow = useRunReminders();
  const resend = useResendReminder();
  const [open, setOpen] = useState<string | null>(null);

  const doRun = async () => {
    try {
      const r = await runNow.mutateAsync();
      toast.success(`Đã chạy: ${r.created} tin mới, ${r.sent} đã gửi, ${r.skipped} bỏ qua, ${r.retried} chờ thử lại, ${r.failed} lỗi.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không chạy được.');
    }
  };
  const doResend = async (id: string) => {
    try {
      const r = await resend.mutateAsync(id);
      if (r.status === 'SENT') toast.success('Đã gửi lại.');
      else toast.error(`Không gửi: ${r.skip_reason ? (SKIP_REASON_LABELS[r.skip_reason] ?? r.skip_reason) : REMINDER_STATUS_LABELS[r.status]}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không gửi lại được.');
    }
  };

  return (
    <>
      <PageHeader
        title="Nhắc đóng tiền"
        description="Nhật ký tin nhắc theo mốc trước hạn / đúng hạn / quá hạn. Số điện thoại luôn được che."
        actions={
          <div className="flex gap-2">
            <Link href="/settings/reminders" className={buttonVariants({ variant: 'outline' })}>
              <Settings className="size-4" aria-hidden />
              Cấu hình
            </Link>
            {canManage ? (
              <Button onClick={() => void doRun()} disabled={runNow.isPending || !settings.data?.enabled}>
                <Play className="size-4" aria-hidden />
                Chạy nhắc ngay
              </Button>
            ) : null}
          </div>
        }
      />
      {settings.data && !settings.data.enabled ? (
        <p role="status" className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Nhắc đóng tiền đang tắt. Bật trong <Link href="/settings/reminders" className="underline">cấu hình</Link>.
        </p>
      ) : settings.data && !settings.data.real_sending ? (
        <p role="status" data-testid="log-only-banner" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Chưa gửi tin thật — các tin “Đã gửi” hiện chỉ được ghi log (kênh {REMINDER_CHANNEL_LABELS.LOG_ONLY}).
        </p>
      ) : null}
      <FilterBar>
        <Field id="rm-status" label="Trạng thái" className="sm:w-40">
          <Select id="rm-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>
            <option value="">Tất cả</option>
            {Object.entries(REMINDER_STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="rm-building" label="Tòa" className="sm:w-48">
          <Select id="rm-building" value={f.building_id} onChange={(e) => setF({ ...f, building_id: e.target.value, page: 1 })}>
            <option value="">Tất cả tòa</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <Card>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Chưa có tin nhắc">Tin được tạo khi tới mốc nhắc của thông báo còn nợ, cho người thuê đã đồng ý nhận tin.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Phòng / thông báo</Th>
                <Th className="hidden sm:table-cell">Mốc</Th>
                <Th>Trạng thái</Th>
                <Th className="hidden md:table-cell">Người nhận</Th>
                <Th className="hidden text-right lg:table-cell">Còn nợ</Th>
                <Th className="text-right">
                  <span className="sr-only">Thao tác</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((m) => (
                <ReminderRow key={m.id} m={m} expanded={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} canManage={canManage} onResend={() => void doResend(m.id)} busy={resend.isPending} />
              ))}
            </tbody>
          </Table>
        )}
        {list.data ? (
          <div className="px-3 pb-3">
            <Pagination page={f.page} pageSize={f.page_size} total={list.data.total} onPage={(page) => setF({ ...f, page })} />
          </div>
        ) : null}
      </Card>
    </>
  );
}

function ReminderRow({ m, expanded, onToggle, canManage, onResend, busy }: { m: ReminderDto; expanded: boolean; onToggle: () => void; canManage: boolean; onResend: () => void; busy: boolean }) {
  const lastError = [...m.attempts].reverse().find((a) => a.result === 'FAILED');
  return (
    <>
      <Tr data-testid="reminder-row">
        <Td>
          <Link href={`/invoices/${m.invoice_id}`} className="font-medium text-brand-800 hover:underline">
            {m.building_code} · {m.room_code}
          </Link>
          <div className="text-xs text-slate-500">
            {m.invoice_number} · hạn {formatBusinessDate(m.due_date)}
          </div>
        </Td>
        <Td className="hidden sm:table-cell">
          {REMINDER_MILESTONE_LABELS[m.milestone]}
          <div className="text-xs text-slate-500">{dateTime(m.scheduled_for)}</div>
        </Td>
        <Td>
          <Badge tone={STATUS_TONE[m.status]}>{REMINDER_STATUS_LABELS[m.status]}</Badge>
          {m.status === 'SENT' && m.channel_used ? <div className="text-xs text-slate-500">{channelLabel(m.channel_used)}</div> : null}
          {m.status === 'SKIPPED' || m.status === 'CANCELLED' ? <div className="text-xs text-slate-500">{m.skip_reason ? (SKIP_REASON_LABELS[m.skip_reason] ?? m.skip_reason) : ''}</div> : null}
          {m.status === 'FAILED' && lastError ? <div className="text-xs text-red-700">{lastError.error_message ?? lastError.error_code}</div> : null}
        </Td>
        <Td className="hidden md:table-cell">
          {m.tenant_name ?? '—'}
          <div className="text-xs text-slate-500 tabular">{m.recipient_masked}</div>
        </Td>
        <Td className="hidden text-right tabular lg:table-cell">{formatVnd(m.remaining_vnd)}</Td>
        <Td className="whitespace-nowrap text-right">
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded}>
            {m.attempts.length} lần thử
          </Button>
          {canManage && ['FAILED', 'SKIPPED', 'SENT', 'CANCELLED'].includes(m.status) ? (
            <Button variant="outline" size="sm" onClick={onResend} disabled={busy}>
              <RotateCw className="size-3.5" aria-hidden />
              Gửi lại
            </Button>
          ) : null}
        </Td>
      </Tr>
      {expanded ? (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-4 py-2 text-xs">
            {m.attempts.length === 0 ? (
              'Chưa có lần thử.'
            ) : (
              <ul className="flex flex-col gap-1">
                {m.attempts.map((a, i) => (
                  <li key={i}>
                    {dateTime(a.attempted_at)} · {channelLabel(a.channel)} · {a.result === 'SUCCESS' ? 'Thành công' : `Lỗi ${a.error_code ?? ''}${a.error_message ? `: ${a.error_message}` : ''}`}
                    {a.manual ? ' · gửi lại thủ công' : ''}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function RemindersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RemindersContent />
    </Suspense>
  );
}
