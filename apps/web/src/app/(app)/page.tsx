'use client';

import { ROOM_STATUS_LABELS } from '@ql-tro/shared';
import { AlertTriangle, Building2, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { useMe } from '@/features/auth/api';
import { useDashboard } from '@/features/reports/api';
import { formatVnd, todayLocal } from '@/lib/format';
import { ContractAlertsCard } from '@/features/contracts/alerts';

const STATUS_STYLES = {
  AVAILABLE: 'bg-emerald-50 text-emerald-800',
  OCCUPIED: 'bg-blue-50 text-blue-800',
  RESERVED: 'bg-violet-50 text-violet-800',
  MAINTENANCE: 'bg-amber-50 text-amber-800',
} as const;

/** Tổng quan (MASTER_PLAN 12, 13): phòng theo trạng thái, tiền, việc cần xử lý — trong phạm vi tòa của bạn. */
export default function DashboardPage() {
  const { data: me } = useMe();
  const [buildingId, setBuildingId] = useState('');
  const [period, setPeriod] = useState(todayLocal().slice(0, 7));
  const dash = useDashboard({ ...(buildingId ? { building_id: buildingId } : {}), period });
  if (!me) return null;
  const d = dash.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Xin chào, {me.display_name}</h1>
          <p className="mt-1 text-sm text-slate-500">{me.workspace.name}</p>
        </div>
        <div className="flex gap-2">
          <Field id="db-building" label="Tòa" className="w-44">
            <Select id="db-building" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
              <option value="">Tất cả tòa</option>
              {me.buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="db-period" label="Tháng" className="w-40">
            <TextInput id="db-period" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          </Field>
        </div>
      </div>

      {me.permissions.includes('contracts.view') ? <ContractAlertsCard /> : null}

      {dash.isPending ? (
        <LoadingState />
      ) : dash.isError ? (
        <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />
      ) : d ? (
        <>
          <section aria-label="Phòng theo trạng thái" className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Card>
              <CardContent>
                <p className="text-sm text-slate-500">Tổng phòng</p>
                <p className="text-2xl font-semibold tabular">{d.rooms.total}</p>
                <p className="text-xs text-slate-500">Lấp đầy {d.rooms.occupancy_rate}%</p>
              </CardContent>
            </Card>
            {(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'] as const).map((s) => (
              <Link key={s} href={`/rooms?status=${s}`}>
                <Card className="h-full hover:border-brand-600">
                  <CardContent>
                    <p className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s]}`}>{ROOM_STATUS_LABELS[s]}</p>
                    <p className="mt-1 text-2xl font-semibold tabular" data-testid={`rooms-${s}`}>
                      {d.rooms[s]}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </section>
          <p className="-mt-2 text-xs text-slate-500">
            Trong số phòng đang thuê: {d.secondary.notice_given} đã báo trả · {d.secondary.month_to_month} thuê theo tháng · {d.secondary.contracts_expiring_30} hợp đồng hết hạn trong 30 ngày (chỉ số
            phụ, không cộng vào tổng).
          </p>

          <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
            <Card>
              <CardHeader>
                <CardTitle>Việc cần xử lý</CardTitle>
              </CardHeader>
              {d.todo.length === 0 ? (
                <CardContent className="text-sm text-slate-500">Không có việc tồn đọng.</CardContent>
              ) : (
                <ul className="divide-y divide-slate-100" data-testid="todo-list">
                  {d.todo.map((t) => (
                    <li key={t.kind}>
                      <Link href={t.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                        <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
                        <span className="flex-1">{t.label}</span>
                        <span className="font-semibold tabular">{t.count}</span>
                        {t.amount_vnd ? <span className="hidden text-slate-500 tabular sm:inline">{formatVnd(t.amount_vnd)}</span> : null}
                        <ChevronRight className="size-4 text-slate-400" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {d.money ? (
              <Card>
                <CardHeader>
                  <CardTitle>Tiền</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    {[
                      ['Còn phải thu (gồm khách đã trả phòng)', d.money.debt_vnd, ''],
                      ['Trong đó quá hạn', d.money.overdue_vnd, 'text-red-700'],
                      [`Phát sinh tháng ${period.slice(5)}/${period.slice(0, 4)}`, d.money.invoiced_in_period_vnd, ''],
                      ['Thực thu trong tháng (phiếu thu)', d.money.collected_in_period_vnd, 'text-emerald-700'],
                      ['Cọc đang giữ (nghĩa vụ phải trả)', d.money.deposit_held_vnd, ''],
                      ['Phải hoàn cọc (đã trả phòng)', d.money.deposit_refund_payable_vnd, 'text-violet-700'],
                      ['Phải hoàn tiền dư (credit)', d.money.credit_refund_payable_vnd, 'text-violet-700'],
                      ['Tiền giữ chỗ chưa xử lý', d.money.holding_unresolved_vnd, ''],
                    ].map(([l, v, c]) => (
                      <div key={l}>
                        <dt className="text-slate-500">{l}</dt>
                        <dd className={`text-lg font-semibold tabular ${v !== '0' ? c : ''}`}>{formatVnd(v!)}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </>
      ) : null}

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Building2 className="size-4 text-brand-700" aria-hidden />
          <CardTitle>Tòa trong phạm vi của bạn</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-3" data-testid="building-list">
            {me.buildings.map((b) => (
              <li key={b.id} className="flex items-center gap-3 text-sm">
                <span className="flex size-7 items-center justify-center rounded bg-brand-50 font-semibold text-brand-800">{b.code}</span>
                {b.name}
              </li>
            ))}
          </ul>
          {me.buildings.length === 0 ? <p className="text-sm text-slate-500">Bạn chưa được giao tòa nào. Liên hệ chủ trọ để được giao phạm vi.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
