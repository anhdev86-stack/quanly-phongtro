'use client';

import type { BankConfigDto, BankReconcileOptions, BankSyncResult, BankTransactionDto, Paged } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';
import { billingKeys } from '@/features/billing/api';
import { paymentKeys } from '@/features/payments/api';

export const bankKeys = {
  all: ['bank-transactions'] as const,
  config: ['bank-transactions', 'config'] as const,
};

/** Giao dịch ngân hàng đổi thì thông báo, phiếu thu, công nợ, QR cũng đổi. */
const affected = [bankKeys.all, billingKeys.invoices, paymentKeys.payments, paymentKeys.debts, ['tenancies'], ['invoices', 'settlements'], ['invoices', 'vietqr']];

export const useBankConfig = (enabled = true) =>
  useQuery({ queryKey: bankKeys.config, queryFn: ({ signal }) => api<BankConfigDto>('/bank-transactions/config', { signal }), enabled });

export function useBankTransactions(filters: { status?: string; q?: string; page: number; page_size: number }, enabled = true) {
  return useQuery({
    queryKey: [...bankKeys.all, 'list', filters],
    queryFn: ({ signal }) => api<Paged<BankTransactionDto>>(`/bank-transactions${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export const useBankTransaction = (id: string | null) =>
  useQuery({ queryKey: [...bankKeys.all, 'one', id], queryFn: ({ signal }) => api<BankTransactionDto>(`/bank-transactions/${id}`, { signal }), enabled: !!id });

export const useBankOptions = (id: string | null, enabled: boolean) =>
  useQuery({ queryKey: [...bankKeys.all, 'options', id], queryFn: ({ signal }) => api<BankReconcileOptions>(`/bank-transactions/${id}/options`, { signal }), enabled: enabled && !!id });

/** Đối chiếu tay (ghi vào thông báo / liên kết phiếu thu / không áp dụng): có Idempotency-Key. */
export const useBankAction = () =>
  useApiMutation<{ path: string; body: unknown; key: string }, BankTransactionDto>(({ path, body, key }) => ({ path, method: 'POST', body, idempotencyKey: key }), affected);

export const useBankRetry = () => useApiMutation<string, BankTransactionDto>((id) => ({ path: `/bank-transactions/${id}/retry`, method: 'POST', body: {} }), affected);

export const useBankSync = () => useApiMutation<void, BankSyncResult>(() => ({ path: '/bank-transactions/sync', method: 'POST', body: {} }), [...affected, bankKeys.config]);

export interface SimulateResult {
  mock_id: string;
  delivery: 'WEBHOOK' | 'LOST' | 'BAD_SIGNATURE';
  webhook_status: number | null;
  transaction: BankTransactionDto | null;
}

export const useBankSimulate = () =>
  useApiMutation<Record<string, unknown>, SimulateResult>((body) => ({ path: '/bank-transactions/mock/simulate', method: 'POST', body }), affected);

export const useBankResend = () => useApiMutation<string, SimulateResult>((mockId) => ({ path: `/bank-transactions/mock/${mockId}/resend`, method: 'POST', body: {} }), affected);
