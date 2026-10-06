'use client';

import type {
  LedgerTxDto,
  MoveInInput,
  Paged,
  ServiceDto,
  TenancyDetail,
  TenancySummary,
  TenantDto,
  TenantInput,
} from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';
import { propertyKeys } from '@/features/property/api';

export const tenancyKeys = {
  tenants: ['tenants'] as const,
  tenant: (id: string) => ['tenants', 'detail', id] as const,
  tenancies: ['tenancies'] as const,
  tenancy: (id: string) => ['tenancies', 'detail', id] as const,
  deposit: (id: string) => ['tenancies', 'deposit', id] as const,
  holding: (id: string) => ['reservations', 'holding', id] as const,
  services: ['services'] as const,
};

const all = [tenancyKeys.tenants, tenancyKeys.tenancies, propertyKeys.rooms, propertyKeys.reservations, ['reservations', 'holding']];

// ---------- Người thuê ----------

export function useTenants(filters: { q?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: [...tenancyKeys.tenants, filters],
    queryFn: ({ signal }) => api<Paged<TenantDto>>(`/tenants${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export const useTenant = (id: string) =>
  useQuery({ queryKey: tenancyKeys.tenant(id), queryFn: ({ signal }) => api<TenantDto>(`/tenants/${id}`, { signal }) });

export const useCreateTenant = () => useApiMutation<TenantInput, TenantDto>((body) => ({ path: '/tenants', method: 'POST', body }), [tenancyKeys.tenants]);

export const useUpdateTenant = (id: string) =>
  useApiMutation<Partial<TenantInput> & { expected_version: number }, TenantDto>((body) => ({ path: `/tenants/${id}`, method: 'PATCH', body }), all);

// ---------- Lần thuê ----------

export function useTenancies(filters: { status?: string; building_id?: string; room_id?: string; tenant_id?: string; q?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: [...tenancyKeys.tenancies, filters],
    queryFn: ({ signal }) => api<Paged<TenancySummary>>(`/tenancies${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export const useTenancy = (id: string, enabled = true) =>
  useQuery({ queryKey: tenancyKeys.tenancy(id), queryFn: ({ signal }) => api<TenancyDetail>(`/tenancies/${id}`, { signal }), enabled });

export const useMoveIn = () =>
  useApiMutation<{ body: MoveInInput; key: string }, { id: string; code: string }>(
    ({ body, key }) => ({ path: '/tenancies/move-in', method: 'POST', body, idempotencyKey: key }),
    all,
  );

export const useMemberAction = () =>
  useApiMutation<{ path: string; body: unknown }, TenancyDetail>(({ path, body }) => ({ path, method: 'POST', body }), all);

// ---------- Cọc và giữ chỗ ----------

export interface DepositLedger {
  summary: TenancyDetail['deposit'];
  transactions: LedgerTxDto[];
}

export const useDepositLedger = (tenancyId: string) =>
  useQuery({
    queryKey: tenancyKeys.deposit(tenancyId),
    queryFn: ({ signal }) => api<DepositLedger>(`/tenancies/${tenancyId}/deposit-transactions`, { signal }),
  });

export const useHoldingLedger = (reservationId: string, enabled = true) =>
  useQuery({
    queryKey: tenancyKeys.holding(reservationId),
    queryFn: ({ signal }) => api<{ balance_vnd: string; transactions: LedgerTxDto[] }>(`/reservations/${reservationId}/holding-transactions`, { signal }),
    enabled,
  });

/** POST một giao dịch tài chính (cọc, giữ chỗ, đảo) với Idempotency-Key. */
export const useLedgerPost = () =>
  useApiMutation<{ path: string; body: unknown; key: string }, unknown>(
    ({ path, body, key }) => ({ path, method: 'POST', body, idempotencyKey: key }),
    [...all, ['tenancies', 'deposit']],
  );

export const useServices = () =>
  useQuery({ queryKey: tenancyKeys.services, queryFn: ({ signal }) => api<ServiceDto[]>('/services', { signal }), staleTime: 60_000 });
