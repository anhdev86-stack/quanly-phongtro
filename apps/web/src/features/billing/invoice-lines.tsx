import { type InvoiceLine, LINE_GROUP_LABELS, LINE_GROUPS } from '@ql-tro/shared';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatVnd } from '@/lib/format';

/** Dòng phí tách nhóm “Thu trước”, “Thu sau”, “Điều chỉnh”; mỗi dòng ghi khoảng phí (MASTER_PLAN 12). */
export function InvoiceLines({ items, compact = false }: { items: InvoiceLine[]; compact?: boolean }) {
  if (!items.length) return <p className="px-4 py-6 text-center text-sm text-slate-500">Không có dòng phí.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Khoản</Th>
          {compact ? null : <Th className="hidden text-right sm:table-cell">Số lượng</Th>}
          {compact ? null : <Th className="hidden text-right md:table-cell">Đơn giá</Th>}
          <Th className="text-right">Thành tiền</Th>
        </tr>
      </thead>
      <tbody>
        {LINE_GROUPS.map((g) => {
          const lines = items.filter((l) => l.group === g);
          if (!lines.length) return null;
          return [
            <Tr key={`${g}-head`} className="bg-slate-50">
              <Td colSpan={compact ? 2 : 4} className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                {LINE_GROUP_LABELS[g]}
              </Td>
            </Tr>,
            ...lines.map((l, i) => (
              <Tr key={l.id ?? `${g}-${i}`}>
                <Td>{l.label}</Td>
                {compact ? null : <Td className="hidden text-right tabular sm:table-cell">{l.charge_kind === 'RENT' ? `${l.quantity} ngày` : l.quantity.replace('.', ',')}</Td>}
                {compact ? null : <Td className="hidden text-right tabular md:table-cell">{formatVnd(l.unit_price.split('.')[0]!)}</Td>}
                <Td className={`text-right tabular whitespace-nowrap ${l.direction === 'CREDIT' ? 'text-emerald-700' : ''}`}>
                  {l.direction === 'CREDIT' ? '− ' : ''}
                  {formatVnd(l.amount_vnd)}
                </Td>
              </Tr>
            )),
          ];
        })}
      </tbody>
    </Table>
  );
}
