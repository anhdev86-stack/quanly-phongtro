'use client';

import type { ExpenseDto, Paged } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';

export const expenseKeys = { all: ['expenses'] as const };

export function useExpenses(filters: { from?: string; to?: string; building_id?: string; category?: string; status?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: [...expenseKeys.all, filters],
    queryFn: ({ signal }) => api<Paged<ExpenseDto> & { total_vnd: string }>(`/expenses${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

/** Ghi/đảo chi phí: thao tác tiền gửi Idempotency-Key, tạo một lần cho mỗi lần mở hộp thoại (bấm lặp không ghi hai lần). */
export const useCreateExpense = () =>
  useApiMutation<{ body: Record<string, unknown>; key: string }, ExpenseDto>(({ body, key }) => ({ path: '/expenses', method: 'POST', body, idempotencyKey: key }), [expenseKeys.all, ['reports']]);

export const useReverseExpense = () =>
  useApiMutation<{ id: string; reason: string; key: string }, ExpenseDto>(
    ({ id, reason, key }) => ({ path: `/expenses/${id}/reverse`, method: 'POST', body: { reason }, idempotencyKey: key }),
    [expenseKeys.all, ['reports']],
  );
