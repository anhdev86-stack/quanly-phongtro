'use client';

import type { TenantDto } from '@ql-tro/shared';
import { BellOff, BellRing } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useReminderConsent } from './api';

const isMobile = (phone: string | null) => !!phone && /^0[35789]\d{8}$/.test(phone);

/** Đồng ý nhận tin nhắc đóng tiền (MASTER_PLAN 9.7): bật phải ghi lại cách người thuê đồng ý; tắt có hiệu lực ngay. */
export function ReminderConsentSection({ tenant, canManage }: { tenant: TenantDto; canManage: boolean }) {
  const toast = useToast();
  const consent = useReminderConsent(tenant.id);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = async (optIn: boolean) => {
    setError('');
    try {
      await consent.mutateAsync({ opt_in: optIn, ...(optIn ? { note } : {}), expected_version: tenant.version });
      toast.success(optIn ? 'Đã bật nhận tin nhắc đóng tiền.' : 'Đã tắt nhận tin. Các tin chưa gửi sẽ không gửi.');
      setOpen(false);
      setNote('');
    } catch (e) {
      const msg = e instanceof ApiError ? (e.fieldErrors?.note?.[0] ?? e.message) : 'Không lưu được.';
      if (optIn) setError(msg);
      else toast.error(msg);
    }
  };

  return (
    <>
      <Card data-testid="reminder-consent">
        <CardHeader>
          <CardTitle>Nhắc đóng tiền qua Zalo/SMS</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {tenant.reminder_opt_in ? (
              <Badge tone="green">
                <BellRing className="mr-1 inline size-3.5" aria-hidden />
                Đã đồng ý nhận tin
              </Badge>
            ) : (
              <Badge tone="gray">
                <BellOff className="mr-1 inline size-3.5" aria-hidden />
                Chưa nhận tin
              </Badge>
            )}
            {tenant.reminder_opt_in && tenant.reminder_consent_at ? (
              <span className="text-slate-600" data-testid="consent-detail">
                từ {new Date(tenant.reminder_consent_at).toLocaleDateString('vi-VN')}
                {tenant.reminder_consent_note ? ` · ${tenant.reminder_consent_note}` : ''}
              </span>
            ) : null}
          </div>
          {!isMobile(tenant.phone) ? <p className="text-amber-800">Chưa có số di động hợp lệ — hệ thống sẽ không gửi tin cho người này.</p> : null}
          {canManage ? (
            <div>
              {tenant.reminder_opt_in ? (
                <Button variant="outline" size="sm" onClick={() => void submit(false)} disabled={consent.isPending}>
                  Tắt nhận tin
                </Button>
              ) : (
                <Button size="sm" onClick={() => setOpen(true)}>
                  Ghi nhận đồng ý
                </Button>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Ghi nhận đồng ý nhận tin"
        description="Chỉ bật khi người thuê đã đồng ý nhận tin nhắc đóng tiền. Tin chỉ gồm số điện thoại và nội dung nhắc, không gửi CCCD hay địa chỉ."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button onClick={() => void submit(true)} disabled={consent.isPending}>
              Bật nhận tin
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <Field id="consent-note" label="Cách người thuê đồng ý" required hint="VD: Ký phụ lục hợp đồng ngày 06/10; nhắn Zalo xác nhận.">
          <Textarea id="consent-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
