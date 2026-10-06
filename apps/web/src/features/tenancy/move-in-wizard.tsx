'use client';

import { METER_TYPE_LABELS, PAYMENT_METHOD_LABELS, type MoveInInput, type Room } from '@ql-tro/shared';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DescriptionList } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormError, MoneyInput, Select, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useIdempotencyKey } from '@/lib/use-idempotency-key';
import { useHoldingLedger, useMoveIn, useServices } from './api';
import { scopedErrors } from './tenant-fields';
import { newPerson, PersonPicker, type PersonChoice, personLabel, personToRef } from './person-picker';
import { ContractStep, contractToInput, emptyContract, type ContractDraft } from './move-in-contract';

const STEPS = ['Ngày & giá', 'Người thuê', 'Hợp đồng', 'Dịch vụ & chỉ số', 'Cọc', 'Xem lại'] as const;

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function MoveInWizard({ room, reservationId }: { room: Room; reservationId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const services = useServices();
  const holding = useHoldingLedger(reservationId ?? '', !!reservationId);
  const moveIn = useMoveIn();
  const [key] = useIdempotencyKey();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [basics, setBasics] = useState({
    start_date: room.current_reservation?.expected_move_in ?? todayLocal(),
    monthly_rent_vnd: room.default_rent_vnd,
    billing_due_day: '5',
    deposit_required_vnd: room.default_rent_vnd,
    note: '',
  });
  const [primary, setPrimary] = useState<PersonChoice>(() => {
    const p = newPerson();
    if (p.kind === 'new' && room.current_reservation) p.draft.full_name = room.current_reservation.contact_name;
    return p;
  });
  const [members, setMembers] = useState<PersonChoice[]>([]);
  const [contract, setContract] = useState<ContractDraft>(() => emptyContract(basics.start_date));
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [readings, setReadings] = useState({ ELECTRICITY: '', WATER: '' });
  const [deposit, setDeposit] = useState({ amount_vnd: '', method: 'CASH', paid_at: todayLocal(), reference: '' });

  const optionalServices = (services.data ?? []).filter((s) => s.type !== 'METER' && !s.archived_at);
  const holdingBalance = holding.data?.balance_vnd ?? '0';

  const buildInput = (): MoveInInput => ({
    room_id: room.id,
    start_date: basics.start_date,
    reservation_id: reservationId,
    primary: personToRef(primary),
    members: members.map(personToRef),
    monthly_rent_vnd: basics.monthly_rent_vnd || '0',
    billing_due_day: Number(basics.billing_due_day) || 5,
    deposit_required_vnd: basics.deposit_required_vnd || '0',
    deposit_received: deposit.amount_vnd && deposit.amount_vnd !== '0'
      ? { amount_vnd: deposit.amount_vnd, method: deposit.method as 'CASH', paid_at: deposit.paid_at, reference: deposit.reference || null }
      : null,
    services: Object.entries(chosen).map(([service_id, quantity]) => ({ service_id, quantity: quantity || '1' })),
    meter_readings: (['ELECTRICITY', 'WATER'] as const).filter((t) => readings[t].trim()).map((t) => ({ type: t, value: readings[t].trim().replace(',', '.') })),
    contract: contractToInput(contract),
    note: basics.note.trim() || null,
  });

  const submit = async () => {
    setError('');
    setFieldErrors({});
    try {
      const res = await moveIn.mutateAsync({ body: buildInput(), key });
      toast.success(`Đã nhận phòng ${room.code} (${res.code}).`);
      router.replace(`/tenancies/${res.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors ?? {});
      } else setError('Không nhận phòng được.');
    }
  };

  const depositTotal = (BigInt(holdingBalance || '0') + BigInt(deposit.amount_vnd || '0')).toString();

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Các bước nhận phòng">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1',
                i === step ? 'border-brand-600 bg-brand-50 text-brand-800' : i < step ? 'border-slate-300 text-slate-700' : 'border-slate-200 text-slate-400',
              )}
            >
              {i < step ? <Check className="size-3.5" aria-hidden /> : <span className="tabular">{i + 1}.</span>}
              {s}
            </button>
          </li>
        ))}
      </ol>

      <FormError message={error} />

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="mi-start" label="Ngày nhận phòng" required error={fieldErrors.start_date?.[0]} hint="Tiền phòng tính từ ngày này.">
                <TextInput id="mi-start" type="date" value={basics.start_date} onChange={(e) => setBasics({ ...basics, start_date: e.target.value })} />
              </Field>
              <Field id="mi-rent" label="Giá thuê / tháng" required error={fieldErrors.monthly_rent_vnd?.[0]}>
                <MoneyInput id="mi-rent" value={basics.monthly_rent_vnd} onChange={(monthly_rent_vnd) => setBasics({ ...basics, monthly_rent_vnd })} />
              </Field>
              <Field id="mi-due" label="Ngày đến hạn hằng tháng" hint="Ngày không có trong tháng thì lấy ngày cuối tháng.">
                <TextInput id="mi-due" inputMode="numeric" value={basics.billing_due_day} onChange={(e) => setBasics({ ...basics, billing_due_day: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
              </Field>
              <Field id="mi-dep-req" label="Mức cọc thỏa thuận" hint="Chỉ là mức yêu cầu; tiền thực nhận ghi ở bước Cọc.">
                <MoneyInput id="mi-dep-req" value={basics.deposit_required_vnd} onChange={(deposit_required_vnd) => setBasics({ ...basics, deposit_required_vnd })} />
              </Field>
              <Field id="mi-note" label="Ghi chú" className="sm:col-span-2">
                <Textarea id="mi-note" value={basics.note} onChange={(e) => setBasics({ ...basics, note: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-5">
              <section>
                <h3 className="mb-2 text-sm font-semibold">Người đại diện</h3>
                <PersonPicker prefix="mi-p" value={primary} onChange={setPrimary} errors={scopedErrors(fieldErrors, 'primary.new_tenant')} />
              </section>
              {members.map((m, i) => (
                <section key={i} className="border-t border-slate-100 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Người ở cùng {i + 1}</h3>
                    <Button variant="ghost" size="sm" onClick={() => setMembers(members.filter((_, j) => j !== i))} aria-label="Bỏ người này">
                      <Trash2 className="size-4 text-red-600" />
                    </Button>
                  </div>
                  <PersonPicker prefix={`mi-m${i}`} value={m} onChange={(p) => setMembers(members.map((x, j) => (j === i ? p : x)))} errors={scopedErrors(fieldErrors, `members.${i}.new_tenant`)} />
                </section>
              ))}
              <Button variant="outline" onClick={() => setMembers([...members, newPerson()])} disabled={members.length + 1 >= room.max_occupants}>
                <Plus className="size-4" aria-hidden />
                Thêm người ở cùng (tối đa {room.max_occupants} người)
              </Button>
            </div>
          ) : null}

          {step === 2 ? <ContractStep value={contract} onChange={setContract} startDate={basics.start_date} errors={scopedErrors(fieldErrors, 'contract')} /> : null}

          {step === 3 ? (
            <div className="flex flex-col gap-5">
              <section>
                <h3 className="mb-2 text-sm font-semibold">Dịch vụ</h3>
                <div className="flex flex-col gap-2">
                  {optionalServices.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center gap-3">
                      <label className="flex min-w-48 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-brand-600"
                          checked={s.id in chosen}
                          onChange={(e) => {
                            const next = { ...chosen };
                            if (e.target.checked) next[s.id] = '1';
                            else delete next[s.id];
                            setChosen(next);
                          }}
                        />
                        {s.name} <span className="text-slate-400">({s.unit})</span>
                      </label>
                      {s.type === 'QUANTITY' && s.id in chosen ? (
                        <TextInput
                          aria-label={`Số lượng ${s.name}`}
                          inputMode="numeric"
                          className="w-24"
                          value={chosen[s.id]}
                          onChange={(e) => setChosen({ ...chosen, [s.id]: e.target.value.replace(/[^\d]/g, '') })}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
              <section className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <p className="text-sm text-slate-600 sm:col-span-2">
                  Chỉ số đồng hồ lúc nhận phòng. Phòng chưa có đồng hồ thì hệ thống tạo đồng hồ với chỉ số này (chỉ nhập một lần); các tháng sau tự lấy làm chỉ số trước.
                </p>
                {(['ELECTRICITY', 'WATER'] as const).map((t) => (
                  <Field key={t} id={`mi-${t}`} label={`Chỉ số ${METER_TYPE_LABELS[t].toLowerCase()}`} error={fieldErrors.meter_readings?.[0]}>
                    <TextInput id={`mi-${t}`} inputMode="decimal" value={readings[t]} onChange={(e) => setReadings({ ...readings, [t]: e.target.value.replace(/[^\d.,]/g, '') })} />
                  </Field>
                ))}
              </section>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {reservationId && holdingBalance !== '0' ? (
                <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900 sm:col-span-2">
                  Tiền giữ chỗ {formatVnd(holdingBalance)} sẽ được chuyển thành tiền cọc (không phải tiền thu mới).
                </p>
              ) : null}
              <Field id="mi-dep" label="Tiền cọc thực nhận hôm nay" hint="Để trống nếu chưa nhận. Chỉ ghi số tiền đã thực nhận." error={fieldErrors['deposit_received.amount_vnd']?.[0]}>
                <MoneyInput id="mi-dep" value={deposit.amount_vnd} onChange={(amount_vnd) => setDeposit({ ...deposit, amount_vnd })} />
              </Field>
              <Field id="mi-dep-method" label="Phương thức">
                <Select id="mi-dep-method" value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })}>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="mi-dep-date" label="Ngày nhận">
                <TextInput id="mi-dep-date" type="date" value={deposit.paid_at} onChange={(e) => setDeposit({ ...deposit, paid_at: e.target.value })} />
              </Field>
              <Field id="mi-dep-ref" label="Mã giao dịch / tham chiếu">
                <TextInput id="mi-dep-ref" value={deposit.reference} onChange={(e) => setDeposit({ ...deposit, reference: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {step === 5 ? (
            <DescriptionList
              items={[
                { label: 'Phòng', value: `${room.building_code} · ${room.code}` },
                { label: 'Ngày nhận phòng', value: formatBusinessDate(basics.start_date) },
                { label: 'Giá thuê / tháng', value: formatVnd(basics.monthly_rent_vnd || '0') },
                { label: 'Ngày đến hạn', value: `Ngày ${basics.billing_due_day} hằng tháng` },
                { label: 'Người đại diện', value: personLabel(primary) },
                { label: 'Người ở cùng', value: members.length ? members.map(personLabel).join(', ') : 'Không' },
                { label: 'Hợp đồng', value: contract.enabled ? `${formatBusinessDate(contract.term_start)} → ${formatBusinessDate(contract.term_end)} (${contract.signed ? 'đã ký' : 'nháp'})` : 'Không tạo (thuê theo tháng)' },
                {
                  label: 'Dịch vụ',
                  value: Object.keys(chosen).length
                    ? optionalServices.filter((s) => s.id in chosen).map((s) => `${s.name}${s.type === 'QUANTITY' ? ` × ${chosen[s.id]}` : ''}`).join(', ')
                    : 'Không',
                },
                { label: 'Chỉ số ban đầu', value: [readings.ELECTRICITY && `Điện ${readings.ELECTRICITY}`, readings.WATER && `Nước ${readings.WATER}`].filter(Boolean).join(' · ') || 'Không nhập' },
                { label: 'Cọc thỏa thuận', value: formatVnd(basics.deposit_required_vnd || '0') },
                { label: 'Cọc đang giữ sau khi nhận phòng', value: <strong className="tabular">{formatVnd(depositTotal)}</strong> },
              ]}
            />
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Quay lại
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)}>Tiếp</Button>
        ) : (
          <Button onClick={() => void submit()} disabled={moveIn.isPending}>
            {moveIn.isPending ? 'Đang xử lý…' : 'Xác nhận nhận phòng'}
          </Button>
        )}
      </div>
    </div>
  );
}
