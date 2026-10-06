'use client';

import { PERMISSIONS } from '@ql-tro/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useCan } from '@/features/auth/permissions';
import { useTenants } from '@/features/tenancy/api';
import { TenantDialog } from '@/features/tenancy/tenant-dialog';

export default function TenantsPage() {
  const can = useCan();
  const [filters, setFilters] = useState({ q: '', page: 1, page_size: 30 });
  const [creating, setCreating] = useState(false);
  const list = useTenants({ ...filters, q: filters.q.trim() || undefined });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Người thuê"
        actions={
          can(PERMISSIONS.TENANTS_MANAGE) ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              Thêm người thuê
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <Field id="tn-q" label="Tìm theo tên, số điện thoại" className="sm:w-80">
          <TextInput id="tn-q" type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })} />
        </Field>
      </FilterBar>
      <Card>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Không có người thuê phù hợp" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Họ tên</Th>
                <Th>Số điện thoại</Th>
                <Th className="hidden sm:table-cell">CCCD</Th>
                <Th>Đang ở</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-medium">
                    <Link href={`/tenants/${t.id}`} className="text-brand-800 hover:underline">
                      {t.full_name}
                    </Link>
                  </Td>
                  <Td>{t.phone ?? '—'}</Td>
                  <Td className="hidden tabular sm:table-cell">{t.identity_number ?? '—'}</Td>
                  <Td>{t.current_room ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data ? (
          <div className="px-3 pb-3">
            <Pagination page={filters.page} pageSize={filters.page_size} total={list.data.total} onPage={(page) => setFilters({ ...filters, page })} />
          </div>
        ) : null}
      </Card>
      <TenantDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
