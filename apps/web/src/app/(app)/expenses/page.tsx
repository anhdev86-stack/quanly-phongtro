'use client';

import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseDto, PAYMENT_METHOD_LABELS, PERMISSIONS } from '@ql-tro/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, MoneyInput, Select, TextInput, Textarea } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useMe } from '@/features/auth/api';
import { useCan } from '@/features/auth/permissions';
import { useCreateExpense, useExpenses, useReverseExpense } from '@/features/expenses/api';
import { useBuildings, useRooms } from '@/features/property/api';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError, newIdempotencyKey } from '@/lib/api-client';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';

/** Chi phí vận hành (V1.1): ghi khi đã thực chi; sai thì đảo có lý do, không sửa/xóa. */
export default function ExpensesPage() {
  const can = useCan();
  const toast = useToast();
  const buildings = useBuildings();
  const [f, setF] = useState({ from: `${todayLocal().slice(0, 7)}-01`, to: todayLocal(), building_id: '', category: '', status: '', page: 1, page_size: 50 });
  const list = useExpenses(f);
  const reverse = useReverseExpense();
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState<{ e: ExpenseDto; key: string } | null>(null);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch, page: 1 });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Chi phí"
        description="Ghi các khoản đã thực chi (sửa chữa, hóa đơn điện nước tổng, vệ sinh…). Hoàn cọc, hoàn tiền dư không phải chi phí. Ghi sai thì đảo, không xóa."
        actions={
          can(PERMISSIONS.EXPENSES_RECORD) ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              Ghi chi phí
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <Field id="ex-from" label="Từ ngày" className="sm:w-40">
          <TextInput id="ex-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field id="ex-to" label="Đến ngày" className="sm:w-40">
          <TextInput id="ex-to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
        <Field id="ex-building" label="Tòa" className="sm:w-56">
          <Select id="ex-building" value={f.building_id} onChange={(e) => set({ building_id: e.target.value })}>
            <option value="">Tất cả</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ex-cat" label="Loại" className="sm:w-48">
          <Select id="ex-cat" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">Tất cả</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ex-status" label="Trạng thái" className="sm:w-36">
          <Select id="ex-status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Tất cả</option>
            <option value="POSTED">Hiệu lực</option>
            <option value="REVERSED">Đã đảo</option>
          </Select>
        </Field>
      </FilterBar>
      {list.data ? (
        <Card className="mb-3">
          <CardContent>
            <p className="text-sm text-slate-500">Tổng chi (còn hiệu lực) trong bộ lọc</p>
            <p className="text-xl font-semibold tabular" data-testid="expense-total">
              {formatVnd(list.data.total_vnd)}
            </p>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Chưa có khoản chi trong khoảng này" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Chứng từ</Th>
                <Th>Loại</Th>
                <Th className="hidden md:table-cell">Tòa / phòng</Th>
                <Th className="hidden lg:table-cell">Nội dung</Th>
                <Th className="text-right">Số tiền</Th>
                <Th className="text-right">
                  <span className="sr-only">Thao tác</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((e) => (
                <Tr key={e.id} className={e.status === 'REVERSED' ? 'opacity-60' : ''}>
                  <Td className="whitespace-nowrap">
                    <span className="font-medium">{e.number}</span>
                    <div className="text-xs text-slate-500">{formatBusinessDate(e.spent_on)}</div>
                    {e.status === 'REVERSED' ? <Badge tone="gray">Đã đảo</Badge> : null}
                  </Td>
                  <Td>{EXPENSE_CATEGORY_LABELS[e.category]}</Td>
                  <Td className="hidden md:table-cell">{e.building_code ? `${e.building_code}${e.room_code ? ` · ${e.room_code}` : ''}` : 'Chung'}</Td>
                  <Td className="hidden lg:table-cell">
                    {[e.payee, e.note].filter(Boolean).join(' — ') || '—'}
                    <div className="text-xs text-slate-500">
                      {PAYMENT_METHOD_LABELS[e.method as keyof typeof PAYMENT_METHOD_LABELS] ?? e.method}
                      {e.reverse_reason ? ` · Đảo: ${e.reverse_reason}` : ''}
                    </div>
                  </Td>
                  <Td className="text-right tabular font-medium">{formatVnd(e.amount_vnd)}</Td>
                  <Td className="text-right">
                    {e.status === 'POSTED' && can(PERMISSIONS.FINANCE_REVERSE) ? (
                      <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setReversing({ e, key: newIdempotencyKey() })}>
                        Đảo
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data ? (
          <div className="px-3 pb-3">
            <Pagination page={f.page} pageSize={f.page_size} total={list.data.total} onPage={(page) => setF({ ...f, page })} />
          </div>
        ) : null}
      </Card>
      {creating ? <ExpenseDialog onClose={() => setCreating(false)} /> : null}
      <ReasonDialog
        open={!!reversing}
        title={`Đảo khoản chi ${reversing?.e.number ?? ''}`}
        description={reversing ? `${EXPENSE_CATEGORY_LABELS[reversing.e.category]} · ${formatVnd(reversing.e.amount_vnd)} · ${formatBusinessDate(reversing.e.spent_on)}. Khoản chi không bị xóa mà chuyển sang “đã đảo”.` : undefined}
        confirmLabel="Đảo khoản chi"
        pending={reverse.isPending}
        onClose={() => setReversing(null)}
        onConfirm={async (reason) => {
          if (!reversing) return;
          try {
            await reverse.mutateAsync({ id: reversing.e.id, reason, key: reversing.key });
            toast.success(`Đã đảo ${reversing.e.number}.`);
            setReversing(null);
          } catch (err) {
            throw new Error(err instanceof ApiError ? err.message : 'Không đảo được.');
          }
        }}
      />
    </div>
  );
}

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const me = useMe();
  const buildings = useBuildings();
  const create = useCreateExpense();
  const [key] = useState(() => newIdempotencyKey());
  const [v, setV] = useState({ building_id: '', room_id: '', category: 'REPAIR', amount_vnd: '', spent_on: todayLocal(), method: 'CASH', payee: '', note: '' });
  const rooms = useRooms({ building_id: v.building_id || undefined, page: 1, page_size: 100 });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const submit = async () => {
    setError('');
    setFe({});
    try {
      const e = await create.mutateAsync({
        key,
        body: { ...v, building_id: v.building_id || null, room_id: v.room_id || null, payee: v.payee || undefined, note: v.note || undefined },
      });
      toast.success(`Đã ghi ${e.number}: ${formatVnd(e.amount_vnd)}.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFe(err.fieldErrors ?? {});
      } else setError('Không lưu được.');
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Ghi chi phí"
      description="Chỉ ghi khi tiền đã thực chi."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={() => void submit()} disabled={create.isPending}>
            Ghi chi phí
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="exd-building" label="Tòa" hint={me.data?.all_buildings ? 'Để trống = chi chung cả nhà trọ' : undefined} error={fe.building_id?.[0]}>
            <Select id="exd-building" value={v.building_id} onChange={(e) => setV({ ...v, building_id: e.target.value, room_id: '' })}>
              <option value="">{me.data?.all_buildings ? 'Chung (không theo tòa)' : '— Chọn tòa —'}</option>
              {buildings.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="exd-room" label="Phòng (nếu có)" error={fe.room_id?.[0]}>
            <Select id="exd-room" value={v.room_id} disabled={!v.building_id} onChange={(e) => setV({ ...v, room_id: e.target.value })}>
              <option value="">Không theo phòng</option>
              {rooms.data?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="exd-cat" label="Loại chi" required>
            <Select id="exd-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="exd-amount" label="Số tiền" required error={fe.amount_vnd?.[0]}>
            <MoneyInput id="exd-amount" value={v.amount_vnd} onChange={(amount_vnd) => setV({ ...v, amount_vnd })} />
          </Field>
          <Field id="exd-date" label="Ngày chi" required error={fe.spent_on?.[0]}>
            <TextInput id="exd-date" type="date" value={v.spent_on} onChange={(e) => setV({ ...v, spent_on: e.target.value })} />
          </Field>
          <Field id="exd-method" label="Hình thức">
            <Select id="exd-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
              {(['CASH', 'BANK_TRANSFER', 'QR', 'OTHER'] as const).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="exd-payee" label="Chi cho" className="sm:col-span-2">
            <TextInput id="exd-payee" value={v.payee} onChange={(e) => setV({ ...v, payee: e.target.value })} />
          </Field>
        </div>
        <Field id="exd-note" label="Ghi chú">
          <Textarea id="exd-note" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
