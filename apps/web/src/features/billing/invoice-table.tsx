'use client';

import type { InvoiceSummary } from '@ql-tro/shared';
import Link from 'next/link';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { InvoiceStatusBadges, invoiceTitle, periodText } from './invoice-status';

const signed = (i: InvoiceSummary) => (i.type === 'CREDIT_ADJUSTMENT' ? `− ${formatVnd(i.total_vnd)}` : i.total_vnd.startsWith('-') ? `− ${formatVnd(i.total_vnd.slice(1))}` : formatVnd(i.total_vnd));

export function InvoiceTable({ items, showRoom = true }: { items: InvoiceSummary[]; showRoom?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Thông báo</Th>
          {showRoom ? <Th>Phòng</Th> : null}
          <Th className="hidden sm:table-cell">Kỳ</Th>
          <Th className="hidden md:table-cell">Hạn</Th>
          <Th className="text-right">Tổng</Th>
          <Th className="hidden text-right lg:table-cell">Còn lại</Th>
          <Th>Trạng thái</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <Tr key={i.id} className={i.lifecycle === 'CANCELLED' ? 'opacity-60' : ''}>
            <Td className="whitespace-nowrap">
              <Link href={`/invoices/${i.id}`} className="font-medium text-brand-800 hover:underline">
                {invoiceTitle(i)}
              </Link>
            </Td>
            {showRoom ? (
              <Td>
                {i.building_code} · {i.room_code}
                <div className="text-xs text-slate-500">{i.primary_tenant_name ?? '—'}</div>
              </Td>
            ) : null}
            <Td className="hidden sm:table-cell">{periodText(i.period)}</Td>
            <Td className="hidden tabular md:table-cell">{formatBusinessDate(i.due_date)}</Td>
            <Td className="text-right tabular whitespace-nowrap">{signed(i)}</Td>
            <Td className="hidden text-right tabular lg:table-cell">{i.lifecycle === 'PUBLISHED' && i.type !== 'CREDIT_ADJUSTMENT' ? formatVnd(i.remaining_vnd) : '—'}</Td>
            <Td>
              <InvoiceStatusBadges invoice={i} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
