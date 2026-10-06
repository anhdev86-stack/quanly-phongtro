'use client';

import type { NoticeDto, Paged, SettlementDto, SettlementPreview } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';
import { billingKeys } from '@/features/billing/api';
import { propertyKeys } from '@/features/property/api';
import { tenancyKeys } from '@/features/tenancy/api';

export const moveOutKeys = {
  notices: (tenancyId: string) => ['move-out-notices', tenancyId] as const,
  settlements: ['settlements'] as const,
  settlement: (id: string) => ['settlements', 'detail', id] as const,
  forTenancy: (tenancyId: string) => ['settlements', 'tenancy', tenancyId] as const,
};

/** Trả phòng đụng tới hầu hết dữ liệu: lần thuê, phòng, thông báo, công nợ, cọc, giữ phòng. */
const everything = [moveOutKeys.settlements, ['move-out-notices'], tenancyKeys.tenancies, propertyKeys.rooms, propertyKeys.reservations, billingKeys.invoices, ['payments'], ['debts'], ['tenancies']];

export const useNotices = (tenancyId: string) =>
  useQuery({ queryKey: moveOutKeys.notices(tenancyId), queryFn: ({ signal }) => api<NoticeDto[]>(`/tenancies/${tenancyId}/move-out-notices`, { signal }) });

export const useTenancySettlements = (tenancyId: string) =>
  useQuery({ queryKey: moveOutKeys.forTenancy(tenancyId), queryFn: ({ signal }) => api<SettlementDto[]>(`/tenancies/${tenancyId}/move-out-settlements`, { signal }) });

export const useSettlement = (id: string) => useQuery({ queryKey: moveOutKeys.settlement(id), queryFn: ({ signal }) => api<SettlementDto>(`/settlements/${id}`, { signal }) });

export function useSettlements(filters: { status?: string; financial_status?: string; building_id?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: [...moveOutKeys.settlements, 'list', filters],
    queryFn: ({ signal }) => api<Paged<SettlementDto>>(`/settlements${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

/** POST/PUT cho báo trả, quyết toán, thu/hoàn theo quyết toán (khóa idempotency khi cần). */
export const useMoveOutAction = <T,>() =>
  useApiMutation<{ path: string; body: unknown; method?: 'POST' | 'PUT'; key?: string }, T>(
    ({ path, body, method, key }) => ({ path, method: method ?? 'POST', body, ...(key ? { idempotencyKey: key } : {}) }),
    everything,
  );

export const fetchPreview = (id: string) => api<SettlementPreview>(`/settlements/${id}/preview`, { method: 'POST', body: {} });
