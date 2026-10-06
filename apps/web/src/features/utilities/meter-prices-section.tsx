'use client';

import { type MeterPrices, PERMISSIONS } from '@ql-tro/shared';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, MoneyInput, Select, TextInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, formatVnd } from '@/lib/format';
import { useCreateMeterPrice, useMeterPrices } from './api';

/** "2026-12-01" → "kỳ 12/2026". */
export const periodLabel = (monthStart: string) => `kỳ ${monthStart.slice(5, 7)}/${monthStart.slice(0, 4)}`;
const unitPrice = (v: string, unit: string) => `${formatVnd(v.split('.')[0]!)}/${unit}`;

/** Giá điện nước theo tòa (MASTER_PLAN 8.5): đặt một lần, “Thay đổi giá” áp dụng từ kỳ đọc tiếp theo, có lịch sử. */
export function MeterPricesSection({ buildingId }: { buildingId: string }) {
  const can = useCan();
  const prices = useMeterPrices(buildingId);
  const [changing, setChanging] = useState<MeterPrices['items'][number] | null>(null);
  const manage = can(PERMISSIONS.SERVICES_MANAGE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Giá điện nước</CardTitle>
      </CardHeader>
      {prices.isPending ? (
        <LoadingState />
      ) : prices.isError ? (
        <ErrorState error={prices.error} onRetry={() => void prices.refetch()} />
      ) : (
        <>
          <CardContent className="grid gap-3 border-b border-slate-100 sm:grid-cols-2">
            {prices.data.items.map((item) => (
              <div key={item.meter_type} className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-3" data-testid={`meter-price-${item.meter_type}`}>
                <div>
                  <p className="text-sm text-slate-500">{item.name}</p>
                  {item.current ? (
                    <p className="text-lg font-semibold tabular">{unitPrice(item.current.unit_price, item.unit)}</p>
                  ) : (
                    <p className="font-medium text-amber-800">Chưa đặt giá — chưa tạm tính và sẽ chặn phát hành thông báo</p>
                  )}
                  {item.upcoming.map((u) => (
                    <p key={u.id} className="mt-1 text-sm">
                      <Badge tone="violet">Từ {periodLabel(u.effective_from)}</Badge> <span className="tabular">{unitPrice(u.unit_price, item.unit)}</span>
                    </p>
                  ))}
                </div>
                {manage ? (
                  <Button size="sm" variant="outline" onClick={() => setChanging(item)}>
                    <Pencil className="size-4" aria-hidden />
                    {item.current || item.upcoming.length ? 'Thay đổi giá' : 'Đặt giá'}
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
          <Table>
            <thead>
              <tr>
                <Th>Khoản</Th>
                <Th>Áp dụng từ</Th>
                <Th className="text-right">Đơn giá</Th>
                <Th className="hidden md:table-cell">Lý do</Th>
                <Th className="hidden md:table-cell">Người đổi</Th>
              </tr>
            </thead>
            <tbody>
              {prices.data.items.flatMap((item) =>
                item.history.map((p) => (
                  <Tr key={p.id}>
                    <Td>{item.name}</Td>
                    <Td className="whitespace-nowrap">{periodLabel(p.effective_from)}</Td>
                    <Td className="text-right tabular whitespace-nowrap">{unitPrice(p.unit_price, item.unit)}</Td>
                    <Td className="hidden text-slate-600 md:table-cell">{p.reason ?? '—'}</Td>
                    <Td className="hidden text-slate-600 md:table-cell">
                      {p.created_by_name ?? '—'}
                      <div className="text-xs text-slate-400">{formatBusinessDate(p.created_at.slice(0, 10))}</div>
                    </Td>
                  </Tr>
                )),
              )}
              {prices.data.items.every((i) => i.history.length === 0) ? (
                <Tr>
                  <Td colSpan={5} className="text-center text-slate-500">
                    Chưa có lịch sử giá.
                  </Td>
                </Tr>
              ) : null}
            </tbody>
          </Table>
          <MeterPriceDialog item={changing} nextPeriod={prices.data.next_period_start} buildingId={buildingId} onClose={() => setChanging(null)} />
        </>
      )}
    </Card>
  );
}

function MeterPriceDialog({ item, nextPeriod, buildingId, onClose }: { item: MeterPrices['items'][number] | null; nextPeriod: string; buildingId: string; onClose: () => void }) {
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title={item ? `${item.current ? 'Thay đổi giá' : 'Đặt giá'} ${item.name.toLowerCase()}` : ''}
      description="Giá mới áp dụng từ kỳ đọc chỉ số đã chọn. Các kỳ trước giữ nguyên giá cũ."
    >
      {item ? <MeterPriceForm item={item} nextPeriod={nextPeriod} buildingId={buildingId} onClose={onClose} /> : null}
    </Dialog>
  );
}

function periodOptions(nextPeriod: string, hasPrice: boolean): string[] {
  const [y, m] = nextPeriod.split('-').map(Number) as [number, number];
  const out: string[] = [];
  // Lần đặt giá đầu tiên có thể chọn các kỳ trước; thay đổi giá thì từ kỳ đọc tiếp theo trở đi.
  for (let i = hasPrice ? 0 : -6; i < 7; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}

function MeterPriceForm({ item, nextPeriod, buildingId, onClose }: { item: MeterPrices['items'][number]; nextPeriod: string; buildingId: string; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateMeterPrice(buildingId);
  const hasPrice = !!item.current || item.upcoming.length > 0;
  const [v, setV] = useState({ effective_from: nextPeriod, unit_price: '', reason: hasPrice ? '' : 'Giá ban đầu', confirm_existing_readings: false });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const submit = async () => {
    setError('');
    setFieldErrors({});
    try {
      await create.mutateAsync({ meter_type: item.meter_type, ...v, reason: v.reason.trim() });
      toast.success(`Đã đặt giá ${item.name.toLowerCase()} ${formatVnd(v.unit_price || '0')}/${item.unit} từ ${periodLabel(v.effective_from)}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors ?? {});
      } else setError('Không lưu được giá.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      {item.current ? (
        <p className="text-sm">
          Giá hiện tại: <strong className="tabular">{unitPrice(item.current.unit_price, item.unit)}</strong> (từ {periodLabel(item.current.effective_from)})
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="mp-price" label={`Đơn giá mới (đ/${item.unit})`} required error={fieldErrors.unit_price?.[0]}>
          <MoneyInput id="mp-price" value={v.unit_price} onChange={(unit_price) => setV({ ...v, unit_price })} />
        </Field>
        <Field id="mp-from" label="Áp dụng từ" required error={fieldErrors.effective_from?.[0]} hint={v.effective_from === nextPeriod ? 'Kỳ đọc chỉ số tiếp theo' : undefined}>
          <Select id="mp-from" value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value, confirm_existing_readings: false })}>
            {periodOptions(nextPeriod, hasPrice).map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
                {p === nextPeriod ? ' (kỳ tiếp theo)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="mp-reason" label="Lý do" required className="sm:col-span-2" error={fieldErrors.reason?.[0]}>
          <TextInput id="mp-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="VD: Điện lực điều chỉnh giá" />
        </Field>
      </div>
      {fieldErrors.confirm_existing_readings || v.effective_from < nextPeriod ? (
        <Checkbox id="mp-confirm" checked={v.confirm_existing_readings} onChange={(confirm_existing_readings) => setV({ ...v, confirm_existing_readings })}>
          {periodLabel(v.effective_from)} đã có chỉ số chốt. Tôi xác nhận tiền tạm tính của kỳ đó sẽ tính theo giá mới.
        </Checkbox>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
        <Button onClick={() => void submit()} disabled={create.isPending || !v.unit_price}>
          Lưu giá
        </Button>
      </div>
    </div>
  );
}
