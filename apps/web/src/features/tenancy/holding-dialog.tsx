'use client';

import { PERMISSIONS, type Reservation } from '@ql-tro/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useCan } from '@/features/auth/permissions';
import { formatVnd } from '@/lib/format';
import { useHoldingLedger } from './api';
import { LedgerTable, LedgerTxDialog } from './ledger';

/** Sổ tiền giữ chỗ của một lượt giữ phòng: xem, ghi nhận, hoàn, giữ lại theo thỏa thuận, đảo. */
export function HoldingDialog({ reservation, onClose }: { reservation: Reservation | null; onClose: () => void }) {
  return (
    <Dialog open={!!reservation} onClose={onClose} title={reservation ? `Tiền giữ chỗ — ${reservation.contact_name}` : ''} size="xl">
      {reservation ? <HoldingContent reservation={reservation} /> : null}
    </Dialog>
  );
}

function HoldingContent({ reservation }: { reservation: Reservation }) {
  const can = useCan();
  const ledger = useHoldingLedger(reservation.id);
  const [recording, setRecording] = useState(false);
  const allowed = [
    ...(can(PERMISSIONS.HOLDING_RECORD) && reservation.status === 'ACTIVE' ? ['RECEIVED'] : []),
    ...(can(PERMISSIONS.HOLDING_REFUND) ? ['REFUND'] : []),
    ...(can(PERMISSIONS.HOLDING_FORFEIT) ? ['FORFEIT'] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Số dư đang giữ: <strong className="tabular">{formatVnd(ledger.data?.balance_vnd ?? reservation.holding_balance_vnd)}</strong>
          {reservation.status === 'CANCELLED' && (ledger.data?.balance_vnd ?? '0') !== '0' ? (
            <span className="ml-2 text-amber-800">Lượt giữ đã hủy — số dư chờ hoàn hoặc giữ lại theo thỏa thuận (không tự mất).</span>
          ) : null}
        </p>
        {allowed.length ? (
          <Button size="sm" variant="outline" onClick={() => setRecording(true)}>
            <Plus className="size-4" aria-hidden />
            Ghi giao dịch
          </Button>
        ) : null}
      </div>
      {ledger.data ? <LedgerTable kind="holding" txs={ledger.data.transactions} canReverse={can(PERMISSIONS.FINANCE_REVERSE)} /> : <LoadingState />}
      <LedgerTxDialog open={recording} onClose={() => setRecording(false)} kind="holding" path={`/reservations/${reservation.id}/holding-transactions`} allowed={allowed} />
    </div>
  );
}
