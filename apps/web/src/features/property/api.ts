'use client';

import type { Building, Paged, Reservation, Room } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';

export const propertyKeys = {
  buildings: ['buildings'] as const,
  building: (id: string) => ['buildings', id] as const,
  rooms: ['rooms'] as const,
  room: (id: string) => ['rooms', 'detail', id] as const,
  reservations: ['reservations'] as const,
};

// ---------- Tòa ----------

export function useBuildings(includeArchived = false) {
  return useQuery({
    queryKey: [...propertyKeys.buildings, { includeArchived }],
    queryFn: ({ signal }) => api<Building[]>(`/buildings${qs({ include_archived: includeArchived })}`, { signal }),
  });
}

export function useBuilding(id: string) {
  return useQuery({ queryKey: propertyKeys.building(id), queryFn: ({ signal }) => api<Building>(`/buildings/${id}`, { signal }) });
}

export interface BuildingInput {
  code: string;
  name: string;
  address: string | null;
  floors: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  note: string | null;
}

/** Giá điện nước gửi kèm form tòa (D-043). Tạo: không bắt buộc; sửa: chỉ gửi khi đổi, kèm kỳ áp dụng và lý do. */
export interface BuildingMeterPricesInput {
  ELECTRICITY: string | null;
  WATER: string | null;
  effective_from: string | null;
  reason?: string;
  confirm_existing_readings?: boolean;
}

// Giá điện nước và bảng chỉ số đọc giá theo tòa: làm mới cùng tòa.
const BUILDING_PRICE_KEYS = [['meter-prices'], ['reading-sheet']] as const;

export const useCreateBuilding = () =>
  useApiMutation<BuildingInput & { meter_prices?: BuildingMeterPricesInput | null }, Building>((body) => ({ path: '/buildings', method: 'POST', body }), [
    propertyKeys.buildings,
    ...BUILDING_PRICE_KEYS,
  ]);

export const useUpdateBuilding = (id: string) =>
  useApiMutation<Partial<BuildingInput> & { expected_version: number; meter_prices?: BuildingMeterPricesInput | null }, Building>(
    (body) => ({ path: `/buildings/${id}`, method: 'PATCH', body }),
    [propertyKeys.buildings, ...BUILDING_PRICE_KEYS],
  );

export const useArchiveBuilding = () =>
  useApiMutation<{ id: string; archive: boolean; expected_version: number }, Building>(
    ({ id, archive, expected_version }) => ({ path: `/buildings/${id}/${archive ? 'archive' : 'unarchive'}`, method: 'POST', body: { expected_version } }),
    [propertyKeys.buildings, propertyKeys.rooms],
  );

// ---------- Phòng ----------

export interface RoomFilters {
  building_id?: string;
  status?: string;
  floor?: string;
  q?: string;
  page: number;
  page_size: number;
}

export function useRooms(filters: RoomFilters) {
  return useQuery({
    queryKey: [...propertyKeys.rooms, filters],
    queryFn: ({ signal }) => api<Paged<Room>>(`/rooms${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export function useRoom(id: string) {
  return useQuery({ queryKey: propertyKeys.room(id), queryFn: ({ signal }) => api<Room>(`/rooms/${id}`, { signal }) });
}

export interface RoomInput {
  building_id: string;
  code: string;
  floor: number | null;
  area_m2: string | null;
  default_rent_vnd: string;
  max_occupants: number;
  amenities: string[];
  note: string | null;
  /** Chỉ khi thêm phòng: chỉ số ban đầu của đồng hồ điện/nước (nhập một lần). */
  initial_readings?: { ELECTRICITY: string | null; WATER: string | null };
}

export const useCreateRoom = () =>
  useApiMutation<RoomInput, Room>((body) => ({ path: '/rooms', method: 'POST', body }), [propertyKeys.rooms, propertyKeys.buildings]);

export const useUpdateRoom = (id: string) =>
  useApiMutation<Partial<Omit<RoomInput, 'building_id' | 'initial_readings'>> & { expected_version: number }, Room>(
    (body) => ({ path: `/rooms/${id}`, method: 'PATCH', body }),
    [propertyKeys.rooms],
  );

export const useSetRoomStatus = (id: string) =>
  useApiMutation<{ status: 'READY' | 'MAINTENANCE'; note: string | null; expected_version: number }, Room>(
    (body) => ({ path: `/rooms/${id}/set-operational-status`, method: 'POST', body }),
    [propertyKeys.rooms],
  );

export const useArchiveRoom = (id: string) =>
  useApiMutation<{ archive: boolean; expected_version: number }, Room>(
    ({ archive, expected_version }) => ({ path: `/rooms/${id}/${archive ? 'archive' : 'unarchive'}`, method: 'POST', body: { expected_version } }),
    [propertyKeys.rooms, propertyKeys.buildings],
  );

// ---------- Giữ phòng ----------

export function useReservations(filters: { room_id?: string; building_id?: string; status?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: [...propertyKeys.reservations, filters],
    queryFn: ({ signal }) => api<Paged<Reservation>>(`/reservations${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export interface ReservationDates {
  hold_from: string;
  expected_move_in: string;
  hold_until: string;
}

export const useCreateReservation = () =>
  useApiMutation<ReservationDates & { room_id: string; contact_name: string; contact_phone: string | null; note: string | null }, Reservation>(
    (body) => ({ path: '/reservations', method: 'POST', body }),
    [propertyKeys.reservations, propertyKeys.rooms],
  );

export const useRescheduleReservation = () =>
  useApiMutation<ReservationDates & { id: string; expected_version: number }, Reservation>(
    ({ id, ...body }) => ({ path: `/reservations/${id}/reschedule`, method: 'POST', body }),
    [propertyKeys.reservations, propertyKeys.rooms],
  );

export const useCancelReservation = () =>
  useApiMutation<{ id: string; reason: string; expected_version: number }, Reservation>(
    ({ id, ...body }) => ({ path: `/reservations/${id}/cancel`, method: 'POST', body }),
    [propertyKeys.reservations, propertyKeys.rooms],
  );
