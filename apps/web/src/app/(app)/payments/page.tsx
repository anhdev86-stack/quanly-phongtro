'use client';

import { PAYMENT_METHOD_LABELS, POSTING_STATUS_LABELS } from '@ql-tro/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useDebts, usePayments } from '@/features/payments/api';
import { useBuildings } from '@/features/property/api';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';

function PaymentsContent() {
  const search = useSearchParams();
  const [tab, setTab] = useState<'debts' | 'payments'>(search.get('tab') === 'payments' ? 'payments' : 'debts');
  const buildings = useBuildings();
  const [buildingId, setBuildingId] = useState('');
  return (
    <>
      <PageHeader title="Thu tiền & Công nợ" description="Ghi nhận thu ở trang chi tiết thông báo (cạnh mã QR). Lần thuê đã kết thúc còn nợ vẫn hiện ở đây." />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-1" role="tablist">
          {(
            [
              ['debts', 'Công nợ'],
              ['payments', 'Phiếu thu'],
            ] as const
          ).map(([k, l]) => (
            <Button key={k} role="tab" aria-selected={tab === k} size="sm" variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>
              {l}
            </Button>
          ))}
        </div>
        <Field id="pay-building" label="Tòa" className="w-48">
          <Select id="pay-building" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            <option value="">Tất cả tòa</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {tab === 'debts' ? <DebtsTab buildingId={buildingId} /> : <PaymentsTab buildingId={buildingId} />}
    </>
  );
}

