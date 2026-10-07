'use client';

import type { ContractAlertDto, Paged } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api-client';
import { useApiMutation } from '@/lib/query';
import { formatBusinessDate } from '@/lib/format';
import { contractKeys } from './api';

const alertKey = [...contractKeys.all, 'alerts'] as const;

export const useContractAlerts = () =>
  useQuery({ queryKey: alertKey, queryFn: ({ signal }) => api<Paged<ContractAlertDto>>('/contract-alerts?page_size=100', { signal }) });

/** Cảnh báo hợp đồng sắp hết hạn theo mốc 30/15/7 ngày (V1.1). Không hiện gì khi không có cảnh báo. */
export function ContractAlertsCard() {
  const toast = useToast();
  const alerts = useContractAlerts();
  const ack = useApiMutation<string, ContractAlertDto>((id) => ({ path: `/contract-alerts/${id}/ack`, method: 'POST', body: {} }), [alertKey]);
  if (!alerts.data?.items.length) return null;
  return (
    <Card className="mb-4 border-amber-200" data-testid="contract-alerts">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4 text-amber-600" aria-hidden />
          Hợp đồng sắp hết hạn ({alerts.data.total})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-slate-100 text-sm">
          {alerts.data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <Badge tone={a.milestone_days <= 7 ? 'red' : 'amber'}>Mốc {a.milestone_days} ngày</Badge>{' '}
                <Link href={`/tenancies/${a.tenancy_id}`} className="font-medium text-brand-800 hover:underline">
                  {a.building_code} · {a.room_code}
                </Link>{' '}
                — {a.contract_code}, {a.primary_tenant_name ?? '—'}, hết hạn {formatBusinessDate(a.term_end)} (còn {a.days_to_expiry} ngày)
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={ack.isPending}
                onClick={async () => {
                  try {
                    await ack.mutateAsync(a.id);
                    toast.success('Đã đánh dấu đã xử lý.');
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : 'Không lưu được.');
                  }
                }}
              >
                Đã xử lý
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Gia hạn hợp đồng thì cảnh báo tự hết. Không gia hạn: khách tiếp tục thuê theo tháng sau ngày hết hạn.</p>
      </CardContent>
    </Card>
  );
}
