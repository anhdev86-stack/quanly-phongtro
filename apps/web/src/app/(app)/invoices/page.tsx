'use client';

import { BILLING_RESULT_LABELS, type BillingResult, INVOICE_LIFECYCLE_LABELS, PAYMENT_STATUS_LABELS, PERMISSIONS } from '@ql-tro/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Calculator, Send } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormError, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { billingKeys, publishDraft, useBillingRun, useInvoices } from '@/features/billing/api';
import { InvoiceTable } from '@/features/billing/invoice-table';
import { useBuildings } from '@/features/property/api';
import { ApiError } from '@/lib/api-client';
import { formatVnd, todayLocal } from '@/lib/format';

const RESULT_TONES: Record<keyof typeof BILLING_RESULT_LABELS, BadgeTone> = {
  READY: 'green',
  CREATED: 'green',
  BLOCKED: 'amber',
  EXISTS: 'gray',
  DRAFT_PENDING: 'amber',
  ERROR: 'red',
};

const money = (v: string | null) => (v === null ? '—' : v.startsWith('-') ? `− ${formatVnd(v.slice(1))}` : formatVnd(v));

function InvoicesContent() {
  const can = useCan();
  const search = useSearchParams();
  const buildings = useBuildings();
  const [filters, setFilters] = useState({
    period: search.get('period') ?? todayLocal().slice(0, 7),
    building_id: search.get('building_id') ?? '',
    lifecycle: '',
    payment_status: '',
    q: '',
    page: 1,
    page_size: 30,
  });
  const list = useInvoices(filters);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <>
      <PageHeader
        title="Thông báo tiền phòng"
        description="Mỗi tháng: nhập chỉ số → xem trước → tạo nháp → kiểm tra → phát hành. Thông báo đã phát hành không sửa; thay đổi sau đó được đối soát ở kỳ kế tiếp."
        actions={
          <Link href="/invoices/periods" className={buttonVariants({ variant: 'outline' })}>
            Kỳ phát hành
          </Link>
        }
      />
      <FilterBar>
        <Field id="iv-period" label="Tháng phát hành" className="sm:w-44">
          <TextInput id="iv-period" type="month" value={filters.period} onChange={(e) => set({ period: e.target.value })} />
        </Field>
        <Field id="iv-building" label="Tòa" className="sm:w-44">
          <Select id="iv-building" value={filters.building_id} onChange={(e) => set({ building_id: e.target.value })}>
            <option value="">Tất cả tòa</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="iv-lifecycle" label="Vòng đời" className="sm:w-40">
          <Select id="iv-lifecycle" value={filters.lifecycle} onChange={(e) => set({ lifecycle: e.target.value })}>
            <option value="">Tất cả</option>
            {Object.entries(INVOICE_LIFECYCLE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="iv-pay" label="Thanh toán" className="sm:w-40">
          <Select id="iv-pay" value={filters.payment_status} onChange={(e) => set({ payment_status: e.target.value })}>
            <option value="">Tất cả</option>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
            <option value="OVERDUE">Quá hạn</option>
          </Select>
        </Field>
        <Field id="iv-q" label="Tìm số, phòng, khách" className="sm:w-52">
          <TextInput id="iv-q" type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        </Field>
      </FilterBar>

      {can(PERMISSIONS.BILLING_GENERATE) && filters.period ? <BillingRunPanel period={filters.period} buildingId={filters.building_id} /> : null}

      <Card>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Chưa có thông báo phù hợp" />
        ) : (
          <InvoiceTable items={list.data.items} />
        )}
        {list.data ? (
          <div className="px-3 pb-3">
            <Pagination page={filters.page} pageSize={filters.page_size} total={list.data.total} onPage={(page) => set({ page })} />
          </div>
        ) : null}
      </Card>
    </>
  );
}

