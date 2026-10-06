'use client';

import { STATEMENT_ENTRY_LABELS, type TenancyDetail } from '@ql-tro/shared';
import Link from 'next/link';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { useStatement } from './api';

const signed = (v: string) => (v.startsWith('-') ? `− ${formatVnd(v.slice(1))}` : formatVnd(v));

/** Sao kê công nợ của lần thuê; số dư âm là đang nợ khách (credit). */
export function StatementSection({ tenancy }: { tenancy: TenancyDetail }) {
  const st = useStatement(tenancy.id);
  return (
    <Card id="statement">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Sao kê công nợ</CardTitle>
        {st.data ? (
          <span className="text-sm">
            Còn nợ <strong className="tabular">{formatVnd(st.data.debt_vnd)}</strong>
            {st.data.credit_available_vnd !== '0' ? (
              <>
                {' '}
                · credit còn lại <strong className="tabular text-violet-700">{formatVnd(st.data.credit_available_vnd)}</strong>
              </>
            ) : null}
          </span>
        ) : null}
      </CardHeader>
      {st.isPending ? (
        <LoadingState />
      ) : st.isError ? (
        <ErrorState error={st.error} onRetry={() => void st.refetch()} />
      ) : st.data.entries.length === 0 ? (
        <EmptyState title="Chưa có phát sinh" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Ngày</Th>
                <Th>Nội dung</Th>
                <Th className="text-right">Phát sinh</Th>
                <Th className="text-right">Thu/giảm</Th>
                <Th className="hidden text-right sm:table-cell">Số dư</Th>
              </tr>
            </thead>
            <tbody>
              {st.data.entries.map((e) => (
                <Tr key={`${e.kind}-${e.ref_id}`}>
                  <Td className="tabular whitespace-nowrap">{formatBusinessDate(e.date)}</Td>
                  <Td>
                    <span className="text-xs text-slate-500">{STATEMENT_ENTRY_LABELS[e.kind]} </span>
                    {e.kind === 'INVOICE' || e.kind === 'CREDIT_NOTE' ? (
                      <Link href={`/invoices/${e.ref_id}`} className="text-brand-800 hover:underline">
                        {e.ref_number}
                      </Link>
                    ) : (
                      e.ref_number
                    )}
                    <div className="text-xs text-slate-600">{e.description}</div>
                  </Td>
                  <Td className="text-right tabular">{e.debit_vnd !== '0' ? formatVnd(e.debit_vnd) : ''}</Td>
                  <Td className="text-right tabular text-emerald-700">{e.credit_vnd !== '0' ? formatVnd(e.credit_vnd) : ''}</Td>
                  <Td className="hidden text-right tabular sm:table-cell">{signed(e.balance_vnd)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <CardContent className="flex justify-end border-t border-slate-100 text-sm">
            Số dư cuối: <strong className="ml-1 tabular">{signed(st.data.balance_vnd)}</strong>
          </CardContent>
        </>
      )}
    </Card>
  );
}
