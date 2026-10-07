'use client';

import type { MaintenanceDto, Paged } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';

const key = ['maintenance'] as const;

export const useMaintenance = (filters: { building_id?: string; status?: string; open_only?: string; room_id?: string; page: number; page_size: number }) =>
  useQuery({
    queryKey: [...key, filters],
    queryFn: ({ signal }) => api<Paged<MaintenanceDto>>(`/maintenance-requests${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });

export const useCreateMaintenance = () =>
  useApiMutation<Record<string, unknown>, MaintenanceDto>((body) => ({ path: '/maintenance-requests', method: 'POST', body }), [key, ['dashboard']]);

export const useUpdateMaintenance = () =>
  useApiMutation<{ id: string } & Record<string, unknown>, MaintenanceDto>(({ id, ...body }) => ({ path: `/maintenance-requests/${id}`, method: 'PATCH', body }), [key, ['dashboard']]);
