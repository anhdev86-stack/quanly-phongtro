'use client';

import { PERMISSIONS, type TenancyDetail } from '@ql-tro/shared';
import { ArrowRightLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, MoneyInput, Select, TextInput } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { propertyKeys, useRooms } from '@/features/property/api';
import { ApiError, newIdempotencyKey } from '@/lib/api-client';
import { addDays, formatBusinessDate, formatVnd } from '@/lib/format';
import { useApiMutation } from '@/lib/query';
import { tenancyKeys } from './api';

/**
 * Chuyển phòng (V1.1, MASTER_PLAN 7.7). Hiện ở lần thuê đã trả phòng (đã quyết toán): tạo lần thuê mới cho cùng người từ ngày sau ngày
 * cuối tính tiền, chuyển cọc còn giữ bằng cặp giao dịch liên kết. Tiền dư (credit) ở phòng cũ không chuyển.
 */
export function TransferSection({ tenancy: t }: { tenancy: TenancyDetail }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const canTransfer = t.status === 'ENDED' && !t.transferred_to && !!t.last_charge_date && can(PERMISSIONS.TENANCIES_MOVE_IN);
  if (!t.transferred_to && !t.transferred_from && !canTransfer) return null;
  return (
    <Card className="border-brand-200" data-testid="transfer-section">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-col gap-1">
          {t.transferred_from ? (
            <p>
              Chuyển từ{' '}
              <Link href={`/tenancies/${t.transferred_from.tenancy_id}`} className="font-medium text-brand-800 hover:underline">
                {t.transferred_from.building_code} · {t.transferred_from.room_code} ({t.transferred_from.tenancy_code})
              </Link>{' '}
              ngày {formatBusinessDate(t.transferred_from.transfer_date)}; cọc chuyển sang {formatVnd(t.transferred_from.deposit_amount_vnd)}.
            </p>
          ) : null}
          {t.transferred_to ? (
            <p>
              Đã chuyển sang{' '}
              <Link href={`/tenancies/${t.transferred_to.tenancy_id}`} className="font-medium text-brand-800 hover:underline">
                {t.transferred_to.building_code} · {t.transferred_to.room_code} ({t.transferred_to.tenancy_code})
              </Link>{' '}
              ngày {formatBusinessDate(t.transferred_to.transfer_date)}; cọc chuyển đi {formatVnd(t.transferred_to.deposit_amount_vnd)}.
            </p>
          ) : null}
          {canTransfer ? (
            <p className="text-slate-600">
              Khách chuyển sang phòng khác? Tạo lần thuê mới từ ngày {formatBusinessDate(addDays(t.last_charge_date!, 1))} và chuyển cọc đang giữ ({formatVnd(t.deposit.held_vnd)}).
            </p>
          ) : null}
        </div>
        {canTransfer ? (
          <Button onClick={() => setOpen(true)}>
            <ArrowRightLeft className="size-4" aria-hidden />
            Chuyển sang phòng khác
          </Button>
        ) : null}
      </CardContent>
      {open ? <TransferDialog tenancy={t} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function TransferDialog({ tenancy: t, onClose }: { tenancy: TenancyDetail; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const rooms = useRooms({ status: 'AVAILABLE', page: 1, page_size: 100 });
  const [key] = useState(() => newIdempotencyKey());
  const startDate = addDays(t.last_charge_date!, 1);
  // Người còn ở tới ngày cuối tính tiền (chưa rời trước đó).
  const people = t.members.filter((m) => !m.left_on || m.left_on >= t.last_charge_date!);
  const primary0 = people.find((m) => m.role === 'PRIMARY') ?? people[0];
  const [v, setV] = useState({
    to_room_id: '',
    primary_tenant_id: primary0?.tenant_id ?? '',
    members: people.filter((m) => m.tenant_id !== primary0?.tenant_id).map((m) => m.tenant_id),
    monthly_rent_vnd: '',
    deposit_required_vnd: t.deposit.required_vnd,
    deposit_transfer_vnd: t.deposit.held_vnd,
    elec: '',
    water: '',
    reason: '',
  });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const transfer = useApiMutation<Record<string, unknown>, { id: string; code: string; deposit_amount_vnd: string }>(
    (body) => ({ path: `/tenancies/${t.id}/transfer`, method: 'POST', body, idempotencyKey: key }),
    [tenancyKeys.tenancies, propertyKeys.rooms],
  );
  const room = rooms.data?.items.find((r) => r.id === v.to_room_id);

  const submit = async () => {
    setError('');
    setFe({});
    try {
      const r = await transfer.mutateAsync({
        to_room_id: v.to_room_id,
        start_date: startDate,
        primary_tenant_id: v.primary_tenant_id,
        member_tenant_ids: v.members.filter((id) => id !== v.primary_tenant_id),
        monthly_rent_vnd: v.monthly_rent_vnd || room?.default_rent_vnd || '0',
        deposit_required_vnd: v.deposit_required_vnd || '0',
        deposit_transfer_vnd: v.deposit_transfer_vnd || '0',
        meter_readings: [
          ...(v.elec ? [{ type: 'ELECTRICITY', value: v.elec }] : []),
          ...(v.water ? [{ type: 'WATER', value: v.water }] : []),
        ],
        reason: v.reason || undefined,
      });
      toast.success(`Đã chuyển phòng: lần thuê mới ${r.code}, chuyển cọc ${formatVnd(r.deposit_amount_vnd)}.`);
      router.push(`/tenancies/${r.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFe(e.fieldErrors ?? {});
      } else setError('Không chuyển được.');
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Chuyển phòng — ${t.code}`}
      description={`Từ ${t.building_code} · ${t.room_code}. Lần thuê mới bắt đầu ${formatBusinessDate(startDate)} (ngày sau ngày cuối tính tiền). Tiền dư ở phòng cũ không chuyển — cấn trừ hoặc hoàn ở phòng cũ.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={() => void submit()} disabled={transfer.isPending || !v.to_room_id || !v.primary_tenant_id}>
            Chuyển phòng
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="tr-room" label="Phòng mới (đang trống)" required error={fe.to_room_id?.[0]} className="sm:col-span-2">
            <Select id="tr-room" value={v.to_room_id} onChange={(e) => setV({ ...v, to_room_id: e.target.value, monthly_rent_vnd: '' })}>
              <option value="">— Chọn phòng —</option>
              {rooms.data?.items
                .filter((r) => r.id !== t.room_id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.building_code} · {r.code} — {formatVnd(r.default_rent_vnd)}, tối đa {r.max_occupants} người
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="tr-rent" label="Giá thuê / tháng" required hint={room ? `Giá niêm yết: ${formatVnd(room.default_rent_vnd)}` : undefined} error={fe.monthly_rent_vnd?.[0]}>
            <MoneyInput id="tr-rent" value={v.monthly_rent_vnd || room?.default_rent_vnd || ''} onChange={(monthly_rent_vnd) => setV({ ...v, monthly_rent_vnd })} />
          </Field>
          <Field id="tr-required" label="Mức cọc yêu cầu ở phòng mới" error={fe.deposit_required_vnd?.[0]}>
            <MoneyInput id="tr-required" value={v.deposit_required_vnd} onChange={(deposit_required_vnd) => setV({ ...v, deposit_required_vnd })} />
          </Field>
          <Field id="tr-deposit" label="Số cọc chuyển sang" hint={`Đang giữ ở phòng cũ: ${formatVnd(t.deposit.held_vnd)}`} error={fe.deposit_transfer_vnd?.[0]}>
            <MoneyInput id="tr-deposit" value={v.deposit_transfer_vnd} onChange={(deposit_transfer_vnd) => setV({ ...v, deposit_transfer_vnd })} />
          </Field>
          <Field id="tr-primary" label="Người đại diện" required error={fe.primary_tenant_id?.[0]}>
            <Select id="tr-primary" value={v.primary_tenant_id} onChange={(e) => setV({ ...v, primary_tenant_id: e.target.value })}>
              {people.map((m) => (
                <option key={m.tenant_id} value={m.tenant_id}>
                  {m.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="tr-elec" label="Chỉ số điện ban đầu (phòng mới)">
            <TextInput id="tr-elec" inputMode="decimal" value={v.elec} onChange={(e) => setV({ ...v, elec: e.target.value })} />
          </Field>
          <Field id="tr-water" label="Chỉ số nước ban đầu (phòng mới)">
            <TextInput id="tr-water" inputMode="decimal" value={v.water} onChange={(e) => setV({ ...v, water: e.target.value })} />
          </Field>
        </div>
        {people.length > 1 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-slate-700">Người ở cùng chuyển theo</legend>
            {people
              .filter((m) => m.tenant_id !== v.primary_tenant_id)
              .map((m) => (
                <Checkbox
                  key={m.tenant_id}
                  id={`tr-m-${m.tenant_id}`}
                  checked={v.members.includes(m.tenant_id)}
                  onChange={(c) => setV({ ...v, members: c ? [...v.members, m.tenant_id] : v.members.filter((x) => x !== m.tenant_id) })}
                >
                  {m.full_name}
                </Checkbox>
              ))}
          </fieldset>
        ) : null}
        <Field id="tr-reason" label="Lý do / ghi chú">
          <TextInput id="tr-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
