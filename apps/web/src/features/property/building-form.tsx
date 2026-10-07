'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type Building, type MeterPrices, PERMISSIONS } from '@ql-tro/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, MoneyInput, Select, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useMeterPrices } from '@/features/utilities/api';
import { meterPricesHref, periodLabel, periodOptionLabel, periodOptions } from '@/features/utilities/meter-prices-section';
import { ApiError } from '@/lib/api-client';
import { applyApiErrors, blankToNull, intOrNull } from '@/lib/forms';
import { formatVnd, todayLocal } from '@/lib/format';
import { type BuildingMeterPricesInput, useCreateBuilding, useUpdateBuilding } from './api';

const schema = z.object({
  code: z.string().trim().min(1, 'Vui lòng nhập mã tòa.').max(20),
  name: z.string().trim().min(1, 'Vui lòng nhập tên tòa.').max(120),
  address: z.string().max(300),
  floors: z.string().regex(/^\d{0,3}$/, 'Số tầng không hợp lệ.'),
  contact_name: z.string().max(120),
  contact_phone: z.string().max(20),
  note: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;
const FIELDS = ['code', 'name', 'address', 'floors', 'contact_name', 'contact_phone', 'note'] as const;

const METER_TYPES = ['ELECTRICITY', 'WATER'] as const;
type MeterKind = (typeof METER_TYPES)[number];
const PRICE_LABEL: Record<MeterKind, string> = { ELECTRICITY: 'Giá điện (đ/kWh)', WATER: 'Giá nước (đ/m³)' };
/** Giá người dùng gõ; chưa đụng tới thì ô hiện giá hiện tại. */
interface PriceDraft {
  values: Partial<Record<MeterKind, string>>;
  effective_from?: string;
  reason: string;
  confirm: boolean;
}
const EMPTY_DRAFT: PriceDraft = { values: {}, reason: '', confirm: false };
const digits = (v: string | null | undefined) => (v ? v.split('.')[0]! : '');

export function BuildingFormDialog({ open, onClose, building }: { open: boolean; onClose: () => void; building?: Building }) {
  const toast = useToast();
  const create = useCreateBuilding();
  const update = useUpdateBuilding(building?.id ?? '');
  const can = useCan();
  const managePrices = can(PERMISSIONS.METER_PRICES_MANAGE);
  const prices = useMeterPrices(building?.id ?? '', open && managePrices && !!building);
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState<PriceDraft>(EMPTY_DRAFT);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      code: building?.code ?? '',
      name: building?.name ?? '',
      address: building?.address ?? '',
      floors: building?.floors ? String(building.floors) : '',
      contact_name: building?.contact_name ?? '',
      contact_phone: building?.contact_phone ?? '',
      note: building?.note ?? '',
    },
  });
  const pending = create.isPending || update.isPending;
  const { errors } = form.formState;

  const close = () => {
    setDraft(EMPTY_DRAFT);
    setPriceErrors({});
    setFormError('');
    onClose();
  };

  const currentPrice = (t: MeterKind) => digits(prices.data?.items.find((i) => i.meter_type === t)?.current?.unit_price);
  const shown = (t: MeterKind) => draft.values[t] ?? currentPrice(t);
  /** Loại có giá mới cần gửi: tạo tòa = ô có nhập; sửa tòa = khác giá hiện tại. */
  const changed = METER_TYPES.filter((t) => {
    const v = draft.values[t];
    return building ? v !== undefined && v !== '' && v !== currentPrice(t) : !!v;
  });
  const defaultFrom = building ? (prices.data?.next_period_start ?? '') : `${todayLocal().slice(0, 7)}-01`;
  const effectiveFrom = draft.effective_from ?? defaultFrom;
  const meterPrices = (): BuildingMeterPricesInput | null => {
    if (!managePrices || !changed.length) return null;
    const base = {
      ELECTRICITY: changed.includes('ELECTRICITY') ? draft.values.ELECTRICITY! : null,
      WATER: changed.includes('WATER') ? draft.values.WATER! : null,
      effective_from: effectiveFrom,
    };
    return building ? { ...base, reason: draft.reason.trim(), confirm_existing_readings: draft.confirm } : base;
  };

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError('');
    setPriceErrors({});
    const body = {
      code: v.code,
      name: v.name,
      address: blankToNull(v.address),
      floors: intOrNull(v.floors),
      contact_name: blankToNull(v.contact_name),
      contact_phone: blankToNull(v.contact_phone),
      note: blankToNull(v.note),
    };
    const mp = meterPrices();
    try {
      if (building) await update.mutateAsync({ ...body, expected_version: building.version, meter_prices: mp });
      else await create.mutateAsync({ ...body, meter_prices: mp });
      toast.success(`${building ? 'Đã lưu thông tin tòa' : 'Đã tạo tòa'}${mp ? ` và giá điện nước từ ${periodLabel(mp.effective_from!)}` : ''}.`);
      form.reset();
      close();
    } catch (error) {
      // Lỗi của phần giá (meter_prices.*) gắn về đúng ô giá; còn lại theo form tòa.
      const fe = error instanceof ApiError ? (error.fieldErrors ?? {}) : {};
      const priceFe = Object.fromEntries(Object.entries(fe).flatMap(([k, m]) => (k.startsWith('meter_prices.') ? [[k.slice('meter_prices.'.length), m[0] ?? '']] : [])));
      setPriceErrors(priceFe);
      const message = applyApiErrors(error, form.setError, FIELDS);
      const onlyPriceFields = Object.keys(priceFe).length === Object.keys(fe).length && error instanceof ApiError && error.code === 'VALIDATION_FAILED';
      setFormError(onlyPriceFields ? '' : message);
    }
  });

  const reg = (name: (typeof FIELDS)[number]) => ({
    id: `b-${name}`,
    'aria-invalid': errors[name] ? true : undefined,
    ...form.register(name),
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title={building ? `Sửa tòa ${building.code}` : 'Thêm tòa/khu'}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <FormError message={formError} />
        </div>
        <Field id="b-code" label="Mã tòa" required error={errors.code?.message} hint="Ví dụ: A, B1, KHU-2">
          <TextInput {...reg('code')} />
        </Field>
        <Field id="b-name" label="Tên tòa" required error={errors.name?.message}>
          <TextInput {...reg('name')} />
        </Field>
        <Field id="b-address" label="Địa chỉ" error={errors.address?.message} className="sm:col-span-2">
          <TextInput {...reg('address')} />
        </Field>
        <Field id="b-floors" label="Số tầng" error={errors.floors?.message}>
          <TextInput inputMode="numeric" {...reg('floors')} />
        </Field>
        <Field id="b-contact_name" label="Người liên hệ" error={errors.contact_name?.message}>
          <TextInput {...reg('contact_name')} />
        </Field>
        <Field id="b-contact_phone" label="SĐT liên hệ" error={errors.contact_phone?.message}>
          <TextInput inputMode="tel" {...reg('contact_phone')} />
        </Field>
        {managePrices ? (
          <PriceFields
            building={building}
            prices={prices.data}
            loading={!!building && prices.isPending}
            draft={draft}
            setDraft={setDraft}
            shown={shown}
            changed={changed}
            effectiveFrom={effectiveFrom}
            defaultFrom={defaultFrom}
            errors={priceErrors}
            onOpenHistory={close}
          />
        ) : building ? (
          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 sm:col-span-2">
            Giá điện nước do chủ trọ đặt —{' '}
            <Link href={meterPricesHref(building.id)} className="font-medium underline" onClick={close}>
              xem mục Giá điện nước
            </Link>
            .
          </p>
        ) : null}
        <Field id="b-note" label="Ghi chú" error={errors.note?.message} className="sm:col-span-2">
          <Textarea {...reg('note')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/**
 * Giá điện nước ngay trong form tòa (D-043). Tạo tòa: không bắt buộc, mặc định áp dụng từ kỳ hiện tại.
 * Sửa tòa: hiện giá hiện tại; gõ giá khác thì chọn kỳ áp dụng và lý do — tạo phiên bản giá mới, các kỳ đã tính giữ giá cũ.
 */
function PriceFields({
  building,
  prices,
  loading,
  draft,
  setDraft,
  shown,
  changed,
  effectiveFrom,
  defaultFrom,
  errors,
  onOpenHistory,
}: {
  building?: Building;
  prices?: MeterPrices;
  loading: boolean;
  draft: PriceDraft;
  setDraft: (d: PriceDraft) => void;
  shown: (t: MeterKind) => string;
  changed: MeterKind[];
  effectiveFrom: string;
  defaultFrom: string;
  errors: Record<string, string>;
  onOpenHistory: () => void;
}) {
  const hasPrice = !!prices?.items.some((i) => i.current || i.upcoming.length);
  const hint = (t: MeterKind) => {
    if (!building) return undefined;
    const item = prices?.items.find((i) => i.meter_type === t);
    if (!item?.current) return 'Chưa đặt giá';
    const next = item.upcoming[0];
    return `Hiện tại ${formatVnd(digits(item.current.unit_price))} (từ ${periodLabel(item.current.effective_from)})${next ? ` · đã hẹn ${formatVnd(digits(next.unit_price))} từ ${periodLabel(next.effective_from)}` : ''}`;
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 sm:col-span-2" data-testid="building-meter-prices">
      <legend className="px-1 text-sm font-semibold">Giá điện nước{building ? '' : ' (không bắt buộc)'}</legend>
      <p className="text-sm text-slate-500">
        Đơn giá đặt theo tòa, dùng chung cho mọi phòng trong tòa.{' '}
        {building ? 'Đổi giá áp dụng từ kỳ đã chọn; các tháng đã tính giữ giá cũ.' : 'Có thể để trống và đặt sau.'}
      </p>
      {loading ? (
        <p className="text-sm text-slate-500">Đang tải giá hiện tại…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {METER_TYPES.map((t) => (
            <Field key={t} id={`b-price-${t}`} label={PRICE_LABEL[t]} error={errors[t]} hint={hint(t)}>
              <MoneyInput id={`b-price-${t}`} value={shown(t)} onChange={(v) => setDraft({ ...draft, values: { ...draft.values, [t]: v } })} />
            </Field>
          ))}
        </div>
      )}
      {changed.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="b-price-from" label="Áp dụng từ" required error={errors.effective_from} hint={effectiveFrom === defaultFrom ? (building ? 'Kỳ đọc chỉ số tiếp theo' : 'Kỳ hiện tại') : undefined}>
            <Select id="b-price-from" value={effectiveFrom} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value, confirm: false })}>
              {periodOptions(defaultFrom, !!building && hasPrice).map((p) => (
                <option key={p} value={p}>
                  {periodOptionLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
          {building ? (
            <Field id="b-price-reason" label="Lý do đổi giá" required error={errors.reason}>
              <TextInput id="b-price-reason" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} placeholder="VD: Điện lực điều chỉnh giá" />
            </Field>
          ) : null}
          {errors.confirm_existing_readings || (building && effectiveFrom < defaultFrom) ? (
            <div className="sm:col-span-2">
              <Checkbox id="b-price-confirm" checked={draft.confirm} onChange={(confirm) => setDraft({ ...draft, confirm })}>
                {periodLabel(effectiveFrom)} đã có chỉ số chốt. Tôi xác nhận tiền tạm tính của kỳ đó sẽ tính theo giá mới.
              </Checkbox>
              {errors.confirm_existing_readings ? <p className="mt-1 text-sm text-red-700">{errors.confirm_existing_readings}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {building ? (
        <Link href={meterPricesHref(building.id)} className="text-sm text-brand-800 underline" onClick={onOpenHistory}>
          Xem lịch sử giá
        </Link>
      ) : null}
    </fieldset>
  );
}
