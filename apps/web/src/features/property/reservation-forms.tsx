'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Reservation } from '@ql-tro/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { applyApiErrors, blankToNull } from '@/lib/forms';
import { useCancelReservation, useCreateReservation, useRescheduleReservation } from './api';

const dates = z
  .object({
    hold_from: z.string().min(1, 'Chọn ngày.'),
    expected_move_in: z.string().min(1, 'Chọn ngày.'),
    hold_until: z.string().min(1, 'Chọn ngày.'),
  })
  .superRefine((v, ctx) => {
    if (v.hold_from && v.expected_move_in && v.hold_from > v.expected_move_in) {
      ctx.addIssue({ code: 'custom', path: ['expected_move_in'], message: 'Phải từ ngày bắt đầu giữ trở đi.' });
    }
    if (v.expected_move_in && v.hold_until && v.expected_move_in > v.hold_until) {
      ctx.addIssue({ code: 'custom', path: ['hold_until'], message: 'Phải từ ngày dự kiến nhận trở đi.' });
    }
  });

const createSchema = z.intersection(
  dates,
  z.object({
    contact_name: z.string().trim().min(1, 'Vui lòng nhập tên.').max(120),
    contact_phone: z.string().max(20),
    note: z.string().max(1000),
  }),
);
type CreateValues = z.infer<typeof createSchema>;
const CREATE_FIELDS = ['hold_from', 'expected_move_in', 'hold_until', 'contact_name', 'contact_phone', 'note'] as const;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ReservationCreateDialog({ open, onClose, roomId, roomLabel }: { open: boolean; onClose: () => void; roomId: string; roomLabel: string }) {
  const toast = useToast();
  const create = useCreateReservation();
  const [formError, setFormError] = useState('');
  const today = todayLocal();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { hold_from: today, expected_move_in: today, hold_until: today, contact_name: '', contact_phone: '', note: '' },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError('');
    try {
      await create.mutateAsync({ ...v, room_id: roomId, contact_phone: blankToNull(v.contact_phone), note: blankToNull(v.note) });
      toast.success(`Đã giữ phòng ${roomLabel} cho ${v.contact_name}.`);
      form.reset();
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, CREATE_FIELDS));
    }
  });

  const aria = (name: (typeof CREATE_FIELDS)[number]) => ({ id: `rs-${name}`, 'aria-invalid': errors[name] ? true : undefined });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Giữ phòng ${roomLabel}`}
      description="Giữ chỗ không tạo tiền thuê hay tiền cọc. Tiền giữ chỗ (nếu có) ghi nhận riêng."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={create.isPending}>
            {create.isPending ? 'Đang lưu…' : 'Giữ phòng'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3" noValidate>
        <div className="sm:col-span-3">
          <FormError message={formError} />
        </div>
        <Field id="rs-hold_from" label="Bắt đầu giữ" required error={errors.hold_from?.message}>
          <TextInput type="date" {...aria('hold_from')} {...form.register('hold_from')} />
        </Field>
        <Field id="rs-expected_move_in" label="Dự kiến nhận" required error={errors.expected_move_in?.message}>
          <TextInput type="date" {...aria('expected_move_in')} {...form.register('expected_move_in')} />
        </Field>
        <Field id="rs-hold_until" label="Giữ đến hết ngày" required error={errors.hold_until?.message}>
          <TextInput type="date" {...aria('hold_until')} {...form.register('hold_until')} />
        </Field>
        <Field id="rs-contact_name" label="Người giữ chỗ" required error={errors.contact_name?.message} className="sm:col-span-2">
          <TextInput {...aria('contact_name')} {...form.register('contact_name')} />
        </Field>
        <Field id="rs-contact_phone" label="Số điện thoại" error={errors.contact_phone?.message}>
          <TextInput inputMode="tel" {...aria('contact_phone')} {...form.register('contact_phone')} />
        </Field>
        <Field id="rs-note" label="Ghi chú" error={errors.note?.message} className="sm:col-span-3">
          <Textarea {...aria('note')} {...form.register('note')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

type DateValues = z.infer<typeof dates>;
const DATE_FIELDS = ['hold_from', 'expected_move_in', 'hold_until'] as const;

export function ReservationRescheduleDialog({ reservation, onClose }: { reservation: Reservation | null; onClose: () => void }) {
  const toast = useToast();
  const reschedule = useRescheduleReservation();
  const [formError, setFormError] = useState('');
  const form = useForm<DateValues>({
    resolver: zodResolver(dates),
    values: reservation
      ? { hold_from: reservation.hold_from, expected_move_in: reservation.expected_move_in, hold_until: reservation.hold_until }
      : { hold_from: '', expected_move_in: '', hold_until: '' },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    if (!reservation) return;
    setFormError('');
    try {
      await reschedule.mutateAsync({ ...v, id: reservation.id, expected_version: reservation.version });
      toast.success('Đã đổi lịch giữ phòng.');
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, DATE_FIELDS));
    }
  });

  return (
    <Dialog
      open={!!reservation}
      onClose={onClose}
      title="Đổi lịch giữ phòng"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={reschedule.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3" noValidate>
        <div className="sm:col-span-3">
          <FormError message={formError} />
        </div>
        {DATE_FIELDS.map((name) => (
          <Field
            key={name}
            id={`rr-${name}`}
            label={{ hold_from: 'Bắt đầu giữ', expected_move_in: 'Dự kiến nhận', hold_until: 'Giữ đến hết ngày' }[name]}
            required
            error={errors[name]?.message}
          >
            <TextInput type="date" id={`rr-${name}`} aria-invalid={errors[name] ? true : undefined} {...form.register(name)} />
          </Field>
        ))}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Hộp thoại hủy cần lý do (dùng chung cho các thao tác hủy). */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  pending?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    if (reason.trim().length < 3) {
      setError('Vui lòng nhập lý do (ít nhất 3 ký tự).');
      return;
    }
    setError('');
    try {
      await onConfirm(reason.trim());
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={submit} disabled={pending} className="bg-red-600 hover:bg-red-700">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field id="reason" label="Lý do" required error={error}>
        <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={error ? true : undefined} />
      </Field>
    </Dialog>
  );
}

export function useCancelReservationAction() {
  const toast = useToast();
  const cancel = useCancelReservation();
  return {
    pending: cancel.isPending,
    run: async (r: Reservation, reason: string) => {
      await cancel.mutateAsync({ id: r.id, reason, expected_version: r.version });
      toast.success('Đã hủy giữ phòng. Tiền giữ chỗ (nếu có) vẫn được giữ, chờ xử lý.');
    },
  };
}