/** Tháng tiêu thụ có điện nước vào thông báo tháng `period` (tháng trước đó). */
function previousMonth(period: string): string {
  const d = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Xem trước (không ghi gì) → tạo nháp (idempotent) → phát hành các nháp không có lỗi. Kết quả theo từng phòng (8.7). */
function BillingRunPanel({ period, buildingId }: { period: string; buildingId: string }) {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const preview = useBillingRun('preview');
  const generate = useBillingRun('generate');
  const [result, setResult] = useState<{ kind: 'preview' | 'generate'; data: BillingResult } | null>(null);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const run = async (kind: 'preview' | 'generate') => {
    setError('');
    try {
      const data = await (kind === 'preview' ? preview : generate).mutateAsync({ period, ...(buildingId ? { building_id: buildingId } : {}) });
      setResult({ kind, data });
      if (kind === 'generate') {
        const created = data.items.filter((i) => i.status === 'CREATED').length;
        toast.success(`Đã tạo ${created} nháp; ${data.items.length - created} phòng không tạo mới (xem bảng kết quả).`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không chạy được.');
    }
  };
  const publishable = (result?.data.items ?? []).filter((i) => i.invoice_id && (i.status === 'CREATED' || i.status === 'DRAFT_PENDING') && i.errors.every((e) => e.code === 'DRAFT_PENDING'));
  const publishAll = async () => {
    setPublishing(true);
    let ok = 0;
    const failed: string[] = [];
    // Lần lượt từng nháp: mỗi thông báo atomic, lỗi một phòng không ảnh hưởng phòng khác.
    for (const item of publishable) {
      try {
        await publishDraft(item.invoice_id!);
        ok++;
      } catch (e) {
        failed.push(`${item.room_code}: ${e instanceof ApiError ? e.message : 'lỗi'}`);
      }
    }
    setPublishing(false);
    await queryClient.invalidateQueries({ queryKey: billingKeys.invoices });
    if (failed.length) setError(`Đã phát hành ${ok}; chưa phát hành được: ${failed.join('; ')}`);
    else toast.success(`Đã phát hành ${ok} thông báo.`);
    setResult(null);
  };

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Tính phí tháng {period.slice(5)}/{period.slice(0, 4)}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void run('preview')} disabled={preview.isPending}>
            <Calculator className="size-4" aria-hidden />
            Xem trước
          </Button>
          <Button size="sm" onClick={() => void run('generate')} disabled={generate.isPending}>
            Tạo nháp
          </Button>
          {can(PERMISSIONS.INVOICES_PUBLISH) && result?.kind === 'generate' && publishable.length ? (
            <Button size="sm" variant="outline" onClick={() => void publishAll()} disabled={publishing}>
              <Send className="size-4" aria-hidden />
              Phát hành {publishable.length} nháp hợp lệ
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {error ? (
        <CardContent>
          <FormError message={error} />
        </CardContent>
      ) : null}
      {result ? (
        result.data.items.length === 0 ? (
          <EmptyState title="Không có lần thuê nào cần tính phí trong tháng này" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Phòng</Th>
                <Th>Kết quả</Th>
                <Th className="text-right">Tổng</Th>
                <Th className="hidden md:table-cell">Ghi chú</Th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((i) => (
                <Tr key={i.tenancy_id}>
                  <Td>
                    {i.invoice_id ? (
                      <Link href={`/invoices/${i.invoice_id}`} className="text-brand-800 hover:underline">
                        {i.building_code} · {i.room_code}
                      </Link>
                    ) : (
                      `${i.building_code} · ${i.room_code}`
                    )}
                    <div className="text-xs text-slate-500">{i.primary_tenant_name ?? '—'}</div>
                  </Td>
                  <Td>
                    <Badge tone={RESULT_TONES[i.status]}>{BILLING_RESULT_LABELS[i.status]}</Badge>
                  </Td>
                  <Td className="text-right tabular whitespace-nowrap">{money(i.subtotal_vnd)}</Td>
                  <Td className="hidden text-sm text-slate-600 md:table-cell">
                    {i.errors.map((e) => (
                      <div key={e.code + e.message}>{e.message}</div>
                    ))}
                    {result.kind === 'preview' && i.lines.length ? <div className="text-xs text-slate-400">{i.lines.length} dòng phí</div> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )
      ) : (
        <CardContent className="text-sm text-slate-500">
          Xem trước không ghi gì. Tạo nháp chạy lại nhiều lần vẫn chỉ có một thông báo mỗi phòng mỗi tháng. Thông báo tháng này tính điện nước tháng {previousMonth(period).slice(5)}/{previousMonth(period).slice(0, 4)} — chốt chỉ số trước khi tạo (
          <Link href={`/readings?month=${previousMonth(period)}${buildingId ? `&building_id=${buildingId}` : ''}`} className="text-brand-800 hover:underline">
            Chốt chỉ số điện nước
          </Link>
          ).
        </CardContent>
      )}
    </Card>
  );
}

export default function InvoicesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<LoadingState />}>
        <InvoicesContent />
      </Suspense>
    </div>
  );
}
