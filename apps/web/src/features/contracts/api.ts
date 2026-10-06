'use client';

import type { ContractDto, Paged } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';
import { propertyKeys } from '@/features/property/api';
import { tenancyKeys } from '@/features/tenancy/api';

export const contractKeys = {
  all: ['contracts'] as const,
  forTenancy: (tenancyId: string) => ['contracts', 'tenancy', tenancyId] as const,
};

const invalidate = [contractKeys.all, tenancyKeys.tenancies, propertyKeys.rooms];

export interface ContractFilters {
  building_id?: string;
  status?: string;
  expiring_within_days?: number | '';
  page: number;
  page_size: number;
}

export function useContracts(filters: ContractFilters) {
  return useQuery({
    queryKey: [...contractKeys.all, 'list', filters],
    queryFn: ({ signal }) => api<Paged<ContractDto>>(`/contracts${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export const useTenancyContracts = (tenancyId: string) =>
  useQuery({
    queryKey: contractKeys.forTenancy(tenancyId),
    queryFn: ({ signal }) => api<Paged<ContractDto>>(`/tenancies/${tenancyId}/contracts`, { signal }),
  });

/** POST chung cho tạo/gia hạn/ký/hủy hợp đồng và đổi giá; làm mới hợp đồng, lần thuê, phòng. */
export const useContractAction = <T = ContractDto>() =>
  useApiMutation<{ path: string; body: unknown }, T>(({ path, body }) => ({ path, method: 'POST', body }), invalidate);
