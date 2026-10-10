'use client';

import { type ContractDto, PERMISSIONS, type PermissionCode } from '@ql-tro/shared';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useCan } from '@/features/auth/permissions';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { ContractStatusBadge, expiryText } from './contract-status';

export interface ContractRowActions {
  onSign?: (c: ContractDto) => void;
  onCancel?: (c: ContractDto) => void;
  /** V1.1: lập phụ lục cho hợp đồng đã ký đang hiệu lực/chưa bắt đầu. */
  onRevise?: (c: ContractDto) => void;
}

/** Hủy được: nháp, hoặc đã ký nhưng chưa bắt đầu (cần quyền riêng). Hợp đồng đang hiệu lực kết thúc qua trả phòng. */
export function canCancel(c: ContractDto, can: (...p: PermissionCode[]) => boolean): boolean {
  if (!can(PERMISSIONS.CONTRACTS_MANAGE)) return false;
  if (c.status === 'DRAFT') return true;
  return c.status === 'SCHEDULED' && can(PERMISSIONS.CONTRACTS_CANCEL_SIGNED);
}

export function ContractTable({ items, showTenancy = false, actions = {} }: { items: ContractDto[]; showTenancy?: boolean; actions?: ContractRowActions }) {
  const can = useCan();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Mã</Th>
          {showTenancy ? <Th>Phòng / người đại diện</Th> : null}
          <Th>Kỳ hợp đồng</Th>
          <Th>Trạng thái</Th>
          <Th className="hidden text-right md:table-cell">Giá / cọc theo kỳ</Th>
          <Th className="hidden lg:table-cell">Ký ngày</Th>
          {actions.onSign || actions.onCancel || actions.onRevise ? <Th /> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <Tr key={c.id} className={c.status === 'CANCELLED' ? 'opacity-60' : ''}>
            <Td className="font-medium whitespace-nowrap">
              {c.code}
              {c.previous_contract_id ? <div className="text-xs font-normal text-slate-500">Gia hạn</div> : null}
            </Td>
            {showTenancy ? (
              <Td>
                <Link href={`/tenancies/${c.tenancy_id}`} className="font-medium text-brand-600 hover:underline">
                  {c.building_code} · {c.room_code}
                </Link>
                <div className="text-xs text-slate-500">{c.primary_tenant_name ?? '—'}</div>
              </Td>
            ) : null}
            <Td className="tabular whitespace-nowrap">
              {formatBusinessDate(c.term_start)} → {formatBusinessDate(c.term_end)}
            </Td>
            <Td>
              <ContractStatusBadge status={c.status} />
              {c.status === 'ACTIVE' || c.status === 'EXPIRED' ? <div className="text-xs text-slate-500">{expiryText(c.days_to_expiry)}</div> : null}
              {c.cancellation_reason ? <div className="text-xs text-slate-500">Lý do: {c.cancellation_reason}</div> : null}
            </Td>
            <Td className="hidden text-right tabular md:table-cell">
              <div>{c.terms.monthly_rent_vnd ? formatVnd(c.terms.monthly_rent_vnd) : '—'}</div>
              <div className="text-xs text-slate-500">{c.terms.deposit_required_vnd ? `cọc ${formatVnd(c.terms.deposit_required_vnd)}` : ''}</div>
            </Td>
            <Td className="hidden tabular lg:table-cell">{c.signed_at ? formatBusinessDate(c.signed_at) : '—'}</Td>
            {actions.onSign || actions.onCancel || actions.onRevise ? (
              <Td className="text-right whitespace-nowrap">
                {actions.onRevise && (c.status === 'ACTIVE' || c.status === 'SCHEDULED') && can(PERMISSIONS.CONTRACTS_MANAGE) ? (
                  <Button size="sm" variant="outline" onClick={() => actions.onRevise!(c)}>
                    Phụ lục
                  </Button>
                ) : null}
                {actions.onSign && c.status === 'DRAFT' && can(PERMISSIONS.CONTRACTS_MANAGE) ? (
                  <Button size="sm" variant="outline" onClick={() => actions.onSign!(c)}>
                    Xác nhận đã ký
                  </Button>
                ) : null}
                {actions.onCancel && canCancel(c, can) ? (
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => actions.onCancel!(c)}>
                    Hủy
                  </Button>
                ) : null}
              </Td>
            ) : null}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
