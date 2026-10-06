'use client';

import { METER_TYPE_LABELS, PERMISSIONS, SETTLEMENT_CHARGE_KINDS, type SettlementDto, type SettlementPreview, type TenancyDetail } from '@ql-tro/shared';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, MoneyInput, Select, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { InvoiceLines } from '@/features/billing/invoice-lines';
import { fetchPreview, useMoveOutAction, useNotices, useTenancySettlements } from '@/features/move-out/api';
import { useTenancy } from '@/features/tenancy/api';
import { useRoomMeters } from '@/features/utilities/api';
import { normalizeReading } from '@/features/utilities/estimate';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';

export default function MoveOutPage() {
  const { id } = useParams<{ id: string }>();
  const tenancy = useTenancy(id);
  const settlements = useTenancySettlements(id);
  const notices = useNotices(id);
  if (tenancy.isPending || settlements.isPending || notices.isPending) return <LoadingState />;
  if (tenancy.isError) return <ErrorState error={tenancy.error} onRetry={() => void tenancy.refetch()} />;
  const live = settlements.data?.find((s) => s.status !== 'CANCELLED') ?? null;
  const planned = notices.data?.find((n) => n.status === 'ACTIVE')?.planned_last_charge_date ?? null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        back={{ href: `/tenancies/${id}`, label: `Lần thuê ${tenancy.data.code}` }}
        title={`Trả phòng ${tenancy.data.room_code}`}
        description="Nhập ngày cuối tính tiền, chỉ số cuối, kiểm kê và các khoản phí → xem trước đối soát → duyệt → hoàn tất. Tiền hoàn/thu thực tế ghi sau khi thực chi/nhận."
      />
      {live?.status === 'COMPLETED' ? (
        <Card>
          <CardContent>
            Đã hoàn tất trả phòng.{' '}
            <Link href={`/settlements/${live.id}`} className="text-brand-800 hover:underline">
              Xem quyết toán {live.code}
            </Link>
          </CardContent>
        </Card>
      ) : (
        // key cố định: tạo quyết toán làm danh sách tải lại, không được dựng lại wizard (mất phần xem trước).
        <Wizard tenancy={tenancy.data} settlement={live} planned={planned} />
      )}
    </div>
  );
}

interface Charge {
  kind: 'DAMAGE' | 'PENALTY' | 'OTHER';
  amount_vnd: string;
  reason: string;
}

