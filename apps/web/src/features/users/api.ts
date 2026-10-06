'use client';

import type { UserDto } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useApiMutation } from '@/lib/query';

const key = ['users'] as const;

export const useUsers = () => useQuery({ queryKey: key, queryFn: ({ signal }) => api<UserDto[]>('/users', { signal }) });

export const useCreateUser = () =>
  useApiMutation<{ email: string; display_name: string; password: string; role: string; building_ids: string[] }, UserDto>(
    (body) => ({ path: '/users', method: 'POST', body }),
    [key],
  );

export const useUpdateUser = () =>
  useApiMutation<{ id: string; display_name?: string; is_active?: boolean; role?: string; expected_version: number }, UserDto>(
    ({ id, ...body }) => ({ path: `/users/${id}`, method: 'PATCH', body }),
    [key],
  );

export const useSetUserScopes = () =>
  useApiMutation<{ id: string; building_ids: string[]; expected_version: number }, UserDto>(
    ({ id, ...body }) => ({ path: `/users/${id}/building-scopes`, method: 'PUT', body }),
    [key],
  );

export const useResetPassword = () =>
  useApiMutation<{ id: string; new_password: string; expected_version: number }, UserDto>(
    ({ id, ...body }) => ({ path: `/users/${id}/reset-password`, method: 'POST', body }),
    [key],
  );