function DebtsTab({ buildingId }: { buildingId: string }) {
  const [f, setF] = useState({ overdue_only: '', q: '', page: 1, page_size: 50 });
  const debts = useDebts({ ...f, ...(buildingId ? { building_id: buildingId } : {}) });
  return (
    <>
      <FilterBar>
        <Field id="db-overdue" label="Lọc" className="sm:w-44">
          <Select id="db-overdue" value={f.overdue_only} onChange={(e) => setF({ ...f, overdue_only: e.target.value, page: 1 })}>
            <option value="">Tất cả còn nợ/credit</option>
            <option value="true">Chỉ quá hạn</option>
          </Select>
        </Field>
        <Field id="db-q" label="Tìm phòng, khách" className="sm:w-52">
          <TextInput id="db-q" type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} />
        </Field>
      </FilterBar>
      {debts.data ? (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['Còn phải thu', debts.data.totals.debt_vnd, ''],
            ['Trong đó quá hạn', debts.data.totals.overdue_vnd, 'text-red-700'],
            ['Credit còn lại (nợ khách)', debts.data.totals.credit_available_vnd, 'text-violet-700'],
          ].map(([l, v, c]) => (
            <Card key={l}>
              <CardContent>
                <p className="text-sm text-slate-500">{l}</p>
                <p className={`text-xl font-semibold tabular ${c}`}>{formatVnd(v!)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
      <Card>
        {debts.isPending ? (
          <LoadingState />
        ) : debts.isError ? (
          <ErrorState error={debts.error} onRetry={() => void debts.refetch()} />
        ) : debts.data.items.length === 0 ? (
          <EmptyState title="Không có công nợ" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Phòng / lần thuê</Th>
                <Th className="hidden sm:table-cell">Thông báo còn nợ</Th>
                <Th className="hidden md:table-cell">Hạn sớm nhất</Th>
                <Th className="text-right">Còn nợ</Th>
                <Th className="hidden text-right lg:table-cell">Quá hạn</Th>
                <Th className="hidden text-right lg:table-cell">Credit</Th>
              </tr>
            </thead>
            <tbody>
              {debts.data.items.map((d) => (
                <Tr key={d.tenancy_id}>
                  <Td>
                    <Link href={`/tenancies/${d.tenancy_id}#statement`} className="text-brand-800 hover:underline">
                      {d.building_code} · {d.room_code}
                    </Link>
                    {d.tenancy_status === 'ENDED' ? (
                      <Badge tone="gray" className="ml-1">
                        Đã trả phòng
                      </Badge>
                    ) : null}
                    <div className="text-xs text-slate-500">{d.primary_tenant_name ?? '—'}</div>
                  </Td>
                  <Td className="hidden sm:table-cell">{d.open_invoices}</Td>
                  <Td className="hidden tabular md:table-cell">{d.oldest_due_date ? formatBusinessDate(d.oldest_due_date) : '—'}</Td>
                  <Td className="text-right tabular font-medium">{formatVnd(d.debt_vnd)}</Td>
                  <Td className={`hidden text-right tabular lg:table-cell ${d.overdue_vnd !== '0' ? 'text-red-700' : ''}`}>{formatVnd(d.overdue_vnd)}</Td>
                  <Td className="hidden text-right tabular lg:table-cell">{formatVnd(d.credit_available_vnd)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {debts.data ? (
          <div className="px-3 pb-3">
            <Pagination page={f.page} pageSize={f.page_size} total={debts.data.total} onPage={(page) => setF({ ...f, page })} />
          </div>
        ) : null}
      </Card>
    </>
  );
}

function PaymentsTab({ buildingId }: { buildingId: string }) {
  const [f, setF] = useState({ from: `${todayLocal().slice(0, 7)}-01`, to: todayLocal(), status: '', page: 1, page_size: 50 });
  const list = usePayments({ ...f, ...(buildingId ? { building_id: buildingId } : {}) });
  const total = (list.data?.items ?? []).filter((p) => p.status === 'POSTED').reduce((s, p) => s + BigInt(p.amount_vnd), 0n);
  return (
    <>
      <FilterBar>
        <Field id="pt-from" label="Từ ngày" className="sm:w-40">
          <TextInput id="pt-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} />
        </Field>
        <Field id="pt-to" label="Đến ngày" className="sm:w-40">
          <TextInput id="pt-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} />
        </Field>
        <Field id="pt-status" label="Trạng thái" className="sm:w-36">
          <Select id="pt-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>
            <option value="">Tất cả</option>
            {Object.entries(POSTING_STATUS_LABELS).map(([k, l]) => (
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
          <EmptyState title="Chưa có phiếu thu trong khoảng này" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Phiếu thu</Th>
                <Th>Phòng</Th>
                <Th className="hidden md:table-cell">Phương thức</Th>
                <Th className="text-right">Số tiền</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <Tr key={p.id} className={p.status === 'REVERSED' ? 'opacity-60' : ''}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/print/payments/${p.id}`} target="_blank" className="font-medium text-brand-800 hover:underline">
                      {p.number}
                    </Link>
                    <div className="text-xs text-slate-500">{formatBusinessDate(p.paid_at)}</div>
                    {p.status === 'REVERSED' ? <Badge tone="gray">Đã đảo</Badge> : null}
                  </Td>
                  <Td>
                    {p.building_code} · {p.room_code}
                    <div className="text-xs text-slate-500">
                      {p.allocations.map((a) => (
                        <Link key={a.invoice_id} href={`/invoices/${a.invoice_id}`} className="mr-1 hover:underline">
                          {a.invoice_number}
                        </Link>
                      ))}
                    </div>
                  </Td>
                  <Td className="hidden md:table-cell">
                    {PAYMENT_METHOD_LABELS[p.method]}
                    {p.reference ? <div className="text-xs text-slate-500">{p.reference}</div> : null}
                  </Td>
                  <Td className="text-right tabular">{formatVnd(p.amount_vnd)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data ? (
          <CardContent className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 text-sm">
            <span>
              Tổng đã thu (trang này, trừ phiếu đã đảo): <strong className="tabular">{formatVnd(total)}</strong>
            </span>
            <Pagination page={f.page} pageSize={f.page_size} total={list.data.total} onPage={(page) => setF({ ...f, page })} />
          </CardContent>
        ) : null}
      </Card>
    </>
  );
}

export default function PaymentsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<LoadingState />}>
        <PaymentsContent />
      </Suspense>
    </div>
  );
}
