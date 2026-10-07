'use client';

import type { AuditCategory, AuditLogDto, Paged } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs } from '@/lib/query';

export interface AuditFilters {
  category?: string;
  building_id?: string;
  action?: string;
  entity_type?: string;
  entity_id?: string;
  from?: string;
  to?: string;
  page: number;
  page_size: number;
}

export const useAuditLogs = (filters: AuditFilters) =>
  useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: ({ signal }) => api<Paged<AuditLogDto> & { categories: AuditCategory[] }>(`/audit-logs${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
