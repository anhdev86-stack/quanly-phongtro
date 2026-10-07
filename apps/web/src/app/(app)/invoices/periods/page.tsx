'use client';

import { PERMISSIONS, type StatementPeriodDto } from '@ql-tro/shared';
import { Lock, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useMe } from '@/features/auth/api';
import { useCan } from '@/features/auth/permissions';
import { usePeriodAction, useStatementPeriods } from '@/features/billing/api';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError } from '@/lib/api-client';
import { todayLocal } from '@/lib/format';

const label = (p: string) => `${p.slice(5, 7)}/${p.slice(0, 4)}`;
const dateTime = (v: string) => new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

/**
 * Kỳ phát hành (V1.1, T36): đóng tháng đã qua khi không còn nháp → chặn tạo/sửa chứng từ và chỉ số của tháng đó. Thu tiền vào nợ cũ
 * vẫn làm bình thường. Mở lại cần quyền và lý do (có nhật ký).
 */
export default function PeriodsPage() {
  const can = useCan();
  const me = useMe();
  const toast = useToast();
  const periods = useStatementPeriods();
  const action = usePeriodAction();
  const [reopening, setReopening] = useState<StatementPeriodDto | null>(null);
  const allBuildings = me.data?.all_buildings ?? false;
  const canClose = can(PERMISSIONS.INVOICES_PUBLISH) && allBuildings;
  const canReopen = can(PERMISSIONS.PERIOD_REOPEN) && allBuildings;
  const currentMonth = todayLocal().slice(0, 7);

  const close = async (p: StatementPeriodDto) => {
    try {
      await action.mutateAsync({ id: p.id, action: 'close', body: { expected_version: p.version } });
      toast.success(`Đã đóng kỳ ${label(p.period)}.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không đóng được kỳ.');
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        back={{ href: '/invoices', label: 'Thông báo tiền phòng' }}
        title="Kỳ phát hành"
        description="Đóng tháng đã qua để không ai tạo/sửa thông báo hay chỉ số của tháng đó nữa. Thu tiền vào nợ cũ vẫn bình thường. Mở lại cần quyền và lý do."
      />
      {!allBuildings ? <p className="mb-3 text-sm text-slate-500">Đóng/mở kỳ áp dụng cho mọi tòa nên chỉ người có phạm vi mọi tòa thao tác được.</p> : null}
      <Card>
        {periods.isPending ? (
          <LoadingState />
        ) : periods.isError ? (
          <ErrorState error={periods.error} onRetry={() => void periods.refetch()} />
        ) : periods.data.length === 0 ? (
          <EmptyState title="Chưa có kỳ phát hành" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tháng</Th>
                <Th>Trạng thái</Th>
                <Th className="text-right">Nháp</Th>
                <Th className="text-right">Đã phát hành</Th>
                <Th className="text-right">
                  <span className="sr-only">Thao tác</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {periods.data.map((p) => (
                <Tr key={p.id} data-testid={`period-${p.period}`}>
                  <Td className="font-medium">{label(p.period)}</Td>
                  <Td>
                    {p.status === 'CLOSED' ? <Badge tone="gray">Đã đóng</Badge> : <Badge tone="green">Đang mở</Badge>}
                    <div className="text-xs text-slate-500">
                      {p.status === 'CLOSED' && p.closed_at ? `${dateTime(p.closed_at)}${p.closed_by_name ? ` · ${p.closed_by_name}` : ''}` : null}
                      {p.status === 'OPEN' && p.reopened_at ? `Mở lại ${dateTime(p.reopened_at)}: ${p.reopen_reason ?? ''}` : null}
                    </div>
                  </Td>
                  <Td className="text-right tabular">{p.draft_count}</Td>
                  <Td className="text-right tabular">{p.published_count}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {p.status === 'OPEN' && canClose && p.period < currentMonth ? (
                      <Button size="sm" variant="outline" disabled={action.isPending || p.draft_count > 0} title={p.draft_count > 0 ? 'Còn nháp chưa phát hành' : undefined} onClick={() => void close(p)}>
                        <Lock className="size-3.5" aria-hidden />
                        Đóng kỳ
                      </Button>
                    ) : null}
                    {p.status === 'CLOSED' && canReopen ? (
                      <Button size="sm" variant="outline" onClick={() => setReopening(p)}>
                        <LockOpen className="size-3.5" aria-hidden />
                        Mở lại
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ReasonDialog
        open={!!reopening}
        title={`Mở lại kỳ ${reopening ? label(reopening.period) : ''}`}
        description="Sau khi mở lại, có thể tạo/sửa chứng từ và chỉ số của tháng này. Lý do được ghi vào nhật ký."
        confirmLabel="Mở lại kỳ"
        pending={action.isPending}
        onClose={() => setReopening(null)}
        onConfirm={async (reason) => {
          if (!reopening) return;
          try {
            await action.mutateAsync({ id: reopening.id, action: 'reopen', body: { reason, expected_version: reopening.version } });
            toast.success(`Đã mở lại kỳ ${label(reopening.period)}.`);
            setReopening(null);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không mở lại được.');
          }
        }}
      />
    </div>
  );
}
