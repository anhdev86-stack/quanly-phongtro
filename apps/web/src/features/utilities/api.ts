'use client';

import type { BillingSettingsDto, MeterPrices, ReadingDto, ReadingSheet, RoomMeters, ServiceDetail, TenancyDetail } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';
import { tenancyKeys } from '@/features/tenancy/api';

export const utilityKeys = {
  meterPrices: (buildingId: string) => ['meter-prices', buildingId] as const,
  sheet: ['reading-sheet'] as const,
  roomMeters: (roomId: string) => ['room-meters', roomId] as const,
  tenancyServices: (tenancyId: string) => ['tenancy-services', tenancyId] as const,
  service: (id: string) => ['services', 'detail', id] as const,
  billing: ['settings', 'billing'] as const,
};

// ---------- Giá điện nước theo tòa ----------

export const useMeterPrices = (buildingId: string, enabled = true) =>
  useQuery({
    queryKey: utilityKeys.meterPrices(buildingId),
    queryFn: ({ signal }) => api<MeterPrices>(`/buildings/${buildingId}/meter-prices`, { signal }),
    enabled: enabled && !!buildingId,
  });

export const useCreateMeterPrice = (buildingId: string) =>
  useApiMutation<Record<string, unknown>, MeterPrices>((body) => ({ path: `/buildings/${buildingId}/meter-prices`, method: 'POST', body }), [
    utilityKeys.meterPrices(buildingId),
    utilityKeys.sheet,
  ]);

// ---------- Nhập chỉ số ----------

/** Bảng chỉ số theo tháng tiêu thụ (YYYY-MM); chỉ số này vào thông báo của tháng sau. */
export const useReadingSheet = (buildingId: string, consumptionMonth: string) =>
  useQuery({
    queryKey: [...utilityKeys.sheet, buildingId, consumptionMonth],
    queryFn: ({ signal }) => api<ReadingSheet>(`/meter-readings/sheet${qs({ building_id: buildingId, consumption_month: consumptionMonth })}`, { signal }),
    enabled: !!buildingId && !!consumptionMonth,
    placeholderData: (prev) => prev,
  });

export const useSaveReadings = () =>
  useApiMutation<{ period: string; read_on: string; items: { meter_id: string; value: string; expected_version?: number }[] }, { saved: ReadingDto[] }>(
    (body) => ({ path: '/meter-readings', method: 'POST', body }),
    [utilityKeys.sheet, ['room-meters']],
  );

export const useCorrectReading = () =>
  useApiMutation<{ id: string; value: string; reason: string; expected_version: number }, ReadingDto>(
    ({ id, ...body }) => ({ path: `/meter-readings/${id}/correct`, method: 'POST', body }),
    [utilityKeys.sheet, ['room-meters'], tenancyKeys.tenancies],
  );

// ---------- Đồng hồ ----------

export const useRoomMeters = (roomId: string) =>
  useQuery({ queryKey: utilityKeys.roomMeters(roomId), queryFn: ({ signal }) => api<RoomMeters>(`/rooms/${roomId}/meters`, { signal }) });

/** POST chung cho gắn/thay/sửa chỉ số ban đầu của đồng hồ. */
export const useMeterAction = (roomId: string) =>
  useApiMutation<{ path: string; body: unknown }, RoomMeters>(({ path, body }) => ({ path, method: 'POST', body }), [utilityKeys.roomMeters(roomId), utilityKeys.sheet]);

// ---------- Dịch vụ ----------

export const useServiceDetail = (id: string | null) =>
  useQuery({ queryKey: utilityKeys.service(id ?? ''), queryFn: ({ signal }) => api<ServiceDetail>(`/services/${id}`, { signal }), enabled: !!id });

export const useServiceMutation = () =>
  useApiMutation<{ path: string; method: 'POST' | 'PATCH'; body: unknown }, ServiceDetail>(({ path, method, body }) => ({ path, method, body }), [tenancyKeys.services]);

export const useTenancyServiceChange = (tenancyId: string) =>
  useApiMutation<Record<string, unknown>, TenancyDetail['services']>((body) => ({ path: `/tenancies/${tenancyId}/services`, method: 'POST', body }), [
    tenancyKeys.tenancies,
    utilityKeys.sheet,
  ]);

// ---------- Cấu hình tính phí ----------

export const useBillingSettings = () => useQuery({ queryKey: utilityKeys.billing, queryFn: ({ signal }) => api<BillingSettingsDto>('/settings/billing', { signal }) });

export const useCreateBillingSettings = () =>
  useApiMutation<Record<string, unknown>, BillingSettingsDto>((body) => ({ path: '/settings/billing', method: 'POST', body }), [utilityKeys.billing, utilityKeys.sheet]);
