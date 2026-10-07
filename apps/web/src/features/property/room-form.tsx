'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Room } from '@ql-tro/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, MoneyInput, Select, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { applyApiErrors, blankToNull, intOrNull } from '@/lib/forms';
import { useBuildings, useCreateRoom, useUpdateRoom } from './api';

const schema = z.object({
  building_id: z.string().min(1, 'Chọn tòa.'),
  code: z.string().trim().min(1, 'Vui lòng nhập mã phòng.').max(20),
  floor: z.string().regex(/^-?\d{0,3}$/, 'Tầng không hợp lệ.'),
  area_m2: z.string().regex(/^(\d{1,5}([.,]\d{1,2})?)?$/, 'Diện tích không hợp lệ.'),
  default_rent_vnd: z.string().min(1, 'Vui lòng nhập giá thuê.'),
  max_occupants: z.string().regex(/^\d{1,2}$/, 'Nhập số người tối đa.'),
  amenities: z.string().max(500),
  note: z.string().max(1000),
  // Chỉ số ban đầu (chỉ khi thêm phòng): bỏ trống thì thiết lập sau ở trang phòng hoặc lúc chốt chỉ số.
  elec: z.string().regex(/^(\d{1,10}([.,]\d{1,2})?)?$/, 'Chỉ số không hợp lệ.'),
  water: z.string().regex(/^(\d{1,10}([.,]\d{1,2})?)?$/, 'Chỉ số không hợp lệ.'),
});
type FormValues = z.infer<typeof schema>;
const FIELDS = ['building_id', 'code', 'floor', 'area_m2', 'default_rent_vnd', 'max_occupants', 'amenities', 'note'] as const;

export function RoomFormDialog({
  open,
  onClose,
  room,
  defaultBuildingId,
}: {
  open: boolean;
  onClose: () => void;
  room?: Room;
  defaultBuildingId?: string;
}) {
  const toast = useToast();
  const buildings = useBuildings();
  const create = useCreateRoom();
  const update = useUpdateRoom(room?.id ?? '');
  const [formError, setFormError] = useState('');
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      building_id: room?.building_id ?? defaultBuildingId ?? '',
      code: room?.code ?? '',
      floor: room?.floor === null || room?.floor === undefined ? '' : String(room.floor),
      area_m2: room?.area_m2 ?? '',
      default_rent_vnd: room?.default_rent_vnd ?? '',
      max_occupants: room ? String(room.max_occupants) : '2',
      amenities: room?.amenities.join(', ') ?? '',
      note: room?.note ?? '',
      elec: '',
      water: '',
    },
  });
  const { errors } = form.formState;
  const pending = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError('');
    const body = {
      code: v.code,
      floor: intOrNull(v.floor),
      area_m2: blankToNull(v.area_m2.replace(',', '.')),
      default_rent_vnd: v.default_rent_vnd,
      max_occupants: Number(v.max_occupants),
      amenities: v.amenities
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      note: blankToNull(v.note),
    };
    try {
      if (room) await update.mutateAsync({ ...body, expected_version: room.version });
      else {
        const initial = { ELECTRICITY: blankToNull(v.elec.replace(',', '.')), WATER: blankToNull(v.water.replace(',', '.')) };
        await create.mutateAsync({ ...body, building_id: v.building_id, ...(initial.ELECTRICITY || initial.WATER ? { initial_readings: initial } : {}) });
      }
      toast.success(room ? 'Đã lưu thông tin phòng.' : `Đã thêm phòng ${body.code.toUpperCase()}.`);
      form.reset();
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, FIELDS));
    }
  });

  const aria = (name: (typeof FIELDS)[number]) => ({ id: `r-${name}`, 'aria-invalid': errors[name] ? true : undefined });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={room ? `Sửa phòng ${room.code}` : 'Thêm phòng'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
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
        <Field id="r-building_id" label="Tòa" required error={errors.building_id?.message}>
          <Select {...aria('building_id')} disabled={!!room} {...form.register('building_id')}>
            <option value="">— Chọn tòa —</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="r-code" label="Mã phòng" required error={errors.code?.message} hint="Ví dụ: 101, A2-05">
          <TextInput {...aria('code')} {...form.register('code')} />
        </Field>
        <Field id="r-default_rent_vnd" label="Giá thuê mặc định / tháng" required error={errors.default_rent_vnd?.message} hint="Chỉ dùng khi nhận phòng mới; đổi giá này không ảnh hưởng khách đang thuê.">
          <Controller
            control={form.control}
            name="default_rent_vnd"
            render={({ field }) => <MoneyInput {...aria('default_rent_vnd')} value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
          />
        </Field>
        <Field id="r-max_occupants" label="Số người tối đa" required error={errors.max_occupants?.message}>
          <TextInput inputMode="numeric" {...aria('max_occupants')} {...form.register('max_occupants')} />
        </Field>
        <Field id="r-floor" label="Tầng" error={errors.floor?.message}>
          <TextInput inputMode="numeric" {...aria('floor')} {...form.register('floor')} />
        </Field>
        <Field id="r-area_m2" label="Diện tích (m²)" error={errors.area_m2?.message}>
          <TextInput inputMode="decimal" {...aria('area_m2')} {...form.register('area_m2')} />
        </Field>
        <Field id="r-amenities" label="Tiện nghi" error={errors.amenities?.message} hint="Cách nhau bằng dấu phẩy, ví dụ: Máy lạnh, Nóng lạnh, Gác lửng" className="sm:col-span-2">
          <TextInput {...aria('amenities')} {...form.register('amenities')} />
        </Field>
        {!room ? (
          <fieldset className="grid grid-cols-1 gap-4 rounded-md border border-slate-200 p-3 sm:col-span-2 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium text-slate-700">Đồng hồ điện nước (nhập một lần)</legend>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Ghi số đang hiện trên đồng hồ riêng của phòng. Các tháng sau hệ thống tự lấy làm chỉ số cũ. Không cần số seri; bỏ trống nếu chưa có.
            </p>
            <Field id="r-elec" label="Chỉ số điện ban đầu (kWh)" error={errors.elec?.message}>
              <TextInput id="r-elec" inputMode="decimal" {...form.register('elec')} />
            </Field>
            <Field id="r-water" label="Chỉ số nước ban đầu (m³)" error={errors.water?.message}>
              <TextInput id="r-water" inputMode="decimal" {...form.register('water')} />
            </Field>
          </fieldset>
        ) : null}
        <Field id="r-note" label="Ghi chú" error={errors.note?.message} className="sm:col-span-2">
          <Textarea {...aria('note')} {...form.register('note')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
