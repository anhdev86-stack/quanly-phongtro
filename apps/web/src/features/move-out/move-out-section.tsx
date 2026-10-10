'use client';

import { FINANCIAL_STATUS_LABELS, NOTICE_STATUS_LABELS, PERMISSIONS, SETTLEMENT_STATUS_LABELS, type TenancyDetail } from '@ql-tro/shared';
import { DoorOpen, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError } from '@/lib/api-client';
import { endOfMonth, formatBusinessDate, todayLocal } from '@/lib/format';
import { useMoveOutAction, useNotices, useTenancySettlements } from './api';

/** Nút ở đầu trang lần thuê: báo trả, hủy báo trả, trả phòng (MASTER_PLAN 7.5, 7.6). */
export function MoveOutHeaderActions({ tenancy }: { tenancy: TenancyDetail }) {
  const can = useCan();
  const toast = useToast();
  const notices = useNotices(tenancy.id);
  const action = useMoveOutAction<unknown>();
  const [noticing, setNoticing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  if (tenancy.status === 'ENDED' || !can(PERMISSIONS.SETTLEMENT_MANAGE)) return null;
  const active = notices.data?.find((n) => n.status === 'ACTIVE');
  return (
    <div className="flex flex-wrap gap-2">
      {tenancy.status === 'ACTIVE' ? (
        <Button size="sm" variant="outline" onClick={() => setNoticing(true)}>
          <LogOut className="size-4" aria-hidden />
          Báo trả phòng
        </Button>
      ) : null}
      {active && tenancy.status === 'NOTICE_GIVEN' ? (
        <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>
          Hủy báo trả
        </Button>
      ) : null}
      <Link href={`/tenancies/${tenancy.id}/move-out`} className={buttonVariants({ size: 'sm' })}>
        <DoorOpen className="size-4" aria-hidden />
        Trả phòng
      </Link>
      <Dialog open={noticing} onClose={() => setNoticing(false)} title="Báo trả phòng" description="Phòng vẫn đang thuê và vẫn tính phí cho tới khi khách bàn giao thực tế.">
        {noticing ? <NoticeForm tenancy={tenancy} onClose={() => setNoticing(false)} /> : null}
      </Dialog>
      <ReasonDialog
        open={cancelling}
        title="Hủy báo trả"
        description="Lần thuê quay lại đang thuê. Lượt giữ phòng của khách mới (nếu có) không tự hủy mà hiện “xung đột lịch” để bạn xử lý."
        confirmLabel="Hủy báo trả"
        pending={action.isPending}
        onClose={() => setCancelling(false)}
        onConfirm={async (reason) => {
          if (!active) return;
          try {
            await action.mutateAsync({ path: `/move-out-notices/${active.id}/cancel`, body: { reason } });
            toast.success('Đã hủy báo trả.');
            setCancelling(false);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không hủy được.');
          }
        }}
      />
    </div>
  );
}

function NoticeForm({ tenancy, onClose }: { tenancy: TenancyDetail; onClose: () => void }) {
  const toast = useToast();
  const action = useMoveOutAction<unknown>();
  const today = todayLocal();
  // D-046: khách báo trả thì dọn đi trước tháng mới — mặc định dự kiến ở hết tháng này.
  const [v, setV] = useState({ notice_date: today, planned_last_charge_date: endOfMonth(today), reason: '' });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const submit = async () => {
    setError('');
    setFe({});
    try {
      await action.mutateAsync({ path: `/tenancies/${tenancy.id}/move-out-notices`, body: { ...v, reason: v.reason.trim() || null, expected_version: tenancy.version } });
      toast.success(`Đã ghi báo trả, dự kiến trả hết ngày ${formatBusinessDate(v.planned_last_charge_date)}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFe(e.fieldErrors ?? {});
      } else setError('Không ghi được.');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <p className="text-sm text-slate-600">Thỏa thuận báo trước {tenancy.notice_days} ngày.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="nt-date" label="Ngày báo" required error={fe.notice_date?.[0]} hint="Ghi lùi ngày cần quyền và lý do.">
          <TextInput id="nt-date" type="date" max={today} value={v.notice_date} onChange={(e) => setV({ ...v, notice_date: e.target.value })} />
        </Field>
        <Field id="nt-planned" label="Dự kiến ở hết ngày" required error={fe.planned_last_charge_date?.[0]} hint="Mặc định hết tháng: tiền phòng thu theo tháng, dọn đi sớm không hoàn theo ngày.">
          <TextInput id="nt-planned" type="date" value={v.planned_last_charge_date} onChange={(e) => setV({ ...v, planned_last_charge_date: e.target.value })} />
        </Field>
        <Field id="nt-reason" label="Ghi chú / lý do" className="sm:col-span-2" error={fe.reason?.[0]}>
          <Textarea id="nt-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending}>
          Ghi báo trả
        </Button>
      </div>
    </div>
  );
}

/** Báo trả và quyết toán của lần thuê (lịch sử). */
export function MoveOutSection({ tenancy }: { tenancy: TenancyDetail }) {
  const notices = useNotices(tenancy.id);
  const settlements = useTenancySettlements(tenancy.id);
  const items = notices.data ?? [];
  const sts = settlements.data ?? [];
  if (!items.length && !sts.length) return null;
  const active = items.find((n) => n.status === 'ACTIVE');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Báo trả & trả phòng</CardTitle>
      </CardHeader>
      {active ? (
        <CardContent className="border-b border-amber-200 bg-amber-50 text-sm text-amber-900" role="status">
          Khách đã báo trả ngày {formatBusinessDate(active.notice_date)}, dự kiến ở hết ngày {formatBusinessDate(active.planned_last_charge_date)}. Phòng vẫn đang thuê và tính phí tới khi bàn giao thực tế.
          {active.short_notice_days > 0 ? ` Báo trước thiếu ${active.short_notice_days} ngày so với thỏa thuận.` : ''}
        </CardContent>
      ) : null}
      <CardContent className="flex flex-col gap-2 text-sm">
        {sts.map((s) => (
          <p key={s.id} className="flex flex-wrap items-center gap-2">
            <Link href={`/settlements/${s.id}`} className="font-medium text-brand-600 hover:underline">
              Quyết toán {s.code}
            </Link>
            <Badge tone={s.status === 'COMPLETED' ? 'green' : s.status === 'CANCELLED' ? 'gray' : 'amber'}>{SETTLEMENT_STATUS_LABELS[s.status]}</Badge>
            {s.status === 'COMPLETED' ? <Badge tone={s.current.financial_status === 'BALANCED' ? 'green' : 'violet'}>{FINANCIAL_STATUS_LABELS[s.current.financial_status]}</Badge> : null}
            <span className="text-slate-500">ngày cuối {formatBusinessDate(s.last_charge_date)}</span>
          </p>
        ))}
        {items
          .filter((n) => n.status !== 'ACTIVE')
          .map((n) => (
            <p key={n.id} className="text-slate-600">
              Báo trả {formatBusinessDate(n.notice_date)} → {formatBusinessDate(n.planned_last_charge_date)} · {NOTICE_STATUS_LABELS[n.status]}
              {n.cancel_reason ? ` (${n.cancel_reason})` : ''}
            </p>
          ))}
      </CardContent>
    </Card>
  );
}
