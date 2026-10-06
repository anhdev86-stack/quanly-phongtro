'use client';

import { FINANCIAL_STATUS_LABELS, SETTLEMENT_STATUS_LABELS } from '@ql-tro/shared';
import Link from 'next/link';
import { useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useSettlements } from '@/features/move-out/api';
import { formatBusinessDate, formatVnd } from '@/lib/format';

export default function MoveOutsPage() {
  const [f, setF] = useState({ status: '', financial_status: '', page: 1, page_size: 50 });
  const list = useSettlements(f);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Cọc & Trả phòng"
        description="Bắt đầu trả phòng từ trang lần thuê. Quyết toán đã hoàn tất vẫn hiện ở đây khi còn khoản phải thu hoặc phải hoàn."
      />
      <FilterBar>
        <Field id="mo-status" label="Trạng thái" className="sm:w-44">
          <Select id="mo-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>
            <option value="">Tất cả</option>
            {Object.entries(SETTLEMENT_STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="mo-fin" label="Tình trạng tiền" className="sm:w-48">
          <Select id="mo-fin" value={f.financial_status} onChange={(e) => setF({ ...f, financial_status: e.target.value, page: 1 })}>
            <option value="">Tất cả</option>
            {Object.entries(FINANCIAL_STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
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
          <EmptyState title="Chưa có quyết toán" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quyết toán</Th>
                <Th>Phòng</Th>
                <Th className="hidden sm:table-cell">Ngày cuối</Th>
                <Th>Trạng thái</Th>
                <Th className="hidden text-right md:table-cell">Còn nợ / phải hoàn</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/settlements/${s.id}`} className="font-medium text-brand-800 hover:underline">
                      {s.code}
                    </Link>
                  </Td>
                  <Td>
                    {s.building_code} · {s.room_code}
                    <div className="text-xs text-slate-500">{s.primary_tenant_name ?? '—'}</div>
                  </Td>
                  <Td className="hidden tabular sm:table-cell">{formatBusinessDate(s.last_charge_date)}</Td>
                  <Td>
                    <Badge tone={s.status === 'COMPLETED' ? 'green' : s.status === 'CANCELLED' ? 'gray' : 'amber'}>{SETTLEMENT_STATUS_LABELS[s.status]}</Badge>{' '}
                    {s.status === 'COMPLETED' ? <Badge tone={s.current.financial_status === 'BALANCED' ? 'green' : 'violet'}>{FINANCIAL_STATUS_LABELS[s.current.financial_status]}</Badge> : null}
                  </Td>
                  <Td className="hidden text-right tabular md:table-cell">
                    {s.status === 'COMPLETED'
                      ? [
                          s.current.receivable_vnd !== '0' ? `nợ ${formatVnd(s.current.receivable_vnd)}` : null,
                          s.current.credit_refund_payable_vnd !== '0' ? `hoàn dư ${formatVnd(s.current.credit_refund_payable_vnd)}` : null,
                          s.current.deposit_refund_payable_vnd !== '0' ? `hoàn cọc ${formatVnd(s.current.deposit_refund_payable_vnd)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'
                      : '—'}
                  </Td>
                </Tr>
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
    </div>
  );
}
