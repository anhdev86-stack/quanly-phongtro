'use client';

import type { BillingResult, InvoiceDetail, InvoiceSummary, Paged } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';
import { tenancyKeys } from '@/features/tenancy/api';

export const billingKeys = {
  invoices: ['invoices'] as const,
  invoice: (id: string) => ['invoices', 'detail', id] as const,
  periods: ['statement-periods'] as const,
};

const invalidate = [billingKeys.invoices, billingKeys.periods, tenancyKeys.tenancies];

export interface InvoiceFilters {
  period?: string;
  building_id?: string;
  tenancy_id?: string;
  lifecycle?: string;
  type?: string;
  payment_status?: string;
  q?: string;
  page: number;
  page_size: number;
}

export function useInvoices(filters: InvoiceFilters, enabled = true) {
  return useQuery({
    queryKey: [...billingKeys.invoices, 'list', filters],
    queryFn: ({ signal }) => api<Paged<InvoiceSummary>>(`/invoices${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export const useInvoice = (id: string) => useQuery({ queryKey: billingKeys.invoice(id), queryFn: ({ signal }) => api<InvoiceDetail>(`/invoices/${id}`, { signal }) });

export const useBillingRun = (kind: 'preview' | 'generate') =>
  useApiMutation<{ period: string; building_id?: string; tenancy_ids?: string[] }, BillingResult>(
    (body) => ({ path: `/billing/${kind}`, method: 'POST', body }),
    kind === 'generate' ? invalidate : [],
  );

/** POST chung cho tính lại/phát hành/hủy/điều chỉnh của một thông báo. */
export const useInvoiceAction = <T,>() => useApiMutation<{ path: string; body: unknown }, T>(({ path, body }) => ({ path, method: 'POST', body }), invalidate);

/** Phát hành lần lượt nhiều nháp (mỗi nháp lấy version và source_hash mới nhất trước khi phát hành). */
export async function publishDraft(id: string) {
  const inv = await api<InvoiceDetail>(`/invoices/${id}`);
  return api<{ invoice: InvoiceDetail }>(`/invoices/${id}/publish`, { method: 'POST', body: { expected_version: inv.version, source_hash: inv.source_hash } });
}
