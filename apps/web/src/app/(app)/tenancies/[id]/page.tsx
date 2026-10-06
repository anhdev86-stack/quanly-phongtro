'use client';

import { PERMISSIONS } from '@ql-tro/shared';
import { Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DescriptionList, PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useCan } from '@/features/auth/permissions';
import { RentPriceDialog } from '@/features/contracts/contract-dialogs';
import { useDepositLedger, useTenancy } from '@/features/tenancy/api';
import { LedgerTable, LedgerTxDialog } from '@/features/tenancy/ledger';
import { MembersSection } from '@/features/tenancy/members-section';
import { TenancyExtraSections, TenancyHeaderActions } from '@/features/tenancy/tenancy-extra-sections';
import { RentalModeBadge, TenancyStatusBadge } from '@/features/tenancy/tenancy-status';
import { formatBusinessDate, formatVnd } from '@/lib/format';

export default function TenancyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const tenancy = useTenancy(id);
  const ledger = useDepositLedger(id);
  const [recording, setRecording] = useState(false);
  const [changingPrice, setChangingPrice] = useState(false);

  if (tenancy.isPending) return <LoadingState />;
  if (tenancy.isError) return <ErrorState error={tenancy.error} onRetry={() => void tenancy.refetch()} />;
  const t = tenancy.data;
  const d = t.deposit;
  const depositTypes = [
    ...(can(PERMISSIONS.DEPOSIT_RECORD) && t.status !== 'ENDED' ? ['RECEIVED', 'TOP_UP'] : []),
    ...(can(PERMISSIONS.DEPOSIT_REFUND) ? ['REFUND'] : []),
    ...(can(PERMISSIONS.SETTLEMENT_APPROVE) ? ['DEDUCTION'] : []),
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <PageHeader
        back={{ href: `/rooms/${t.room_id}`, label: `Phòng ${t.room_code}` }}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Lần thuê {t.code}
            <TenancyStatusBadge status={t.status} />
            <RentalModeBadge mode={t.rental_mode} />
          </span>
        }
        description={`${t.building_code} · Phòng ${t.room_code} · Đại diện: ${t.primary_tenant_name ?? '—'}`}
        actions={<TenancyHeaderActions tenancy={t} />}
      />

      <Card>
        <CardContent>
          <DescriptionList
            items={[
              { label: 'Ngày nhận phòng', value: formatBusinessDate(t.start_date) },
              { label: 'Ngày cuối tính tiền', value: t.last_charge_date ? formatBusinessDate(t.last_charge_date) : 'Đang thuê' },
              { label: 'Giá thuê hiện tại', value: t.current_rent_vnd ? <span className="tabular">{formatVnd(t.current_rent_vnd)}</span> : null },
              { label: 'Ngày đến hạn', value: `Ngày ${t.billing_due_day} hằng tháng` },
              { label: 'Báo trước khi trả phòng', value: `${t.notice_days} ngày` },
              { label: 'Ghi chú', value: t.note },
            ]}
          />
        </CardContent>
      </Card>

      <TenancyExtraSections tenancy={t} />

      <MembersSection tenancy={t} />

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Tiền cọc</CardTitle>
          {depositTypes.length ? (
            <Button size="sm" variant="outline" onClick={() => setRecording(true)}>
              <Plus className="size-4" aria-hidden />
              Ghi giao dịch cọc
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="border-b border-slate-100">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            {[
              ['Mức thỏa thuận', d.required_vnd],
              ['Đang giữ', d.held_vnd],
              ['Đã thực nhận', d.received_vnd],
              ['Đã trừ vào thông báo', d.applied_vnd],
              ['Đã hoàn', d.refunded_vnd],
              ['Còn thiếu', d.shortfall_vnd],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className={`tabular font-medium ${label === 'Còn thiếu' && value !== '0' ? 'text-amber-700' : ''}`}>{formatVnd(value!)}</dd>
              </div>
            ))}
          </dl>
          {d.excess_vnd !== '0' ? (
            <p className="mt-2">
              <Badge tone="violet">Đang giữ vượt mức yêu cầu {formatVnd(d.excess_vnd)}</Badge>
            </p>
          ) : null}
        </CardContent>
        {ledger.data ? <LedgerTable kind="deposit" txs={ledger.data.transactions} canReverse={can(PERMISSIONS.FINANCE_REVERSE)} /> : <LoadingState />}
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Giá thuê</CardTitle>
          {can(PERMISSIONS.CONTRACTS_MANAGE) && t.status !== 'ENDED' ? (
            <Button size="sm" variant="outline" onClick={() => setChangingPrice(true)}>
              <Pencil className="size-4" aria-hidden />
              Đổi giá thuê
            </Button>
          ) : null}
        </CardHeader>
        <Table>
          <thead>
            <tr>
              <Th>Khoản</Th>
              <Th>Từ ngày</Th>
              <Th className="text-right">Giá mỗi tháng</Th>
              <Th className="hidden sm:table-cell">Ghi chú</Th>
            </tr>
          </thead>
          <tbody>
            {t.rent_prices.map((p) => (
              <Tr key={p.id} className={p.status === 'VOIDED' ? 'opacity-50 line-through' : ''}>
                <Td>Tiền phòng</Td>
                <Td className="tabular">{formatBusinessDate(p.effective_from)}</Td>
                <Td className="text-right tabular">{formatVnd(p.monthly_rent_vnd)}</Td>
                <Td className="hidden text-slate-600 sm:table-cell">
                  {p.status === 'VOIDED' ? `Vô hiệu: ${p.void_reason ?? ''}` : p.reason}
                  {p.source_contract_id ? <span className="ml-1 text-xs text-slate-400">(theo hợp đồng)</span> : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {t.initial_readings.length ? (
          <CardContent className="text-sm text-slate-600">
            Chỉ số lúc nhận phòng: {t.initial_readings.map((r) => `${r.type === 'ELECTRICITY' ? 'Điện' : 'Nước'} ${r.value}`).join(' · ')} ·{' '}
            <Link href={`/rooms/${t.room_id}#meters`} className="text-brand-800 hover:underline">
              Đồng hồ và chỉ số
            </Link>
          </CardContent>
        ) : null}
      </Card>

      <p className="text-sm text-slate-500">
        <Link href={`/tenancies?room_id=${t.room_id}`} className="text-brand-800 hover:underline">
          Các lần thuê khác của phòng này
        </Link>
      </p>

      <RentPriceDialog open={changingPrice} onClose={() => setChangingPrice(false)} tenancy={t} />
      <LedgerTxDialog open={recording} onClose={() => setRecording(false)} kind="deposit" path={`/tenancies/${t.id}/deposit-transactions`} allowed={depositTypes} />
    </div>
  );
}
