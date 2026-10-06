'use client';

import type { TenancyDetail } from '@ql-tro/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { useInvoices } from './api';
import { InvoiceTable } from './invoice-table';

/** Thông báo tiền phòng của lần thuê (kể cả nháp và chứng từ điều chỉnh). */
export function TenancyInvoicesSection({ tenancy }: { tenancy: TenancyDetail }) {
  const list = useInvoices({ tenancy_id: tenancy.id, page: 1, page_size: 100 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông báo tiền phòng</CardTitle>
      </CardHeader>
      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="Chưa có thông báo" />
      ) : (
        <InvoiceTable items={list.data.items} showRoom={false} />
      )}
    </Card>
  );
}
