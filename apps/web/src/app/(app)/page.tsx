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
import { ContractAlertsCard } from '@/features/contracts/alerts';
import { useDashboard } from '@/features/reports/api';
import { formatVnd, todayLocal } from '@/lib/format';

type RoomStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE';

/** Thẻ trạng thái phòng: nền trắng, biểu tượng trong ô màu nhạt (không gradient). */
const STATUS_TILES: Record<RoomStatus, { chip: string; Icon: LucideIcon; note?: string }> = {
  AVAILABLE: { chip: 'bg-emerald-50 text-emerald-600', Icon: DoorOpen },
  OCCUPIED: { chip: 'bg-blue-50 text-blue-600', Icon: KeyRound },
  RESERVED: { chip: 'bg-violet-50 text-violet-600', Icon: CalendarClock },
  // Phòng tạm ngừng cho thuê để sửa; yêu cầu sửa vặt khi khách vẫn ở không đổi trạng thái phòng.
  MAINTENANCE: { chip: 'bg-amber-50 text-amber-600', Icon: Wrench, note: 'Sửa chữa: xem Việc cần xử lý' },
};

/** Ô tiền: biểu tượng màu theo ý nghĩa; số chỉ tô màu khi khác 0 (quá hạn đỏ, thực thu xanh). */
const MONEY_TONES = {
  slate: { chip: 'bg-slate-100 text-slate-500', value: '' },
  danger: { chip: 'bg-red-50 text-red-600', value: 'text-red-600' },
  primary: { chip: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-700' },
  info: { chip: 'bg-blue-50 text-blue-600', value: '' },
  warning: { chip: 'bg-amber-50 text-amber-600', value: '' },
  violet: { chip: 'bg-violet-50 text-violet-600', value: '' },
} as const;

/** Tổng quan (MASTER_PLAN 12, 13): phòng theo trạng thái, tiền, việc cần xử lý — trong phạm vi tòa của bạn. */
export default function DashboardPage() {
  const { data: me } = useMe();
  const [buildingId, setBuildingId] = useState('');
  const [period, setPeriod] = useState(todayLocal().slice(0, 7));
  const dash = useDashboard({ ...(buildingId ? { building_id: buildingId } : {}), period });
  if (!me) return null;
  const d = dash.data;
  const monthLabel = `${period.slice(5)}/${period.slice(0, 4)}`;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-heading md:text-[26px]">Xin chào, {me.display_name}</h1>
          <p className="mt-1 text-sm text-muted">Tổng quan nhà trọ</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Field id="db-building" label="Tòa" className="w-48">
            <Select id="db-building" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
              <option value="">Tất cả tòa</option>
              {me.buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="db-period" label="Tháng" className="w-44">
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
          <section aria-label="Phòng theo trạng thái" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-muted">Tổng phòng</p>
                <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <BedDouble className="size-[18px]" aria-hidden />
                </span>
              </div>
              <p className="mt-1 text-3xl font-bold tracking-tight text-heading tabular">{d.rooms.total}</p>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-slate-100" aria-hidden>
                  <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(100, d.rooms.occupancy_rate)}%` }} />
                </div>
                <span className="text-[13px] text-muted tabular">Lấp đầy {d.rooms.occupancy_rate}%</span>
              </div>
            </Card>
            {(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'] as const).map((s) => {
              const t = STATUS_TILES[s];
              return (
                <Link key={s} href={`/rooms?status=${s}`} className="group rounded-xl focus-visible:outline-2 focus-visible:outline-brand-500">
                  <Card className="h-full p-4 transition-colors group-hover:border-slate-300">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-muted">{s === 'MAINTENANCE' ? 'Ngừng cho thuê' : ROOM_STATUS_LABELS[s]}</p>
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${t.chip}`}>
                        <t.Icon className="size-[18px]" aria-hidden />
                      </span>
                    </div>
                    <p className="mt-1 text-3xl font-bold tracking-tight text-heading tabular" data-testid={`rooms-${s}`}>
                      {d.rooms[s]}
                    </p>
                    <p className="mt-3 flex items-center gap-1 text-[13px] text-muted">
                      {t.note ?? 'Xem phòng'}
                      <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </p>
                  </Card>
                </Link>
              );
            })}
          </section>
          <p className="-mt-2 text-[13px] text-muted">
            Trong số phòng đang thuê: <strong className="font-semibold text-heading">{d.secondary.notice_given}</strong> đã báo trả ·{' '}
            <strong className="font-semibold text-heading">{d.secondary.month_to_month}</strong> thuê theo tháng ·{' '}
            <strong className="font-semibold text-heading">{d.secondary.contracts_expiring_30}</strong> hợp đồng hết hạn trong 30 ngày (chỉ số phụ, không cộng vào tổng).
          </p>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Việc cần xử lý</CardTitle>
                {d.todo.length ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[13px] font-semibold text-amber-700 tabular">{d.todo.reduce((n, t) => n + t.count, 0)}</span>
                ) : null}
              </CardHeader>
              {d.todo.length === 0 ? (
                <CardContent className="text-sm text-muted">Không có việc tồn đọng.</CardContent>
              ) : (
                <ul className="divide-y divide-line" data-testid="todo-list">
                  {d.todo.map((t) => (
                    <li key={t.kind}>
                      <Link href={t.href} className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-slate-50">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                          <AlertTriangle className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 text-heading">{t.label}</span>
                        {t.amount_vnd ? <span className="hidden text-[13px] text-muted tabular sm:inline">{formatVnd(t.amount_vnd)}</span> : null}
                        <span className="min-w-7 rounded-md bg-slate-100 px-2 py-0.5 text-center text-[13px] font-semibold text-heading tabular">{t.count}</span>
                        <ChevronRight className="size-4 text-slate-400" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {d.money ? (
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle>Tiền</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                    {(
                      [
                        ['Còn phải thu (gồm khách đã trả phòng)', d.money.debt_vnd, 'info', Wallet],
                        ['Trong đó quá hạn', d.money.overdue_vnd, 'danger', AlertTriangle],
                        [`Tổng tiền phải thu tháng ${monthLabel}`, d.money.invoiced_in_period_vnd, 'slate', ReceiptText],
                        ['Thực thu theo tháng', d.money.collected_in_period_vnd, 'primary', HandCoins],
                        ['Cọc đang giữ (nghĩa vụ phải trả)', d.money.deposit_held_vnd, 'warning', PiggyBank],
                        ['Phải hoàn cọc (đã trả phòng)', d.money.deposit_refund_payable_vnd, 'violet', Undo2],
                        ['Phải hoàn tiền dư (credit)', d.money.credit_refund_payable_vnd, 'violet', Undo2],
                        ['Tiền giữ chỗ chưa xử lý', d.money.holding_unresolved_vnd, 'slate', CircleDollarSign],
                      ] as const
                    ).map(([l, v, tone, Icon]) => (
                      <div key={l} className="flex items-start gap-3">
                        <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${MONEY_TONES[tone].chip}`}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <dt className="text-[13px] text-muted">{l}</dt>
                          <dd className={`text-lg font-semibold text-heading tabular ${v !== '0' ? MONEY_TONES[tone].value : ''}`}>{formatVnd(v)}</dd>
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
          <Building2 className="size-[18px] text-muted" aria-hidden />
          <CardTitle>Tòa trong phạm vi của bạn</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="building-list">
            {me.buildings.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 px-1.5 text-[13px] font-semibold text-brand-700">{b.code}</span>
                <span className="truncate text-heading">{b.name}</span>
              </li>
            ))}
          </ul>
          {me.buildings.length === 0 ? <p className="text-sm text-muted">Bạn chưa được giao tòa nào. Liên hệ chủ trọ để được giao phạm vi.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
