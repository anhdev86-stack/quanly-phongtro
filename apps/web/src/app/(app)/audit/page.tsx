'use client';

import { AUDIT_CATEGORY_LABELS, type AuditCategory, type AuditLogDto } from '@ql-tro/shared';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useAuditLogs } from '@/features/audit/api';
import { useBuildings } from '@/features/property/api';

const TONE: Record<AuditCategory, BadgeTone> = { OPERATIONS: 'blue', FINANCE: 'violet', SYSTEM: 'gray' };
const dateTime = (v: string) => new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

/** Nhật ký thao tác (V1.1): ai làm gì, khi nào, trước/sau. Phạm vi theo quyền và tòa được giao do API quyết định. */
function AuditContent() {
  const search = useSearchParams();
  const buildings = useBuildings();
  const [f, setF] = useState({
    category: '',
    building_id: '',
    action: '',
    entity_type: search.get('entity_type') ?? '',
    entity_id: search.get('entity_id') ?? '',
    from: '',
    to: '',
    page: 1,
    page_size: 50,
  });
  const logs = useAuditLogs(f);
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch, page: 1 });

  return (
    <>
      <PageHeader title="Nhật ký thao tác" description="Mọi thao tác thay đổi dữ liệu đều được ghi lại, không sửa hay xóa được. Dữ liệu nhạy cảm đã được che khi ghi." />
      <FilterBar>
        <Field id="au-cat" label="Nhóm" className="sm:w-36">
          <Select id="au-cat" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">Tất cả được xem</option>
            {(logs.data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {AUDIT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="au-building" label="Tòa" className="sm:w-40">
          <Select id="au-building" value={f.building_id} onChange={(e) => set({ building_id: e.target.value })}>
            <option value="">Tất cả</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="au-action" label="Thao tác bắt đầu bằng" className="sm:w-48">
          <TextInput id="au-action" placeholder="VD: payment, invoice.publish" value={f.action} onChange={(e) => set({ action: e.target.value.trim() })} />
        </Field>
        <Field id="au-from" label="Từ ngày" className="sm:w-40">
          <TextInput id="au-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field id="au-to" label="Đến ngày" className="sm:w-40">
          <TextInput id="au-to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
        {f.entity_id ? (
          <div className="flex items-end">
            <Button variant="outline" size="sm" onClick={() => set({ entity_id: '', entity_type: '' })}>
              Bỏ lọc đối tượng
            </Button>
          </div>
        ) : null}
      </FilterBar>
      <Card>
        {logs.isPending ? (
          <LoadingState />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        ) : logs.data.items.length === 0 ? (
          <EmptyState title="Không có nhật ký phù hợp" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Thời điểm</Th>
                <Th>Thao tác</Th>
                <Th className="hidden md:table-cell">Người làm</Th>
                <Th className="hidden sm:table-cell">Tòa</Th>
                <Th className="text-right">
                  <span className="sr-only">Chi tiết</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {logs.data.items.map((l) => (
                <AuditRow key={l.id} l={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} />
              ))}
            </tbody>
          </Table>
        )}
        {logs.data ? (
          <div className="px-3 pb-3">
            <Pagination page={f.page} pageSize={f.page_size} total={logs.data.total} onPage={(page) => setF({ ...f, page })} />
          </div>
        ) : null}
      </Card>
    </>
  );
}

function AuditRow({ l, open, onToggle }: { l: AuditLogDto; open: boolean; onToggle: () => void }) {
  return (
    <>
      <Tr data-testid="audit-row">
        <Td className="whitespace-nowrap tabular text-slate-600">{dateTime(l.occurred_at)}</Td>
        <Td>
          <Badge tone={TONE[l.category]}>{AUDIT_CATEGORY_LABELS[l.category]}</Badge> <span className="font-mono text-xs">{l.action}</span>
          <div className="text-xs text-slate-500">
            {l.entity_type}
            {l.entity_id ? ` · ${l.entity_id.slice(0, 8)}…` : ''}
            {l.reason ? ` · Lý do: ${l.reason}` : ''}
          </div>
        </Td>
        <Td className="hidden md:table-cell">{l.actor_name ?? 'Hệ thống'}</Td>
        <Td className="hidden sm:table-cell">{l.building_code ?? '—'}</Td>
        <Td className="text-right">
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={open}>
            {open ? 'Ẩn' : 'Chi tiết'}
          </Button>
        </Td>
      </Tr>
      {open ? (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ['Trước', l.before],
                  ['Sau', l.after],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="min-w-0">
                  <p className="mb-1 text-xs font-semibold text-slate-600">{label}</p>
                  <pre className="max-h-64 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs">{v == null ? '—' : JSON.stringify(v, null, 2)}</pre>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Mã yêu cầu: {l.request_id ?? '—'}</p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AuditContent />
    </Suspense>
  );
}
