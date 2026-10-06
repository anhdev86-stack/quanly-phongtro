'use client';

import { PERMISSIONS, type Reservation } from '@ql-tro/shared';
import { AlertTriangle, CalendarClock, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { ReasonDialog, ReservationRescheduleDialog, useCancelReservationAction } from './reservation-forms';
import { ReservationStatusBadge } from './status';

export function ReservationTable({ items, showRoom = true }: { items: Reservation[]; showRoom?: boolean }) {
  const can = useCan();
  const toast = useToast();
  const cancel = useCancelReservationAction();
  const [rescheduling, setRescheduling] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const canManage = can(PERMISSIONS.RESERVATIONS_MANAGE);

  return (
    <>
      <Table>
        <thead>
          <tr>
            {showRoom ? <Th>Phòng</Th> : null}
            <Th>Người giữ chỗ</Th>
            <Th>Giữ từ</Th>
            <Th>Dự kiến nhận</Th>
            <Th>Giữ đến</Th>
            <Th>Trạng thái</Th>
            <Th className="text-right">Tiền giữ chỗ</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <Tr key={r.id}>
              {showRoom ? (
                <Td className="font-semibold whitespace-nowrap">
                  <Link href={`/rooms/${r.room_id}`} className="text-brand-800 hover:underline">
                    {r.building_code} · {r.room_code}
                  </Link>
                </Td>
              ) : null}
              <Td>
                {r.contact_name}
                {r.contact_phone ? <div className="text-xs text-slate-500">{r.contact_phone}</div> : null}
              </Td>
              <Td className="tabular whitespace-nowrap">{formatBusinessDate(r.hold_from)}</Td>
              <Td className="tabular whitespace-nowrap">{formatBusinessDate(r.expected_move_in)}</Td>
              <Td className="tabular whitespace-nowrap">{formatBusinessDate(r.hold_until)}</Td>
              <Td>
                <span className="inline-flex flex-wrap gap-1">
                  <ReservationStatusBadge status={r.display_status} />
                  {r.schedule_conflict ? (
                    <Badge tone="red">
                      <AlertTriangle className="size-3" aria-hidden />
                      Xung đột lịch
                    </Badge>
                  ) : null}
                </span>
                {r.cancelled_reason ? <div className="mt-1 text-xs text-slate-500">Lý do: {r.cancelled_reason}</div> : null}
              </Td>
              <Td className="text-right tabular">{r.holding_balance_vnd === '0' ? '—' : formatVnd(r.holding_balance_vnd)}</Td>
              <Td className="text-right whitespace-nowrap">
                {canManage && r.status === 'ACTIVE' ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setRescheduling(r)} aria-label="Đổi lịch">
                      <CalendarClock className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setCancelling(r)} aria-label="Hủy giữ phòng">
                      <XCircle className="size-4 text-red-600" />
                    </Button>
                  </>
                ) : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <ReservationRescheduleDialog reservation={rescheduling} onClose={() => setRescheduling(null)} />
      <ReasonDialog
        open={!!cancelling}
        title="Hủy giữ phòng"
        description="Tiền giữ chỗ (nếu có) không tự mất; số dư vẫn được giữ và chờ xử lý hoàn hoặc giữ lại theo thỏa thuận."
        confirmLabel="Hủy giữ phòng"
        pending={cancel.pending}
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          try {
            await cancel.run(cancelling, reason);
            setCancelling(null);
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : 'Không hủy được.');
            throw e;
          }
        }}
      />
    </>
  );
}
