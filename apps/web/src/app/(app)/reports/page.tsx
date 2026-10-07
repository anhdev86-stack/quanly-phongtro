'use client';

import { PAYMENT_METHOD_LABELS, TENANCY_STATUS_LABELS } from '@ql-tro/shared';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FilterBar, PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useDebts } from '@/features/payments/api';
import { useBuildings } from '@/features/property/api';
import { exportUrl, useCollections, useDepositsReport, useRevenue } from '@/features/reports/api';
import { BreakdownTab, CashFlowTab, OccupancyTab, OperatingTab } from '@/features/reports/finance-tabs';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';

type Tab = 'revenue' | 'debts' | 'deposits' | 'collections' | 'breakdown' | 'cashflow' | 'occupancy' | 'operating';
const TABS: [Tab, string][] = [
  ['revenue', 'Doanh thu theo tháng'],
  ['breakdown', 'Doanh thu theo khoản/tòa/phòng'],
  ['operating', 'Chi phí & thu nhập vận hành'],
  ['cashflow', 'Dòng tiền'],
  ['occupancy', 'Lấp đầy'],
  ['debts', 'Công nợ'],
  ['deposits', 'Cọc'],
  ['collections', 'Thu tiền'],
];

const v = (x: string) => formatVnd(x);
const monthsAgo = (n: number) => {
  const [y, m] = todayLocal().split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

function CsvLink({ type, filters }: { type: string; filters: Record<string, string | undefined> }) {
  return (
    <a href={exportUrl(type, filters)} className={buttonVariants({ size: 'sm', variant: 'outline' })} download>
      <Download className="size-4" aria-hidden />
      Xuất CSV
    </a>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue');
  const buildings = useBuildings();
  const [buildingId, setBuildingId] = useState('');
  const b = buildingId || undefined;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Báo cáo" description="Số liệu theo phạm vi tòa của bạn. Cọc và tiền giữ chỗ không tính vào doanh thu. Báo cáo kê khai thuế: chờ chủ trọ xác nhận mẫu." />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map(([k, l]) => (
            <Button key={k} role="tab" aria-selected={tab === k} size="sm" variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>
              {l}
            </Button>
          ))}
        </div>
        <Field id="rp-building" label="Tòa" className="w-48">
          <Select id="rp-building" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
            <option value="">Tất cả tòa</option>
            {buildings.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} — {x.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {tab === 'revenue' ? (
        <RevenueTab buildingId={b} />
      ) : tab === 'breakdown' ? (
        <BreakdownTab buildingId={b} />
      ) : tab === 'operating' ? (
        <OperatingTab buildingId={b} />
      ) : tab === 'cashflow' ? (
        <CashFlowTab buildingId={b} />
      ) : tab === 'occupancy' ? (
        <OccupancyTab buildingId={b} />
      ) : tab === 'debts' ? (
        <DebtsTab buildingId={b} />
      ) : tab === 'deposits' ? (
        <DepositsTab buildingId={b} />
      ) : (
        <CollectionsTab buildingId={b} />
      )}
    </div>
  );
}

