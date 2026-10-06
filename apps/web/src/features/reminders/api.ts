'use client';

import type { Paged, ReminderDto, ReminderSettingsDto, TenantDto } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qs, useApiMutation } from '@/lib/query';
import { tenancyKeys } from '@/features/tenancy/api';

export const reminderKeys = {
  reminders: ['reminders'] as const,
  settings: ['settings', 'reminders'] as const,
};

export function useReminders(filters: { status?: string; building_id?: string; invoice_id?: string; page: number; page_size: number }) {
  return useQuery({
    queryKey: [...reminderKeys.reminders, filters],
    queryFn: ({ signal }) => api<Paged<ReminderDto>>(`/reminders${qs({ ...filters })}`, { signal }),
    placeholderData: (prev) => prev,
  });
}

export const useReminderSettings = () =>
  useQuery({ queryKey: reminderKeys.settings, queryFn: ({ signal }) => api<ReminderSettingsDto>('/settings/reminders', { signal }) });

export const useSaveReminderSettings = () =>
  useApiMutation<Record<string, unknown>, ReminderSettingsDto>((body) => ({ path: '/settings/reminders', method: 'PUT', body }), [reminderKeys.settings, reminderKeys.reminders]);

export const useRunReminders = () =>
  useApiMutation<void, { created: number; sent: number; failed: number; skipped: number; retried: number }>(
    () => ({ path: '/reminders/run', method: 'POST', body: {} }),
    [reminderKeys.reminders, ['dashboard']],
  );

export const useResendReminder = () =>
  useApiMutation<string, ReminderDto>((id) => ({ path: `/reminders/${id}/resend`, method: 'POST', body: {} }), [reminderKeys.reminders, ['dashboard']]);

export const useReminderConsent = (tenantId: string) =>
  useApiMutation<{ opt_in: boolean; note?: string; expected_version: number }, TenantDto>(
    (body) => ({ path: `/tenants/${tenantId}/reminder-consent`, method: 'PUT', body }),
    [tenancyKeys.tenants, reminderKeys.reminders],
  );
