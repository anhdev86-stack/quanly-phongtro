'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, type ApiRequestOptions } from './api-client';

/** Dựng query string từ object, bỏ giá trị rỗng. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/**
 * Mutation gọi API rồi invalidate các query liên quan. Không tự thử lại (QueryClient đặt retry=false cho mutation).
 */
export function useApiMutation<TBody, TResult>(
  build: (body: TBody) => { path: string } & ApiRequestOptions,
  invalidate: QueryKey[] = [],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => {
      const { path, ...opts } = build(body);
      return api<TResult>(path, opts);
    },
    onSuccess: async () => {
      await Promise.all(invalidate.map((key) => queryClient.invalidateQueries({ queryKey: key })));
    },
  });
}
