'use client';

import { CHARGE_TIMING_LABELS, METER_TYPE_LABELS, PERMISSIONS, SERVICE_TYPE_LABELS, type ServiceDetail, type ServiceDto } from '@ql-tro/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, MoneyInput, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useBuildings } from '@/features/property/api';
import { useServices } from '@/features/tenancy/api';
import { useServiceDetail, useServiceMutation } from '@/features/utilities/api';
import { ApiError } from '@/lib/api-client';
import { firstOfNextMonth, formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';

const price = (v: string) => formatVnd(v.split('.')[0]!);

function useErrors() {
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  return {
    error,
    fe,
    reset: () => {
      setError('');
      setFe({});
    },
    capture: (e: unknown) => {
      if (e instanceof ApiError) {
        setError(e.message);
        setFe(e.fieldErrors ?? {});
      } else setError('Không lưu được.');
    },
  };
}

export default function ServicesPage() {
  const can = useCan();
  const services = useServices();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const manage = can(PERMISSIONS.SERVICES_MANAGE);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Dịch vụ"
        description="Giá có phiên bản theo ngày hiệu lực: đổi giá không làm đổi các tháng trước. Giá điện nước đặt riêng từng tòa ở trang tòa."
        actions={
          manage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              Thêm dịch vụ
            </Button>
          ) : null
        }
      />
      <Card>
        {services.isPending ? (
          <LoadingState />
        ) : services.isError ? (
          <ErrorState error={services.error} onRetry={() => void services.refetch()} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Dịch vụ</Th>
                <Th className="hidden sm:table-cell">Cách tính</Th>
                <Th>Thu</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {services.data.map((s) => (
                <Tr key={s.id} className={s.archived_at ? 'opacity-60' : ''}>
                  <Td>
                    <span className="font-medium">{s.name}</span> <span className="text-xs text-slate-500">{s.code}</span>
                    {s.archived_at ? (
                      <Badge tone="gray" className="ml-1">
                        Ngừng
                      </Badge>
                    ) : null}
                    {s.substitutes_meter ? <div className="text-xs text-slate-500">Thay đồng hồ {METER_TYPE_LABELS[s.substitutes_meter].toLowerCase()}</div> : null}
                  </Td>
                  <Td className="hidden sm:table-cell">
                    {SERVICE_TYPE_LABELS[s.type]} · {s.unit}
                  </Td>
                  <Td>{CHARGE_TIMING_LABELS[s.charge_timing]}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpenId(s.id)}>
                      Giá & chi tiết
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={creating} onClose={() => setCreating(false)} title="Thêm dịch vụ">
        {creating ? <CreateServiceForm onClose={() => setCreating(false)} onCreated={setOpenId} /> : null}
      </Dialog>
      <Dialog open={!!openId} onClose={() => setOpenId(null)} size="lg" title="Dịch vụ">
        {openId ? <ServiceDetailView id={openId} manage={manage} /> : null}
      </Dialog>
    </div>
  );
}

function CreateServiceForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const m = useServiceMutation();
  const err = useErrors();
  const [v, setV] = useState({ code: '', name: '', type: 'FIXED_ROOM', unit: 'phòng/tháng', charge_timing: 'ADVANCE', substitutes_meter: '' });
  const submit = async () => {
    err.reset();
    try {
      const s = await m.mutateAsync({ path: '/services', method: 'POST', body: { ...v, substitutes_meter: v.substitutes_meter || null } });
      toast.success(`Đã thêm dịch vụ ${s.name}. Hãy đặt giá cho dịch vụ.`);
      onClose();
      onCreated(s.id);
    } catch (e) {
      err.capture(e);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={err.error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="sc-code" label="Mã" required error={err.fe.code?.[0]}>
          <TextInput id="sc-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="VD: LAUNDRY" />
        </Field>
        <Field id="sc-name" label="Tên" required error={err.fe.name?.[0]}>
          <TextInput id="sc-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field id="sc-type" label="Cách tính" required>
          <Select id="sc-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            <option value="FIXED_ROOM">{SERVICE_TYPE_LABELS.FIXED_ROOM}</option>
            <option value="PER_PERSON">{SERVICE_TYPE_LABELS.PER_PERSON}</option>
            <option value="QUANTITY">{SERVICE_TYPE_LABELS.QUANTITY}</option>
          </Select>
        </Field>
        <Field id="sc-unit" label="Đơn vị" required error={err.fe.unit?.[0]}>
          <TextInput id="sc-unit" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} />
        </Field>
        <Field id="sc-timing" label="Thu">
          <Select id="sc-timing" value={v.charge_timing} onChange={(e) => setV({ ...v, charge_timing: e.target.value })}>
            <option value="ADVANCE">Thu trước (đầu tháng)</option>
            <option value="ARREARS">Thu sau (cuối tháng)</option>
          </Select>
        </Field>
        <Field id="sc-sub" label="Thay cho đồng hồ" hint="Chọn nếu dịch vụ thay cho đồng hồ (VD nước theo người)">
          <Select id="sc-sub" value={v.substitutes_meter} onChange={(e) => setV({ ...v, substitutes_meter: e.target.value })}>
            <option value="">Không</option>
            <option value="WATER">Đồng hồ nước</option>
            <option value="ELECTRICITY">Đồng hồ điện</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={m.isPending}>
          Thêm
        </Button>
      </div>
    </div>
  );
}

function ServiceDetailView({ id, manage }: { id: string; manage: boolean }) {
  const detail = useServiceDetail(id);
  const buildings = useBuildings();
  if (detail.isPending) return <LoadingState />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const s = detail.data;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-lg font-semibold">{s.name}</p>
        <p className="text-sm text-slate-500">
          {SERVICE_TYPE_LABELS[s.type]} · {s.unit} · {CHARGE_TIMING_LABELS[s.charge_timing]}
        </p>
      </div>
      {s.type === 'METER' ? (
        <p className="text-sm">
          Giá {s.name.toLowerCase()} đặt riêng từng tòa:{' '}
          {buildings.data?.map((b, i) => (
            <span key={b.id}>
              {i ? ', ' : ''}
              <Link href={`/buildings/${b.id}`} className="font-medium text-brand-600 hover:underline">
                Tòa {b.code}
              </Link>
            </span>
          ))}
        </p>
      ) : (
        <>
          <p className="text-sm">
            Giá chung hiện tại: <strong className="tabular">{s.current_price ? `${price(s.current_price)}/${s.unit}` : 'chưa đặt'}</strong>
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Áp dụng</Th>
                <Th>Từ ngày</Th>
                <Th className="text-right">Đơn giá</Th>
                <Th className="hidden sm:table-cell">Lý do</Th>
              </tr>
            </thead>
            <tbody>
              {s.prices.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.building_code ? `Tòa ${p.building_code}` : 'Mọi tòa'}</Td>
                  <Td className="tabular">{formatBusinessDate(p.effective_from)}</Td>
                  <Td className="text-right tabular">{price(p.unit_price)}</Td>
                  <Td className="hidden text-slate-600 sm:table-cell">
                    {p.reason ?? '—'}
                    <div className="text-xs text-slate-400">{p.created_by_name}</div>
                  </Td>
                </Tr>
              ))}
              {s.prices.length === 0 ? (
                <Tr>
                  <Td colSpan={4} className="text-center text-slate-500">
                    Chưa có giá.
                  </Td>
                </Tr>
              ) : null}
            </tbody>
          </Table>
          {manage ? <AddPriceForm service={s} /> : null}
        </>
      )}
      {manage && s.type !== 'METER' ? <EditServiceForm service={s} /> : null}
    </div>
  );
}

