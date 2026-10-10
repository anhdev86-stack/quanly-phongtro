'use client';

import { Download } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FilterBar } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatVnd, todayLocal } from '@/lib/format';
import { exportUrl, useCashFlow, useOccupancy, useOperating, useRevenueBreakdown } from './api';

// V1.1 Phase 12: báo cáo tài chính mở rộng. Mỗi tab ghi rõ cơ sở số liệu (dồn tích / dòng tiền).

const v = (x: string) => formatVnd(x);
const mm = (p: string) => `${p.slice(5)}/${p.slice(0, 4)}`;
const monthsAgo = (n: number) => {
  const [y, m] = todayLocal().split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

function RangeBar({ f, setF, csv, children }: { f: { from: string; to: string }; setF: (v: { from: string; to: string }) => void; csv: string; children?: ReactNode }) {
  return (
    <FilterBar>
      <Field id={`${csv}-from`} label="Từ tháng" className="sm:w-40">
        <TextInput id={`${csv}-from`} type="month" value={f.from} onChange={(e) => e.target.value && setF({ ...f, from: e.target.value })} />
      </Field>
      <Field id={`${csv}-to`} label="Đến tháng" className="sm:w-40">
        <TextInput id={`${csv}-to`} type="month" value={f.to} onChange={(e) => e.target.value && setF({ ...f, to: e.target.value })} />
      </Field>
      {children}
    </FilterBar>
  );
}

function Csv({ type, filters }: { type: string; filters: Record<string, string | undefined> }) {
  return (
    <div className="flex items-end">
      <a href={exportUrl(type, filters)} className={buttonVariants({ size: 'sm', variant: 'outline' })} download>
        <Download className="size-4" aria-hidden />
        Xuất CSV
      </a>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <CardContent className="border-t border-slate-100 text-xs text-slate-500">{children}</CardContent>;
}

/** Doanh thu thuần theo khoản thu / tòa / phòng. */
export function BreakdownTab({ buildingId }: { buildingId?: string }) {
  const [f, setF] = useState({ from: monthsAgo(5), to: monthsAgo(0) });
  const [groupBy, setGroupBy] = useState<'charge' | 'building' | 'room'>('charge');
  const filters = { ...f, building_id: buildingId, group_by: groupBy };
  const q = useRevenueBreakdown(filters);
  return (
    <>
      <RangeBar f={f} setF={setF} csv="revenue-breakdown">
        <Field id="rb-group" label="Theo" className="sm:w-40">
          <Select id="rb-group" value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="charge">Khoản thu</option>
            <option value="building">Tòa</option>
            <option value="room">Phòng</option>
          </Select>
        </Field>
        <Csv type="revenue-breakdown" filters={filters} />
      </RangeBar>
      <Card>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.rows.length === 0 ? (
          <EmptyState title="Chưa có doanh thu trong khoảng này" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{groupBy === 'charge' ? 'Khoản thu' : groupBy === 'building' ? 'Tòa' : 'Phòng'}</Th>
                {q.data.months.map((m) => (
                  <Th key={m} className="text-right">
                    {mm(m)}
                  </Th>
                ))}
                <Th className="text-right">Tổng</Th>
              </tr>
            </thead>
            <tbody>
              {[...q.data.rows, { key: 'total', label: 'Tổng', by_month: q.data.totals.by_month, total_vnd: q.data.totals.total_vnd }].map((r) => (
                <Tr key={r.key} className={r.key === 'total' ? 'bg-slate-50 font-semibold' : ''}>
                  <Td className="whitespace-nowrap">{r.label}</Td>
                  {r.by_month.map((x, i) => (
                    <Td key={i} className="text-right tabular">
                      {v(x)}
                    </Td>
                  ))}
                  <Td className="text-right tabular font-medium">{v(r.total_vnd)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Note>Doanh thu thuần = khoản phải thu trừ giảm trừ của chứng từ đã phát hành, theo tháng của thông báo. Tổng mỗi tháng khớp cột “Doanh thu thuần” (bấm “Xem chi tiết”) của báo cáo doanh thu theo tháng.</Note>
      </Card>
    </>
  );
}

/** Dòng tiền thực nhận/thực chi. */
export function CashFlowTab({ buildingId }: { buildingId?: string }) {
  const [f, setF] = useState({ from: monthsAgo(5), to: monthsAgo(0) });
  const filters = { ...f, building_id: buildingId };
  const q = useCashFlow(filters);
  const cols: [keyof NonNullable<typeof q.data>['totals'], string, string?][] = [
    ['rent_collections_vnd', 'Thu tiền phòng, dịch vụ'],
    ['deposits_in_vnd', 'Nhận cọc'],
    ['holding_in_vnd', 'Nhận giữ chỗ'],
    ['cash_in_vnd', 'Tổng vào', 'text-emerald-700 font-medium'],
    ['deposit_refunds_vnd', 'Hoàn cọc'],
    ['credit_refunds_vnd', 'Hoàn tiền dư'],
    ['holding_refunds_vnd', 'Hoàn giữ chỗ'],
    ['expenses_vnd', 'Chi phí'],
    ['cash_out_vnd', 'Tổng ra', 'text-red-700 font-medium'],
    ['net_cash_vnd', 'Chênh lệch', 'font-semibold'],
  ];
  return (
    <>
      <RangeBar f={f} setF={setF} csv="cash-flow">
        <Csv type="cash-flow" filters={filters} />
      </RangeBar>
      <Card>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tháng</Th>
                {cols.map(([k, l]) => (
                  <Th key={k} className="text-right">
                    {l}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...q.data.rows.map((r) => ({ label: mm(r.period), r })), { label: 'Tổng', r: q.data.totals }].map(({ label, r }) => (
                <Tr key={label} className={label === 'Tổng' ? 'bg-slate-50 font-semibold' : ''}>
                  <Td className="whitespace-nowrap">{label}</Td>
                  {cols.map(([k, , cls]) => (
                    <Td key={k} className={`text-right tabular ${cls ?? ''}`}>
                      {v(r[k])}
                    </Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Note>
          Theo ngày tiền thực vào/ra. Cọc và tiền giữ chỗ nhận vào là tiền giữ hộ (phải trả lại), không phải doanh thu; hoàn cọc không phải chi phí. Chênh lệch tiền không phải lợi nhuận.
        </Note>
      </Card>
    </>
  );
}

/** Lấp đầy theo ngày-phòng. */
export function OccupancyTab({ buildingId }: { buildingId?: string }) {
  const [f, setF] = useState({ from: monthsAgo(11), to: monthsAgo(0) });
  const filters = { ...f, building_id: buildingId };
  const q = useOccupancy(filters);
  return (
    <>
      <RangeBar f={f} setF={setF} csv="occupancy">
        <Csv type="occupancy" filters={filters} />
      </RangeBar>
      <Card>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tháng</Th>
                <Th className="text-right">Ngày-phòng</Th>
                <Th className="text-right">Có thuê</Th>
                <Th className="text-right">Tỷ lệ</Th>
                <Th className="hidden sm:table-cell" />
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <Tr key={r.period}>
                  <Td>{mm(r.period)}</Td>
                  <Td className="text-right tabular">{r.room_days.toLocaleString('vi-VN')}</Td>
                  <Td className="text-right tabular">{r.occupied_days.toLocaleString('vi-VN')}</Td>
                  <Td className="text-right tabular font-medium">{r.rate_pct.replace('.', ',')}%</Td>
                  <Td className="hidden w-1/3 sm:table-cell">
                    <div className="h-2 rounded bg-slate-100" aria-hidden>
                      <div className="h-2 rounded bg-brand-600" style={{ width: `${Math.min(100, Number(r.rate_pct))}%` }} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {q.data ? <Note>{q.data.note}</Note> : null}
      </Card>
    </>
  );
}

/** Chi phí và thu nhập vận hành. */
export function OperatingTab({ buildingId }: { buildingId?: string }) {
  const [f, setF] = useState({ from: monthsAgo(5), to: monthsAgo(0) });
  const filters = { ...f, building_id: buildingId };
  const q = useOperating(filters);
  return (
    <>
      <RangeBar f={f} setF={setF} csv="operating">
        <Csv type="operating" filters={filters} />
      </RangeBar>
      <Card>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Tháng</Th>
                  <Th className="text-right">Doanh thu thuần</Th>
                  <Th className="text-right">Thu nhập khác</Th>
                  <Th className="text-right">Chi phí</Th>
                  <Th className="text-right">Thu nhập vận hành</Th>
                </tr>
              </thead>
              <tbody>
                {[...q.data.rows.map((r) => ({ label: mm(r.period), r })), { label: 'Tổng', r: q.data.totals }].map(({ label, r }) => (
                  <Tr key={label} className={label === 'Tổng' ? 'bg-slate-50 font-semibold' : ''}>
                    <Td>{label}</Td>
                    <Td className="text-right tabular">{v(r.net_revenue_vnd)}</Td>
                    <Td className="text-right tabular">{v(r.other_income_vnd)}</Td>
                    <Td className="text-right tabular text-red-700">{v(r.expenses_vnd)}</Td>
                    <Td className="text-right tabular font-medium">{v(r.operating_income_vnd)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {q.data.expenses_by_category.length ? (
              <CardContent className="border-t border-slate-100 text-sm">
                <p className="mb-1 font-medium">Chi phí theo loại</p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {q.data.expenses_by_category.map((c) => (
                    <li key={c.category} className="flex justify-between gap-2">
                      <span>{c.label}</span>
                      <span className="tabular">{v(c.amount_vnd)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            ) : null}
          </>
        )}
        {q.data ? <Note>{q.data.note} Thu nhập khác = tiền giữ chỗ bị giữ lại theo thỏa thuận.</Note> : null}
      </Card>
    </>
  );
}
