'use client';

import type { DebtRow, InvoiceSettlements, Paged, PaymentAccountDto, PaymentDto, Statement, VietQrDto } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';
import { billingKeys } from '@/features/billing/api';
import { tenancyKeys } from '@/features/tenancy/api';

export const paymentKeys = {
  payments: ['payments'] as const,
  settlements: (invoiceId: string) => ['invoices', 'settlements', invoiceId] as const,
  qr: (invoiceId: string) => ['invoices', 'vietqr', invoiceId] as const,
  links: (invoiceId: string) => ['invoices', 'share-links', invoiceId] as const,
  debts: ['debts'] as const,
  statement: (tenancyId: string) => ['tenancies', 'statement', tenancyId] as const,
  account: ['settings', 'payment-account'] as const,
};

/** Mọi thao tác tiền làm mới thông báo, phiếu thu, công nợ, sao kê, QR. */
const money = [billingKeys.invoices, paymentKeys.payments, paymentKeys.debts, ['tenancies'], tenancyKeys.tenancies];

export const useInvoiceSettlements = (invoiceId: string, enabled = true) =>
  useQuery({ queryKey: paymentKeys.settlements(invoiceId), queryFn: ({ signal }) => api<InvoiceSettlements>(`/invoices/${invoiceId}/settlements`, { signal }), enabled });

export const useInvoiceQr = (invoiceId: string, enabled: boolean) =>
  useQuery({
    queryKey: paymentKeys.qr(invoiceId),
    queryFn: ({ signal }) => api<VietQrDto>(`/invoices/${invoiceId}/vietqr`, { signal }),
    enabled,
    retry: false,
  });

export function usePayments(filters: { tenancy_id?: string; building_id?: string; from?: string; to?: string; status?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: [...paymentKeys.payments, filters],
    queryFn: ({ signal }) => api<Paged<PaymentDto>>(`/payments${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export const usePayment = (id: string) => useQuery({ queryKey: [...paymentKeys.payments, id], queryFn: ({ signal }) => api<PaymentDto>(`/payments/${id}`, { signal }) });

export function useDebts(filters: { building_id?: string; overdue_only?: string; q?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: [...paymentKeys.debts, filters],
    queryFn: ({ signal }) =>
      api<Paged<DebtRow> & { totals: { debt_vnd: string; overdue_vnd: string; credit_available_vnd: string } }>(`/debts${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export const useStatement = (tenancyId: string) =>
  useQuery({ queryKey: paymentKeys.statement(tenancyId), queryFn: ({ signal }) => api<Statement>(`/tenancies/${tenancyId}/statement`, { signal }) });

export const usePaymentAccount = () =>
  useQuery({ queryKey: paymentKeys.account, queryFn: ({ signal }) => api<PaymentAccountDto | null>('/settings/payment-account', { signal }) });

export const useSavePaymentAccount = () =>
  useApiMutation<Record<string, unknown>, PaymentAccountDto>((body) => ({ path: '/settings/payment-account', method: 'PUT', body }), [paymentKeys.account, ['invoices', 'vietqr']]);

/** POST tài chính có Idempotency-Key (phiếu thu, đảo, cấn trừ, hoàn). */
export const useMoneyAction = <T,>() =>
  useApiMutation<{ path: string; body: unknown; key: string }, T>(({ path, body, key }) => ({ path, method: 'POST', body, idempotencyKey: key }), [
    ...money,
    ['invoices', 'settlements'],
    ['invoices', 'vietqr'],
  ]);

export const useShareLinks = (invoiceId: string, enabled: boolean) =>
  useQuery({
    queryKey: paymentKeys.links(invoiceId),
    queryFn: ({ signal }) =>
      api<{ id: string; expires_at: string; revoked_at: string | null; active: boolean; view_count: number; created_by_name: string | null }[]>(`/invoices/${invoiceId}/share-links`, { signal }),
    enabled,
  });

export const useShareLinkAction = (invoiceId: string) =>
  useApiMutation<{ path: string }, { id: string; path?: string; token?: string; expires_at: string }>(({ path }) => ({ path, method: 'POST', body: {} }), [paymentKeys.links(invoiceId)]);
