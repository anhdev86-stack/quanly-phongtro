'use client';

import { PERMISSIONS, SERVICE_TYPE_LABELS, type TenancyDetail } from '@ql-tro/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useServices } from '@/features/tenancy/api';
import { ApiError } from '@/lib/api-client';
import { firstOfNextMonth, formatBusinessDate, todayLocal } from '@/lib/format';
import { useTenancyServiceChange } from './api';

type Action = 'ADD' | 'CHANGE_QUANTITY' | 'STOP';
type Sub = TenancyDetail['services'][number];

const ACTION_TITLES: Record<Action, string> = { ADD: 'Thêm dịch vụ', CHANGE_QUANTITY: 'Đổi số lượng', STOP: 'Ngưng dịch vụ' };

/** Dịch vụ của lần thuê có phiên bản theo ngày (MASTER_PLAN 8.4). Điện nước theo đồng hồ quản lý ở mục Đồng hồ. */
export function TenancyServicesSection({ tenancy }: { tenancy: TenancyDetail }) {
  const can = useCan();
  const [dialog, setDialog] = useState<{ action: Action; sub: Sub | null } | null>(null);
  const today = todayLocal();
  const manage = can(PERMISSIONS.SERVICES_MANAGE) && tenancy.status !== 'ENDED';
  const isCurrent = (s: Sub) => s.status === 'ACTIVE' && (!s.end_exclusive || s.end_exclusive > today);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Dịch vụ</CardTitle>
        {manage ? (
          <Button size="sm" variant="outline" onClick={() => setDialog({ action: 'ADD', sub: null })}>
            <Plus className="size-4" aria-hidden />
            Thêm dịch vụ
          </Button>
        ) : null}
      </CardHeader>
      {tenancy.services.length === 0 ? (
        <EmptyState title="Chưa dùng dịch vụ nào" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Dịch vụ</Th>
              <Th>Khoảng</Th>
              <Th className="text-right">Số lượng</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tenancy.services.map((s) => (
              <Tr key={s.id} className={s.status === 'VOIDED' ? 'opacity-50 line-through' : ''}>
                <Td>
                  {s.service_name}
                  <div className="text-xs text-slate-500">{SERVICE_TYPE_LABELS[s.service_type as keyof typeof SERVICE_TYPE_LABELS] ?? s.service_type}</div>
                </Td>
                <Td className="tabular whitespace-nowrap">
                  {formatBusinessDate(s.effective_from)} → {s.end_exclusive ? `trước ${formatBusinessDate(s.end_exclusive)}` : 'nay'}
                </Td>
                <Td className="text-right tabular">
                  {s.quantity.replace(/\.00$/, '')} {s.unit}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {manage && isCurrent(s) ? (
                    <>
                      {s.service_type !== 'FIXED_ROOM' ? (
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ action: 'CHANGE_QUANTITY', sub: s })}>
                          Đổi số lượng
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setDialog({ action: 'STOP', sub: s })}>
                        Ngưng
                      </Button>
                    </>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog ? ACTION_TITLES[dialog.action] : ''} description="Mặc định có hiệu lực từ ngày 1 tháng sau; giữa tháng thì phí tháng đó chia theo ngày.">
        {dialog ? <ServiceChangeForm tenancy={tenancy} action={dialog.action} sub={dialog.sub} onClose={() => setDialog(null)} /> : null}
      </Dialog>
    </Card>
  );
}

function ServiceChangeForm({ tenancy, action, sub, onClose }: { tenancy: TenancyDetail; action: Action; sub: Sub | null; onClose: () => void }) {
  const toast = useToast();
  const services = useServices();
  const change = useTenancyServiceChange(tenancy.id);
  const options = (services.data ?? []).filter((s) => s.type !== 'METER' && !s.archived_at);
  const [v, setV] = useState({
    service_id: sub?.service_id ?? '',
    effective_from: firstOfNextMonth(todayLocal()),
    quantity: sub ? String(Number(sub.quantity) + (action === 'CHANGE_QUANTITY' ? 1 : 0)) : '1',
    reason: '',
    confirm_mid_month: false,
    confirm_dual_utility: false,
  });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const serviceId = v.service_id || options[0]?.id || '';
  const mid = !v.effective_from.endsWith('-01');

  const submit = async () => {
    setError('');
    setFe({});
    try {
      await change.mutateAsync({
        action,
        service_id: serviceId,
        effective_from: v.effective_from,
        confirm_mid_month: mid && v.confirm_mid_month,
        ...(action !== 'STOP' ? { quantity: v.quantity } : {}),
        ...(action === 'ADD' ? { reason: v.reason.trim() || null, confirm_dual_utility: v.confirm_dual_utility } : { reason: v.reason.trim() }),
      });
      toast.success(`${ACTION_TITLES[action]}: đã lưu từ ${formatBusinessDate(v.effective_from)}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFe(e.fieldErrors ?? {});
      } else setError('Không lưu được.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {action === 'ADD' ? (
          <Field id="sv-service" label="Dịch vụ" required className="sm:col-span-2" error={fe.service_id?.[0]}>
            <Select id="sv-service" value={serviceId} onChange={(e) => setV({ ...v, service_id: e.target.value, confirm_dual_utility: false })}>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.unit})
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-sm sm:col-span-2">
            {sub?.service_name}: đang {sub?.quantity.replace(/\.00$/, '')} {sub?.unit}
          </p>
        )}
        <Field id="sv-from" label={action === 'STOP' ? 'Ngưng từ ngày (ngày đầu không dùng)' : 'Có hiệu lực từ'} required error={fe.effective_from?.[0]}>
          <TextInput id="sv-from" type="date" value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value })} />
        </Field>
        {action !== 'STOP' ? (
          <Field id="sv-qty" label="Số lượng" required error={fe.quantity?.[0]}>
            <TextInput id="sv-qty" inputMode="numeric" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value.replace(/[^\d]/g, '') })} />
          </Field>
        ) : null}
        <Field id="sv-reason" label="Lý do" required={action !== 'ADD'} className="sm:col-span-2" error={fe.reason?.[0]}>
          <TextInput id="sv-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
      </div>
      {mid ? (
        <Checkbox id="sv-mid" checked={v.confirm_mid_month} onChange={(confirm_mid_month) => setV({ ...v, confirm_mid_month })}>
          Thay đổi giữa tháng: tôi xác nhận phí tháng đó tính theo số ngày của từng mức.
        </Checkbox>
      ) : null}
      {fe.confirm_dual_utility ? (
        <Checkbox id="sv-dual" checked={v.confirm_dual_utility} onChange={(confirm_dual_utility) => setV({ ...v, confirm_dual_utility })}>
          Tôi xác nhận tính cả khoản theo đồng hồ và dịch vụ này (hai khoản độc lập).
        </Checkbox>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={change.isPending || !serviceId}>
          Lưu
        </Button>
      </div>
    </div>
  );
}
