'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Building } from '@ql-tro/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { meterPricesHref } from '@/features/utilities/meter-prices-section';
import { applyApiErrors, blankToNull, intOrNull } from '@/lib/forms';
import { useCreateBuilding, useUpdateBuilding } from './api';

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

export function BuildingFormDialog({ open, onClose, building }: { open: boolean; onClose: () => void; building?: Building }) {
  const toast = useToast();
  const create = useCreateBuilding();
  const update = useUpdateBuilding(building?.id ?? '');
  const [formError, setFormError] = useState('');
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

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError('');
    const body = {
      code: v.code,
      name: v.name,
      address: blankToNull(v.address),
      floors: intOrNull(v.floors),
      contact_name: blankToNull(v.contact_name),
      contact_phone: blankToNull(v.contact_phone),
      note: blankToNull(v.note),
    };
    try {
      if (building) await update.mutateAsync({ ...body, expected_version: building.version });
      else await create.mutateAsync(body);
      toast.success(building ? 'Đã lưu thông tin tòa.' : 'Đã tạo tòa.');
      form.reset();
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, FIELDS));
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
      onClose={onClose}
      title={building ? `Sửa tòa ${building.code}` : 'Thêm tòa/khu'}
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
        <Field id="b-note" label="Ghi chú" error={errors.note?.message} className="sm:col-span-2">
          <Textarea {...reg('note')} />
        </Field>
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 sm:col-span-2">
          Đơn giá điện (đ/kWh) và nước (đ/m³) không nằm ở đây mà ở mục “Giá điện nước” của trang tòa
          {building ? (
            <>
              {' '}—{' '}
              <Link href={meterPricesHref(building.id)} className="font-medium underline" onClick={onClose}>
                mở mục Giá điện nước
              </Link>
            </>
          ) : ' (đặt sau khi tạo tòa)'}
          .
        </p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