function AddPriceForm({ service }: { service: ServiceDetail }) {
  const toast = useToast();
  const buildings = useBuildings();
  const m = useServiceMutation();
  const err = useErrors();
  const [v, setV] = useState({ building_id: '', effective_from: service.prices.length ? firstOfNextMonth(todayLocal()) : `${todayLocal().slice(0, 7)}-01`, unit_price: '', reason: '', confirm_mid_month: false });
  const mid = !v.effective_from.endsWith('-01');
  const submit = async () => {
    err.reset();
    try {
      await m.mutateAsync({
        path: `/services/${service.id}/prices`,
        method: 'POST',
        body: { ...v, building_id: v.building_id || null, reason: v.reason.trim(), confirm_mid_month: mid && v.confirm_mid_month },
      });
      toast.success(`Đã thêm giá ${price(v.unit_price || '0')} từ ${formatBusinessDate(v.effective_from)}.`);
      setV({ ...v, unit_price: '', reason: '', confirm_mid_month: false });
    } catch (e) {
      err.capture(e);
    }
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium">Đổi giá</legend>
      <FormError message={err.error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="sp-building" label="Áp dụng cho">
          <Select id="sp-building" value={v.building_id} onChange={(e) => setV({ ...v, building_id: e.target.value })}>
            <option value="">Mọi tòa (giá chung)</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                Riêng tòa {b.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="sp-from" label="Từ ngày" required error={err.fe.effective_from?.[0]}>
          <TextInput id="sp-from" type="date" value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value })} />
        </Field>
        <Field id="sp-price" label={`Đơn giá (đ/${service.unit})`} required error={err.fe.unit_price?.[0]}>
          <MoneyInput id="sp-price" value={v.unit_price} onChange={(unit_price) => setV({ ...v, unit_price })} />
        </Field>
        <Field id="sp-reason" label="Lý do" required error={err.fe.reason?.[0]}>
          <TextInput id="sp-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
      </div>
      {mid ? (
        <Checkbox id="sp-mid" checked={v.confirm_mid_month} onChange={(confirm_mid_month) => setV({ ...v, confirm_mid_month })}>
          Giá đổi giữa tháng: tôi xác nhận phí tháng đó chia theo ngày.
        </Checkbox>
      ) : null}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void submit()} disabled={m.isPending || !v.unit_price}>
          Lưu giá
        </Button>
      </div>
    </fieldset>
  );
}

function EditServiceForm({ service }: { service: ServiceDto & { version: number } }) {
  const toast = useToast();
  const m = useServiceMutation();
  const err = useErrors();
  const [v, setV] = useState({ name: service.name, unit: service.unit, charge_timing: service.charge_timing });
  const save = async (extra: Record<string, unknown> = {}) => {
    err.reset();
    try {
      await m.mutateAsync({ path: `/services/${service.id}`, method: 'PATCH', body: { ...v, ...extra, expected_version: service.version } });
      toast.success('Đã lưu dịch vụ.');
    } catch (e) {
      err.capture(e);
    }
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium">Thông tin dịch vụ</legend>
      <FormError message={err.error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field id="se-name" label="Tên">
          <TextInput id="se-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field id="se-unit" label="Đơn vị">
          <TextInput id="se-unit" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} />
        </Field>
        <Field id="se-timing" label="Thu">
          <Select id="se-timing" value={v.charge_timing} onChange={(e) => setV({ ...v, charge_timing: e.target.value as 'ADVANCE' | 'ARREARS' })}>
            <option value="ADVANCE">Thu trước</option>
            <option value="ARREARS">Thu sau</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => void save({ archived: !service.archived_at })} disabled={m.isPending}>
          {service.archived_at ? 'Dùng lại dịch vụ' : 'Ngừng cung cấp'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void save()} disabled={m.isPending}>
          Lưu thông tin
        </Button>
      </div>
    </fieldset>
  );
}
