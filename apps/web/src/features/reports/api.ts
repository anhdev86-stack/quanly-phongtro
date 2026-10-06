'use client';

import type { CollectionsReport, Dashboard, RevenueReport } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs } from '@/lib/query';

export const useDashboard = (filters: { building_id?: string; period?: string }) =>
  useQuery({ queryKey: ['dashboard', filters], queryFn: ({ signal }) => api<Dashboard>(`/dashboard${qs({ ...filters })}`, { signal }), placeholderData: (prev) => prev });

export const useRevenue = (filters: { from?: string; to?: string; building_id?: string }) =>
  useQuery({
    queryKey: ['reports', 'revenue', filters],
    queryFn: ({ signal }) => api<RevenueReport>(`/reports/revenue-monthly${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });

export interface DepositsReport {
  rows: {
    tenancy_id: string;
    tenancy_code: string;
    tenancy_status: string;
    room_code: string;
    building_code: string;
    primary_tenant_name: string | null;
    required_vnd: string;
    received_vnd: string;
    applied_vnd: string;
    refunded_vnd: string;
    held_vnd: string;
    shortfall_vnd: string;
    refund_payable_vnd: string;
  }[];
  totals: { held_vnd: string; refund_payable_vnd: string; shortfall_vnd: string };
}

export const useDepositsReport = (filters: { building_id?: string }) =>
  useQuery({ queryKey: ['reports', 'deposits', filters], queryFn: ({ signal }) => api<DepositsReport>(`/reports/deposits${qs({ ...filters })}`, { signal }) });

export const useCollections = (filters: { from?: string; to?: string; building_id?: string }) =>
  useQuery({
    queryKey: ['reports', 'collections', filters],
    queryFn: ({ signal }) => api<CollectionsReport>(`/reports/collections${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });

/** Link tải CSV (GET cùng origin, cookie phiên tự gửi; cùng bộ lọc và phạm vi với màn hình). */
export const exportUrl = (type: string, filters: Record<string, string | undefined>) => `/api/v1/reports/${type}/export${qs(filters)}`;
