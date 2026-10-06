'use client';

import type { BillingSettings } from '@ql-tro/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormError, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useBillingSettings, useCreateBillingSettings } from '@/features/utilities/api';
import { ApiError } from '@/lib/api-client';
import { firstOfNextMonth, formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';

const PRORATION = { ACTUAL_DAYS: 'Theo số ngày thực của tháng', FIXED_30: 'Cố định 30 ngày' } as const;
const TIMING = { ADVANCE: 'Thu trước', ARREARS: 'Thu sau' } as const;

const describe = (p: BillingSettings) =>
  `${PRORATION[p.proration]} · làm tròn ${formatVnd(String(p.rounding_unit))} · hạn ngày ${p.due_day} · dịch vụ mới ${TIMING[p.default_charge_timing].toLowerCase()}`;

export default function BillingSettingsPage() {
  const settings = useBillingSettings();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        back={{ href: '/settings', label: 'Cấu hình' }}
        title="Chính sách tính phí"
        description="Mỗi lần đổi tạo một phiên bản có ngày hiệu lực. Chứng từ đã phát hành giữ nguyên chính sách lúc phát hành."
      />
      {settings.isPending ? (
        <LoadingState />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <>
          <Card>
            <CardContent>
              <p className="text-sm text-slate-500">Đang áp dụng{settings.data.effective_from ? ` từ ${formatBusinessDate(settings.data.effective_from)}` : ' (mặc định)'}</p>
              <p className="font-medium">{describe(settings.data.current)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tạo phiên bản mới</CardTitle>
            </CardHeader>
            <CardContent>
              <BillingForm current={settings.data.current} />
            </CardContent>
          </Card>
          {settings.data.history.length ? (
            <Card>
              <Table>
                <thead>
                  <tr>
                    <Th>Từ ngày</Th>
                    <Th>Chính sách</Th>
                    <Th className="hidden sm:table-cell">Người tạo</Th>
                  </tr>
                </thead>
                <tbody>
                  {settings.data.history.map((h) => (
                    <Tr key={h.id}>
                      <Td className="tabular whitespace-nowrap">{formatBusinessDate(h.effective_from)}</Td>
                      <Td>{describe(h.payload)}</Td>
                      <Td className="hidden sm:table-cell">{h.created_by_name ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function BillingForm({ current }: { current: BillingSettings }) {
  const toast = useToast();
  const create = useCreateBillingSettings();
  const [v, setV] = useState({ ...current, effective_from: firstOfNextMonth(todayLocal()) });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const submit = async () => {
    setError('');
    setFe({});
    try {
      await create.mutateAsync(v);
      toast.success(`Đã lưu chính sách tính phí từ ${formatBusinessDate(v.effective_from)}.`);
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
        <Field id="bs-from" label="Hiệu lực từ" required error={fe.effective_from?.[0]}>
          <TextInput id="bs-from" type="date" value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value })} />
        </Field>
        <Field id="bs-proration" label="Chia phí theo ngày">
          <Select id="bs-proration" value={v.proration} onChange={(e) => setV({ ...v, proration: e.target.value as BillingSettings['proration'] })}>
            {Object.entries(PRORATION).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="bs-rounding" label="Làm tròn tiền">
          <Select id="bs-rounding" value={String(v.rounding_unit)} onChange={(e) => setV({ ...v, rounding_unit: Number(e.target.value) as BillingSettings['rounding_unit'] })}>
            <option value="1">Đến 1 đồng</option>
            <option value="100">Đến 100 đồng</option>
            <option value="1000">Đến 1.000 đồng</option>
          </Select>
        </Field>
        <Field id="bs-due" label="Ngày đến hạn mặc định (1–28)" error={fe.due_day?.[0]}>
          <TextInput id="bs-due" inputMode="numeric" value={String(v.due_day)} onChange={(e) => setV({ ...v, due_day: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
        </Field>
        <Field id="bs-timing" label="Dịch vụ mới mặc định">
          <Select id="bs-timing" value={v.default_charge_timing} onChange={(e) => setV({ ...v, default_charge_timing: e.target.value as BillingSettings['default_charge_timing'] })}>
            <option value="ADVANCE">Thu trước</option>
            <option value="ARREARS">Thu sau</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void submit()} disabled={create.isPending}>
          Lưu phiên bản mới
        </Button>
      </div>
    </div>
  );
}
