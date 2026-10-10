'use client';

import { ROOM_STATUS_LABELS } from '@ql-tro/shared';
import {
  AlertTriangle,
  BedDouble,
  Building2,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  DoorOpen,
  HandCoins,
  KeyRound,
  type LucideIcon,
  PiggyBank,
  ReceiptText,
  Undo2,
  Wallet,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { useMe } from '@/features/auth/api';
import { useDashboard } from '@/features/reports/api';
import { formatVnd, todayLocal } from '@/lib/format';
import { ContractAlertsCard } from '@/features/contracts/alerts';

/** Mỗi trạng thái phòng một màu + biểu tượng (ô nền nhạt, viền trái đậm). */
const STATUS_TILES: Record<'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE', { tile: string; icon: string; Icon: LucideIcon }> = {
  AVAILABLE: { tile: 'border-l-emerald-500 bg-gradient-to-br from-emerald-50 to-white', icon: 'bg-emerald-500', Icon: DoorOpen },
  OCCUPIED: { tile: 'border-l-blue-500 bg-gradient-to-br from-blue-50 to-white', icon: 'bg-blue-500', Icon: KeyRound },
  RESERVED: { tile: 'border-l-violet-500 bg-gradient-to-br from-violet-50 to-white', icon: 'bg-violet-500', Icon: CalendarClock },
  MAINTENANCE: { tile: 'border-l-amber-500 bg-gradient-to-br from-amber-50 to-white', icon: 'bg-amber-500', Icon: Wrench },
};

/** Ô tiền: màu nhấn + biểu tượng; màu số chỉ áp khi khác 0. */
const MONEY_TONES = {
  slate: { icon: 'bg-slate-100 text-slate-600', value: '' },
  red: { icon: 'bg-red-100 text-red-600', value: 'text-red-700' },
  green: { icon: 'bg-emerald-100 text-emerald-600', value: 'text-emerald-700' },
  blue: { icon: 'bg-blue-100 text-blue-600', value: 'text-blue-800' },
  violet: { icon: 'bg-violet-100 text-violet-600', value: 'text-violet-700' },
  amber: { icon: 'bg-amber-100 text-amber-600', value: 'text-amber-800' },
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
          <Field id="db-period" label="Tháng" className="w-48">
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
            <Card className="border-0 bg-gradient-to-br from-brand-200 to-brand-300 text-brand-900 shadow-md">
              <CardContent>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-brand-800">Tổng phòng</p>
                  <span className="flex size-8 items-center justify-center rounded-lg bg-white/50 text-brand-800">
                    <BedDouble className="size-4" aria-hidden />
                  </span>
                </div>
                <p className="text-3xl font-bold tabular">{d.rooms.total}</p>
                <div className="mt-2 h-1.5 rounded-full bg-white/50" aria-hidden>
                  <div className="h-1.5 rounded-full bg-brand-700" style={{ width: `${Math.min(100, d.rooms.occupancy_rate)}%` }} />
                </div>
                <p className="mt-1 text-xs text-brand-800">Lấp đầy {d.rooms.occupancy_rate}%</p>
              </CardContent>
            </Card>
            {(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'] as const).map((s) => {
              const t = STATUS_TILES[s];
              return (
                <Link key={s} href={`/rooms?status=${s}`} className="group">
                  <Card className={`h-full border-l-4 transition-shadow group-hover:shadow-md ${t.tile}`}>
                    <CardContent>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-700">{s === 'MAINTENANCE' ? 'Ngừng cho thuê' : ROOM_STATUS_LABELS[s]}</p>
                        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${t.icon}`}>
                          <t.Icon className="size-4" aria-hidden />
                        </span>
                      </div>
                      <p className="text-3xl font-bold tabular text-slate-900" data-testid={`rooms-${s}`}>
                        {d.rooms[s]}
                      </p>
                      {s === 'MAINTENANCE' ? (
                        // Phòng tạm ngừng cho thuê để sửa; yêu cầu sửa vặt khi khách vẫn ở không đổi trạng thái phòng.
                        <p className="mt-1 text-xs text-slate-500">Phòng đang bảo trì. Yêu cầu sửa chữa: xem Việc cần xử lý</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
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
                    {(
                      [
                        ['Còn phải thu (gồm khách đã trả phòng)', d.money.debt_vnd, 'blue', Wallet],
                        ['Trong đó quá hạn', d.money.overdue_vnd, 'red', AlertTriangle],
                        [`Tổng tiền phải thu tháng ${period.slice(5)}/${period.slice(0, 4)}`, d.money.invoiced_in_period_vnd, 'slate', ReceiptText],
                        ['Thực thu theo tháng', d.money.collected_in_period_vnd, 'green', HandCoins],
                        ['Cọc đang giữ (nghĩa vụ phải trả)', d.money.deposit_held_vnd, 'amber', PiggyBank],
                        ['Phải hoàn cọc (đã trả phòng)', d.money.deposit_refund_payable_vnd, 'violet', Undo2],
                        ['Phải hoàn tiền dư (credit)', d.money.credit_refund_payable_vnd, 'violet', Undo2],
                        ['Tiền giữ chỗ chưa xử lý', d.money.holding_unresolved_vnd, 'slate', CircleDollarSign],
                      ] as const
                    ).map(([l, v, tone, Icon]) => (
                      <div key={l} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${MONEY_TONES[tone].icon}`}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <dt className="text-slate-500">{l}</dt>
                          <dd className={`text-lg font-semibold tabular ${v !== '0' ? MONEY_TONES[tone].value : ''}`}>{formatVnd(v)}</dd>
                        </div>
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
                <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded bg-brand-50 px-1.5 font-semibold text-brand-800">{b.code}</span>
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
