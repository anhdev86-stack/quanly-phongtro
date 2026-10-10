'use client';

import type { TenancySummary } from '@ql-tro/shared';
import Link from 'next/link';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { RentalModeBadge, TenancyStatusBadge } from './tenancy-status';

export function TenancyTable({ items }: { items: TenancySummary[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Mã</Th>
          <Th>Phòng</Th>
          <Th>Đại diện</Th>
          <Th>Trạng thái</Th>
          <Th className="hidden md:table-cell">Thời gian</Th>
          <Th className="hidden text-right sm:table-cell">Giá thuê</Th>
          <Th className="hidden text-right lg:table-cell">Cọc đang giữ</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((t) => (
          <Tr key={t.id}>
            <Td className="font-semibold">
              <Link href={`/tenancies/${t.id}`} className="font-medium text-brand-600 hover:underline">
                {t.code}
              </Link>
            </Td>
            <Td className="whitespace-nowrap">
              {t.building_code} · {t.room_code}
            </Td>
            <Td>
              {t.primary_tenant_name ?? '—'}
              {t.member_count > 1 ? <span className="text-xs text-slate-500"> +{t.member_count - 1}</span> : null}
            </Td>
            <Td>
              <span className="inline-flex flex-wrap gap-1">
                <TenancyStatusBadge status={t.status} />
                {t.status !== 'ENDED' ? <RentalModeBadge mode={t.rental_mode} /> : null}
              </span>
            </Td>
            <Td className="hidden tabular whitespace-nowrap md:table-cell">
              {formatBusinessDate(t.start_date)} → {t.last_charge_date ? formatBusinessDate(t.last_charge_date) : 'nay'}
            </Td>
            <Td className="hidden text-right tabular sm:table-cell">{t.current_rent_vnd ? formatVnd(t.current_rent_vnd) : '—'}</Td>
            <Td className="hidden text-right tabular lg:table-cell">{formatVnd(t.deposit_held_vnd)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