function Wizard({ tenancy, settlement, planned }: { tenancy: TenancyDetail; settlement: SettlementDto | null; planned: string | null }) {
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const meters = useRoomMeters(tenancy.room_id);
  const action = useMoveOutAction<SettlementDto>();
  const [key, renew] = useIdempotencyKey();
  const activeMeters = (meters.data?.meters ?? []).filter((m) => !m.retired_on);
  const [v, setV] = useState({
    last_charge_date: settlement?.last_charge_date ?? planned ?? todayLocal(),
    destination_room_status: settlement?.destination_room_status ?? ('READY' as 'READY' | 'MAINTENANCE'),
    handover_by: settlement?.handover_by ?? '',
    inventory_note: settlement?.inventory_note ?? '',
    final_reading_waiver: settlement?.final_reading_waiver ?? '',
    deposit_to_apply_vnd: settlement?.deposit_to_apply_vnd ?? '',
    note: settlement?.note ?? '',
  });
  const [readings, setReadings] = useState<Record<string, string>>(() => Object.fromEntries((settlement?.final_readings ?? []).map((r) => [r.meter_id, r.value.replace('.', ',')])));
  const [charges, setCharges] = useState<Charge[]>(settlement?.charges.map((c) => ({ kind: c.kind, amount_vnd: c.amount_vnd, reason: c.reason })) ?? []);
  const [current, setCurrent] = useState<SettlementDto | null>(settlement);
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const [confirming, setConfirming] = useState(false);

  const body = () => ({
    ...v,
    handover_by: v.handover_by.trim() || null,
    inventory_note: v.inventory_note.trim() || null,
    final_reading_waiver: v.final_reading_waiver.trim() || null,
    deposit_to_apply_vnd: v.deposit_to_apply_vnd || null,
    note: v.note.trim() || null,
    final_readings: Object.entries(readings)
      .filter(([, value]) => value.trim())
      .map(([meter_id, value]) => ({ meter_id, value: normalizeReading(value) })),
    charges: charges.filter((c) => c.amount_vnd && c.reason.trim()),
  });
  const fail = (e: unknown) => {
    if (e instanceof ApiError) {
      setError(e.message);
      setFe(e.fieldErrors ?? {});
    } else setError('Không thực hiện được.');
  };

  const saveAndPreview = async () => {
    setError('');
    setFe({});
    try {
      const s = current
        ? await action.mutateAsync({ path: `/settlements/${current.id}`, method: 'PUT', body: { ...body(), expected_version: current.version } })
        : await action.mutateAsync({ path: `/tenancies/${tenancy.id}/move-out-settlements`, body: body() });
      setCurrent(s);
      setPreview(await fetchPreview(s.id));
    } catch (e) {
      fail(e);
    }
  };
  const approve = async () => {
    if (!current || !preview) return;
    setError('');
    try {
      const s = await action.mutateAsync({ path: `/settlements/${current.id}/approve`, body: { expected_version: current.version, input_hash: preview.input_hash } });
      setCurrent(s);
      toast.success(`Đã duyệt quyết toán ${s.code}. Kiểm tra lại rồi bấm “Hoàn tất trả phòng”.`);
    } catch (e) {
      fail(e);
    }
  };
  const complete = async () => {
    if (!current) return;
    setError('');
    try {
      const s = await action.mutateAsync({ path: `/settlements/${current.id}/complete`, body: { expected_version: current.version }, key });
      renew();
      toast.success(`Đã hoàn tất trả phòng ${tenancy.room_code}.`);
      router.push(`/settlements/${s.id}`);
    } catch (e) {
      setConfirming(false);
      fail(e);
    }
  };

  const approved = current?.status === 'APPROVED';
  return (
    <>
      <FormError message={error} />
      <Card>
        <CardHeader>
          <CardTitle>1. Bàn giao</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="mo-last" label="Ngày cuối tính tiền (khách ở hết ngày)" required error={fe.last_charge_date?.[0]}>
            <TextInput id="mo-last" type="date" min={tenancy.start_date} value={v.last_charge_date} onChange={(e) => setV({ ...v, last_charge_date: e.target.value })} />
          </Field>
          <Field id="mo-room" label="Trạng thái phòng sau bàn giao">
            <Select id="mo-room" value={v.destination_room_status} onChange={(e) => setV({ ...v, destination_room_status: e.target.value as 'READY' | 'MAINTENANCE' })}>
              <option value="READY">Sẵn sàng cho thuê</option>
              <option value="MAINTENANCE">Cần sửa (bảo trì)</option>
            </Select>
          </Field>
          <Field id="mo-by" label="Người bàn giao">
            <TextInput id="mo-by" value={v.handover_by} onChange={(e) => setV({ ...v, handover_by: e.target.value })} />
          </Field>
          <Field id="mo-inventory" label="Kiểm kê tài sản" required className="sm:col-span-2" hint="Bắt buộc trước khi duyệt." error={fe.inventory_note?.[0]}>
            <Textarea id="mo-inventory" value={v.inventory_note} onChange={(e) => setV({ ...v, inventory_note: e.target.value })} placeholder="VD: Đủ giường, tủ, máy lạnh; chìa khóa 2 chiếc đã nhận lại" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Chỉ số cuối kỳ</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {activeMeters.map((m, i) => (
            <Field
              key={m.id}
              id={`mo-final-${m.type}`}
              label={`Chỉ số ${METER_TYPE_LABELS[m.type].toLowerCase()} cuối kỳ`}
              hint={m.last_reading ? `Lần đọc gần nhất: ${m.last_reading.value.replace('.', ',')} (${formatBusinessDate(m.last_reading.read_on)})` : undefined}
              error={fe[`final_readings.${i}.value`]?.[0]}
            >
              <TextInput id={`mo-final-${m.type}`} inputMode="decimal" value={readings[m.id] ?? ''} onChange={(e) => setReadings({ ...readings, [m.id]: e.target.value.replace(/[^\d.,]/g, '') })} />
            </Field>
          ))}
          <Field id="mo-waiver" label="Lý do không có chỉ số cuối (nếu có)" className="sm:col-span-2">
            <TextInput id="mo-waiver" value={v.final_reading_waiver} onChange={(e) => setV({ ...v, final_reading_waiver: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>3. Hư hỏng và khoản phí khác</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setCharges([...charges, { kind: 'DAMAGE', amount_vnd: '', reason: '' }])}>
            <Plus className="size-4" aria-hidden />
            Thêm khoản
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {charges.length === 0 ? <p className="text-sm text-slate-500">Không có khoản phí kèm theo. Không tự khấu trừ cọc.</p> : null}
          {charges.map((c, i) => (
            <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[9rem_10rem_1fr_auto]">
              <Field id={`ch-kind-${i}`} label="Loại">
                <Select id={`ch-kind-${i}`} value={c.kind} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, kind: e.target.value as Charge['kind'] } : x)))}>
                  {Object.entries(SETTLEMENT_CHARGE_KINDS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`ch-amount-${i}`} label="Số tiền">
                <MoneyInput id={`ch-amount-${i}`} value={c.amount_vnd} onChange={(amount_vnd) => setCharges(charges.map((x, j) => (j === i ? { ...x, amount_vnd } : x)))} />
              </Field>
              <Field id={`ch-reason-${i}`} label="Lý do">
                <TextInput id={`ch-reason-${i}`} value={c.reason} onChange={(e) => setCharges(charges.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />
              </Field>
              <Button variant="ghost" size="sm" onClick={() => setCharges(charges.filter((_, j) => j !== i))} aria-label="Xóa khoản">
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Field id="mo-deposit" label="Cọc áp vào nợ (bỏ trống = tối đa theo công thức)" className="sm:w-80" error={fe.deposit_to_apply_vnd?.[0]}>
            <MoneyInput id="mo-deposit" value={v.deposit_to_apply_vnd} onChange={(deposit_to_apply_vnd) => setV({ ...v, deposit_to_apply_vnd })} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => void saveAndPreview()} disabled={action.isPending}>
          {current ? 'Lưu & xem trước lại' : 'Lưu & xem trước'}
        </Button>
      </div>

      {preview && current ? (
        <PreviewPanel
          preview={preview}
          tenancyId={tenancy.id}
          approved={approved}
          canApprove={can(PERMISSIONS.SETTLEMENT_APPROVE)}
          onApprove={() => void approve()}
          onComplete={() => setConfirming(true)}
          pending={action.isPending}
        />
      ) : null}

      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`Hoàn tất trả phòng ${tenancy.room_code}`}>
        {confirming && preview ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Thực hiện trong một lần: hủy {preview.drafts_to_cancel.length} nháp, phát hành thông báo trả phòng {formatVnd(preview.final_debit_vnd)}
              {preview.final_credit_vnd !== '0' ? ` và chứng từ giảm ${formatVnd(preview.final_credit_vnd)}` : ''}, cấn trừ credit {formatVnd(preview.credit_applied_vnd)}, áp cọc{' '}
              {formatVnd(preview.deposit_applied_vnd)}, kết thúc lần thuê và chuyển phòng sang “{v.destination_room_status === 'READY' ? 'Sẵn sàng' : 'Bảo trì'}”.
            </p>
            <p>
              Sau đó: khách còn nợ <strong>{formatVnd(preview.customer_receivable_vnd)}</strong>; phải hoàn tiền dư <strong>{formatVnd(preview.credit_refund_payable_vnd)}</strong>, hoàn cọc{' '}
              <strong>{formatVnd(preview.deposit_refund_payable_vnd)}</strong> (ghi khi thực chi).
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Đóng
              </Button>
              <Button onClick={() => void complete()} disabled={action.isPending}>
                Hoàn tất trả phòng
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function PreviewPanel({
  preview,
  tenancyId,
  approved,
  canApprove,
  onApprove,
  onComplete,
  pending,
}: {
  preview: SettlementPreview;
  tenancyId: string;
  approved: boolean;
  canApprove: boolean;
  onApprove: () => void;
  onComplete: () => void;
  pending: boolean;
}) {
  const rows: [string, string, string?][] = [
    ['Tổng nợ (gồm thông báo trả phòng)', preview.debt_vnd],
    ['Credit (gồm phần thu trước dư)', preview.credit_vnd],
    ['Cấn trừ credit vào nợ', preview.credit_applied_vnd],
    ['Nợ sau cấn trừ', preview.debt_after_credit_vnd],
    ['Cọc đang giữ', preview.deposit_available_vnd],
    ['Áp cọc vào nợ', preview.deposit_applied_vnd],
    ['Khách còn phải trả', preview.customer_receivable_vnd, 'text-red-700'],
    ['Phải hoàn tiền dư (credit)', preview.credit_refund_payable_vnd, 'text-violet-700'],
    ['Phải hoàn cọc', preview.deposit_refund_payable_vnd, 'text-violet-700'],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>4. Xem trước đối soát và cấn trừ</CardTitle>
      </CardHeader>
      {preview.blocking.length ? (
        <CardContent className="border-b border-amber-200 bg-amber-50 text-sm text-amber-900" role="alert">
          <p className="font-medium">Chưa duyệt được:</p>
          <ul className="list-disc pl-5">
            {preview.blocking.map((b) => (
              <li key={b.code + b.message}>{b.message}</li>
            ))}
          </ul>
          {preview.unstarted_contracts.length ? (
            <p className="mt-1">
              Hủy hợp đồng ở{' '}
              <Link href={`/tenancies/${tenancyId}`} className="font-medium underline">
                trang lần thuê
              </Link>{' '}
              (bắt buộc ghi lý do).
            </p>
          ) : null}
        </CardContent>
      ) : null}
      {preview.warnings.length ? (
        <CardContent className="border-b border-slate-100 text-sm text-slate-700">
          {preview.warnings.map((w) => (
            <p key={w}>⚠ {w}</p>
          ))}
        </CardContent>
      ) : null}
      <CardContent className="text-sm font-medium">Thông báo trả phòng (mốc: hết ngày cuối tính tiền)</CardContent>
      <InvoiceLines items={preview.final_lines} />
      {preview.old_debts.length ? (
        <CardContent className="text-sm">
          <p className="font-medium">Công nợ cũ (liệt kê riêng, không lập lại):</p>
          {preview.old_debts.map((d) => (
            <p key={d.invoice_id}>
              {d.number} · hạn {formatBusinessDate(d.due_date)} · còn {formatVnd(d.remaining_vnd)}
            </p>
          ))}
        </CardContent>
      ) : null}
      {preview.drafts_to_cancel.length ? (
        <CardContent className="text-sm text-slate-600">Nháp sẽ bị hủy khi hoàn tất (thông báo trả phòng bao trùm): {preview.drafts_to_cancel.map((d) => d.period ?? '').join(', ')}</CardContent>
      ) : null}
      <CardContent className="border-t border-slate-100">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {rows.map(([l, v, c]) => (
            <div key={l} className="flex justify-between gap-2">
              <dt className="text-slate-600">{l}</dt>
              <dd className={`tabular font-medium ${c ?? ''}`}>{formatVnd(v)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
      <CardContent className="flex flex-wrap justify-end gap-2 border-t border-slate-100">
        {canApprove && !approved ? (
          <Button onClick={onApprove} disabled={pending || preview.blocking.length > 0}>
            Duyệt quyết toán
          </Button>
        ) : null}
        {canApprove && approved ? (
          <Button onClick={onComplete} disabled={pending}>
            Hoàn tất trả phòng
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
