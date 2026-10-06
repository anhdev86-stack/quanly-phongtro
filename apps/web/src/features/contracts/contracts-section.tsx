'use client';

import { type ContractCancelResult, type ContractDto, PERMISSIONS, type TenancyDetail } from '@ql-tro/shared';
import { FilePlus2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate } from '@/lib/format';
import { useContractAction, useTenancyContracts } from './api';
import { ContractFormDialog, SignContractDialog } from './contract-dialogs';
import { ContractTable } from './contract-table';

/** Số ngày trước khi hết hạn bắt đầu nhắc gia hạn ở trang lần thuê. */
const EXPIRY_WARNING_DAYS = 30;

/** Kỳ đã ký mới nhất (theo ngày bắt đầu) — gốc để gia hạn. */
function latestSigned(items: ContractDto[]): ContractDto | null {
  return items.filter((c) => c.lifecycle === 'SIGNED').sort((a, b) => (a.term_start < b.term_start ? 1 : -1))[0] ?? null;
}

export function ContractsSection({ tenancy }: { tenancy: TenancyDetail }) {
  const can = useCan();
  const toast = useToast();
  const list = useTenancyContracts(tenancy.id);
  const action = useContractAction<ContractCancelResult>();
  const [form, setForm] = useState<{ renewFrom: ContractDto | null } | null>(null);
  const [signing, setSigning] = useState<ContractDto | null>(null);
  const [cancelling, setCancelling] = useState<ContractDto | null>(null);
  const manage = can(PERMISSIONS.CONTRACTS_MANAGE) && tenancy.status !== 'ENDED';

  const items = list.data?.items ?? [];
  const latest = latestSigned(items);
  const active = items.find((c) => c.status === 'ACTIVE');
  const hasScheduled = items.some((c) => c.status === 'SCHEDULED');

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Hợp đồng</CardTitle>
        {manage ? (
          <div className="flex gap-2">
            {latest ? (
              <Button size="sm" variant="outline" onClick={() => setForm({ renewFrom: latest })}>
                <RefreshCw className="size-4" aria-hidden />
                Gia hạn
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setForm({ renewFrom: null })}>
              <FilePlus2 className="size-4" aria-hidden />
              Tạo hợp đồng
            </Button>
          </div>
        ) : null}
      </CardHeader>

      {tenancy.status !== 'ENDED' && tenancy.rental_mode === 'MONTH_TO_MONTH' && latest && latest.status === 'EXPIRED' && !hasScheduled ? (
        <CardContent className="border-b border-amber-200 bg-amber-50 text-sm text-amber-900" role="status">
          Đã hết thời hạn hợp đồng (từ {formatBusinessDate(latest.term_end)}) — đang tiếp tục thuê theo tháng. Phòng vẫn đang thuê, cọc giữ nguyên.
        </CardContent>
      ) : null}
      {active && !hasScheduled && active.days_to_expiry !== null && active.days_to_expiry <= EXPIRY_WARNING_DAYS ? (
        <CardContent className="border-b border-amber-200 bg-amber-50 text-sm text-amber-900" role="status">
          Hợp đồng {active.code} hết hạn ngày {formatBusinessDate(active.term_end)} (còn {active.days_to_expiry} ngày). Gia hạn hoặc để khách tiếp tục thuê theo tháng.
        </CardContent>
      ) : null}

      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có hợp đồng">Lần thuê đang là thuê theo tháng.</EmptyState>
      ) : (
        <ContractTable items={items} actions={manage ? { onSign: setSigning, onCancel: setCancelling } : {}} />
      )}

      <ContractFormDialog open={!!form} onClose={() => setForm(null)} tenancy={tenancy} renewFrom={form?.renewFrom ?? null} />
      <SignContractDialog contract={signing} onClose={() => setSigning(null)} currentRent={tenancy.current_rent_vnd} />
      <ReasonDialog
        open={!!cancelling}
        title={`Hủy hợp đồng ${cancelling?.code ?? ''}`}
        description={
          cancelling?.status === 'SCHEDULED'
            ? 'Hợp đồng đã ký nhưng chưa bắt đầu. Giá thuê và dịch vụ tạo từ hợp đồng này sẽ bị vô hiệu hóa; mức cọc yêu cầu quay về mức trước đó. Thay đổi giá độc lập giữ nguyên.'
            : 'Hủy bản nháp. Không ảnh hưởng giá thuê hay cọc.'
        }
        confirmLabel="Hủy hợp đồng"
        pending={action.isPending}
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          try {
            const res = await action.mutateAsync({ path: `/contracts/${cancelling.id}/cancel`, body: { reason, expected_version: cancelling.version } });
            const voided = res.voided_rent_price_ids.length + res.voided_service_ids.length;
            toast.success(`Đã hủy ${res.code}${voided ? `; vô hiệu hóa ${voided} mục giá/dịch vụ phụ thuộc` : ''}.`);
            setCancelling(null);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không hủy được.');
          }
        }}
      />
    </Card>
  );
}
