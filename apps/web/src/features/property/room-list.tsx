'use client';

import type { Room } from '@ql-tro/shared';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatVnd } from '@/lib/format';
import { RoomStatusBadge } from './status';

export function RoomGrid({ rooms }: { rooms: Room[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="room-grid">
      {rooms.map((r) => (
        <li key={r.id}>
          <Link
            href={`/rooms/${r.id}`}
            className="flex h-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-600 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-base font-semibold">{r.code}</span>
              <span className="text-xs text-slate-500" data-testid="room-building">
                {r.building_code}
              </span>
            </div>
            <RoomStatusBadge status={r.display_status} maintenance={r.maintenance_badge} />
            <div className="mt-auto text-xs text-slate-500">
              {r.current_tenancy?.primary_tenant_name ? (
                <span className="flex items-center gap-1">
                  <Users className="size-3" aria-hidden />
                  {r.current_tenancy.primary_tenant_name}
                </span>
              ) : r.current_reservation ? (
                <span>Giữ cho {r.current_reservation.contact_name}</span>
              ) : (
                <span className="tabular">{formatVnd(r.default_rent_vnd)}</span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RoomTable({ rooms }: { rooms: Room[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Phòng</Th>
          <Th>Tòa</Th>
          <Th className="hidden sm:table-cell">Tầng</Th>
          <Th>Trạng thái</Th>
          <Th className="hidden md:table-cell">Khách / giữ chỗ</Th>
          <Th className="text-right">Giá mặc định</Th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((r) => (
          <Tr key={r.id}>
            <Td className="font-semibold">
              <Link href={`/rooms/${r.id}`} className="text-brand-800 hover:underline">
                {r.code}
              </Link>
            </Td>
            <Td>{r.building_code}</Td>
            <Td className="hidden sm:table-cell">{r.floor ?? '—'}</Td>
            <Td>
              <RoomStatusBadge status={r.display_status} maintenance={r.maintenance_badge} />
            </Td>
            <Td className="hidden text-slate-600 md:table-cell">
              {r.current_tenancy?.primary_tenant_name ?? (r.current_reservation ? `Giữ: ${r.current_reservation.contact_name}` : '—')}
            </Td>
            <Td className="text-right tabular">{formatVnd(r.default_rent_vnd)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