function RevenueTab({ buildingId }: { buildingId?: string }) {
  const [f, setF] = useState({ from: monthsAgo(11), to: monthsAgo(0) });
  const q = useRevenue({ ...f, building_id: buildingId });
  const filters = { ...f, building_id: buildingId };
  return (
    <>
      <FilterBar>
        <Field id="rv-from" label="Từ tháng" className="sm:w-40">
          <TextInput id="rv-from" type="month" value={f.from} onChange={(e) => e.target.value && setF({ ...f, from: e.target.value })} />
        </Field>
        <Field id="rv-to" label="Đến tháng" className="sm:w-40">
          <TextInput id="rv-to" type="month" value={f.to} onChange={(e) => e.target.value && setF({ ...f, to: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <CsvLink type="revenue-monthly" filters={filters} />
        </div>
      </FilterBar>
      <Card>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Tháng</Th>
                  <Th className="text-right">Phát sinh</Th>
                  <Th className="text-right">Giảm trừ</Th>
                  <Th className="text-right">Doanh thu thuần</Th>
                  <Th className="text-right">Đã thu</Th>
                  <Th className="hidden text-right lg:table-cell">· tiền</Th>
                  <Th className="hidden text-right lg:table-cell">· trừ cọc</Th>
                  <Th className="hidden text-right lg:table-cell">· cấn trừ</Th>
                  <Th className="text-right">Còn nợ</Th>
                  <Th className="text-right">Thực thu trong tháng</Th>
                </tr>
              </thead>
              <tbody>
                {[...q.data.rows.map((r) => ({ label: `${r.period.slice(5)}/${r.period.slice(0, 4)}`, r, total: false })), { label: 'Tổng', r: q.data.totals, total: true }].map(({ label, r, total }) => (
                  <Tr key={label} className={total ? 'bg-slate-50 font-semibold' : ''}>
                    <Td className="whitespace-nowrap">{label}</Td>
                    <Td className="text-right tabular">{v(r.invoiced_vnd)}</Td>
                    <Td className="text-right tabular">{v(r.reductions_vnd)}</Td>
                    <Td className="text-right tabular">{v(r.net_vnd)}</Td>
                    <Td className="text-right tabular">{v(r.paid_total_vnd)}</Td>
                    <Td className="hidden text-right tabular text-slate-500 lg:table-cell">{v(r.paid_cash_vnd)}</Td>
                    <Td className="hidden text-right tabular text-slate-500 lg:table-cell">{v(r.paid_deposit_vnd)}</Td>
                    <Td className="hidden text-right tabular text-slate-500 lg:table-cell">{v(r.paid_credit_vnd)}</Td>
                    <Td className={`text-right tabular ${r.outstanding_vnd !== '0' ? 'text-red-700' : ''}`}>{v(r.outstanding_vnd)}</Td>
                    <Td className="text-right tabular text-emerald-700">{v(r.cash_in_period_vnd)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <CardContent className="border-t border-slate-100 text-xs text-slate-500">
          <p>
            <strong>Phát sinh</strong>: tổng thông báo loại nợ đã phát hành của tháng (thông báo không có tháng phát hành — trả phòng, điều chỉnh — tính theo tháng của ngày lập).{' '}
            <strong>Giảm trừ</strong>: chứng từ credit của tháng. Luôn có <strong>Phát sinh = Đã thu + Còn nợ</strong>.
          </p>
          <p className="mt-1">
            <strong>Đã thu</strong> tính theo tháng của thông báo (gồm cả tiền nhận ở tháng sau); <strong>Thực thu trong tháng</strong> tính theo ngày nhận tiền của mọi phiếu thu (dòng tiền).
            Credit đã cấn trừ nằm trong “Đã thu” của thông báo nhận cấn trừ và trong “Giảm trừ” của tháng phát hành credit.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function DebtsTab({ buildingId }: { buildingId?: string }) {
  const [overdue, setOverdue] = useState('');
  const q = useDebts({ building_id: buildingId, overdue_only: overdue || undefined, page: 1, page_size: 100 });
  return (
    <>
      <FilterBar>
        <Field id="rd-overdue" label="Lọc" className="sm:w-44">
          <Select id="rd-overdue" value={overdue} onChange={(e) => setOverdue(e.target.value)}>
            <option value="">Tất cả</option>
            <option value="true">Chỉ quá hạn</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <CsvLink type="debts" filters={{ building_id: buildingId, overdue_only: overdue || undefined }} />
        </div>
      </FilterBar>
      <Card>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState title="Không có công nợ" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Phòng</Th>
                <Th className="hidden sm:table-cell">Trạng thái</Th>
                <Th className="text-right">Còn nợ</Th>
                <Th className="text-right">Quá hạn</Th>
                <Th className="hidden text-right md:table-cell">Credit</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((d) => (
                <Tr key={d.tenancy_id}>
                  <Td>
                    <Link href={`/tenancies/${d.tenancy_id}#statement`} className="text-brand-800 hover:underline">
                      {d.building_code} · {d.room_code}
                    </Link>
                    <div className="text-xs text-slate-500">{d.primary_tenant_name}</div>
                  </Td>
                  <Td className="hidden sm:table-cell">{TENANCY_STATUS_LABELS[d.tenancy_status as keyof typeof TENANCY_STATUS_LABELS] ?? d.tenancy_status}</Td>
                  <Td className="text-right tabular">{v(d.debt_vnd)}</Td>
                  <Td className="text-right tabular">{v(d.overdue_vnd)}</Td>
                  <Td className="hidden text-right tabular md:table-cell">{v(d.credit_available_vnd)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function DepositsTab({ buildingId }: { buildingId?: string }) {
  const q = useDepositsReport({ building_id: buildingId });
  return (
    <>
      <div className="mb-3 flex justify-end">
        <CsvLink type="deposits" filters={{ building_id: buildingId }} />
      </div>
      {q.data ? (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['Cọc đang giữ (nghĩa vụ phải trả)', q.data.totals.held_vnd],
            ['Phải hoàn (khách đã trả phòng)', q.data.totals.refund_payable_vnd],
            ['Còn thiếu so với mức yêu cầu', q.data.totals.shortfall_vnd],
          ].map(([l, x]) => (
            <Card key={l}>
              <CardContent>
                <p className="text-sm text-slate-500">{l}</p>
                <p className="text-xl font-semibold tabular">{v(x!)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
      <Card>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.rows.length === 0 ? (
          <EmptyState title="Chưa có cọc" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Phòng</Th>
                <Th className="hidden text-right md:table-cell">Mức yêu cầu</Th>
                <Th className="text-right">Đang giữ</Th>
                <Th className="hidden text-right md:table-cell">Còn thiếu</Th>
                <Th className="text-right">Phải hoàn</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((d) => (
                <Tr key={d.tenancy_id}>
                  <Td>
                    <Link href={`/tenancies/${d.tenancy_id}`} className="text-brand-800 hover:underline">
                      {d.building_code} · {d.room_code}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {d.primary_tenant_name} · {TENANCY_STATUS_LABELS[d.tenancy_status as keyof typeof TENANCY_STATUS_LABELS] ?? d.tenancy_status}
                    </div>
                  </Td>
                  <Td className="hidden text-right tabular md:table-cell">{v(d.required_vnd)}</Td>
                  <Td className="text-right tabular">{v(d.held_vnd)}</Td>
                  <Td className="hidden text-right tabular md:table-cell">{v(d.shortfall_vnd)}</Td>
                  <Td className="text-right tabular">{v(d.refund_payable_vnd)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function CollectionsTab({ buildingId }: { buildingId?: string }) {
  const [f, setF] = useState({ from: `${todayLocal().slice(0, 7)}-01`, to: todayLocal() });
  const q = useCollections({ ...f, building_id: buildingId });
  return (
    <>
      <FilterBar>
        <Field id="cl-from" label="Từ ngày" className="sm:w-40">
          <TextInput id="cl-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </Field>
        <Field id="cl-to" label="Đến ngày" className="sm:w-40">
          <TextInput id="cl-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <CsvLink type="collections" filters={{ ...f, building_id: buildingId }} />
        </div>
      </FilterBar>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card>
              <CardContent>
                <p className="text-sm text-slate-500">Tiền thực nhận (phiếu thu)</p>
                <p className="text-xl font-semibold tabular text-emerald-700">{v(q.data.totals.cash_vnd)}</p>
                <p className="text-xs text-slate-500">
                  {Object.entries(q.data.totals.by_method)
                    .map(([k, x]) => `${PAYMENT_METHOD_LABELS[k as keyof typeof PAYMENT_METHOD_LABELS] ?? k}: ${v(x)}`)
                    .join(' · ')}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-sm text-slate-500">Trừ vào cọc (không phải tiền mới)</p>
                <p className="text-xl font-semibold tabular">{v(q.data.totals.deposit_applied_vnd)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-sm text-slate-500">Cấn trừ credit (không phải tiền mới)</p>
                <p className="text-xl font-semibold tabular">{v(q.data.totals.credit_applied_vnd)}</p>
              </CardContent>
            </Card>
          </div>
          <Card>
            {q.data.payments.length === 0 ? (
              <EmptyState title="Không có phiếu thu trong khoảng này" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Ngày</Th>
                    <Th>Phiếu thu</Th>
                    <Th>Phòng</Th>
                    <Th className="hidden md:table-cell">Phương thức</Th>
                    <Th className="text-right">Số tiền</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.payments.map((p) => (
                    <Tr key={p.id}>
                      <Td className="tabular whitespace-nowrap">{formatBusinessDate(p.paid_at)}</Td>
                      <Td>
                        <Link href={`/print/payments/${p.id}`} target="_blank" className="text-brand-800 hover:underline">
                          {p.number}
                        </Link>
                      </Td>
                      <Td>
                        {p.building_code} · {p.room_code}
                      </Td>
                      <Td className="hidden md:table-cell">{PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}</Td>
                      <Td className="text-right tabular">{v(p.amount_vnd)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
