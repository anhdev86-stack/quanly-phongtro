'use client';

import {
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_STATUSES,
  type MaintenanceDto,
  PERMISSIONS,
} from '@ql-tro/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FilterBar, PageHeader, Pagination } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Select, TextInput, Textarea } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useMe } from '@/features/auth/api';
import { useCan } from '@/features/auth/permissions';
import { Attachments } from '@/features/files/attachments';
import { useCreateMaintenance, useMaintenance, useUpdateMaintenance } from '@/features/maintenance/api';
import { useBuildings, useRooms } from '@/features/property/api';
import { ApiError } from '@/lib/api-client';

const PRIORITY_TONE: Record<string, BadgeTone> = { URGENT: 'red', HIGH: 'amber', NORMAL: 'blue', LOW: 'gray' };
const STATUS_TONE: Record<string, BadgeTone> = { OPEN: 'amber', IN_PROGRESS: 'blue', DONE: 'green', CANCELLED: 'gray' };
const dateTime = (v: string) => new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

/** Yêu cầu bảo trì (V1.1): ghi nhận hư hỏng theo phòng, giao người xử lý, đánh dấu xong, đính kèm ảnh. */
export default function MaintenancePage() {
  const can = useCan();
  const buildings = useBuildings();
  const [f, setF] = useState({ building_id: '', status: '', open_only: 'true', page: 1, page_size: 50 });
  const list = useMaintenance(f);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<MaintenanceDto | null>(null);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch, page: 1 });
  const manage = can(PERMISSIONS.MAINTENANCE_MANAGE);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Bảo trì"
        description="Ghi nhận hư hỏng theo phòng và theo dõi tới khi sửa xong. Cần đóng phòng để sửa thì đổi trạng thái vận hành ở trang phòng."
        actions={
          manage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              Tạo yêu cầu
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <Field id="mt-building" label="Tòa" className="sm:w-44">
          <Select id="mt-building" value={f.building_id} onChange={(e) => set({ building_id: e.target.value })}>
            <option value="">Tất cả</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="mt-status" label="Trạng thái" className="sm:w-44">
          <Select id="mt-status" value={f.status || (f.open_only === 'true' ? 'ACTIVE' : '')} onChange={(e) => set(e.target.value === 'ACTIVE' ? { status: '', open_only: 'true' } : { status: e.target.value, open_only: 'false' })}>
            <option value="ACTIVE">Đang mở</option>
            <option value="">Tất cả</option>
            {MAINTENANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MAINTENANCE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <Card>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Không có yêu cầu bảo trì" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Yêu cầu</Th>
                <Th>Phòng</Th>
                <Th>Ưu tiên</Th>
                <Th>Trạng thái</Th>
                <Th className="hidden md:table-cell">Phụ trách</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((m) => (
                <Tr key={m.id} className="cursor-pointer" onClick={() => setOpen(m)}>
                  <Td>
                    <button type="button" className="text-left font-medium text-brand-800 hover:underline" onClick={() => setOpen(m)}>
                      {m.title}
                    </button>
                    <div className="text-xs text-slate-500">
                      {m.code} · {dateTime(m.created_at)}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {m.building_code} · {m.room_code}
                  </Td>
                  <Td>
                    <Badge tone={PRIORITY_TONE[m.priority]}>{MAINTENANCE_PRIORITY_LABELS[m.priority]}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[m.status]}>{MAINTENANCE_STATUS_LABELS[m.status]}</Badge>
                  </Td>
                  <Td className="hidden md:table-cell">{m.assignee_name ?? '—'}</Td>
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
      {creating ? <CreateDialog onClose={() => setCreating(false)} /> : null}
      {open ? <DetailDialog m={open} manage={manage} onClose={() => setOpen(null)} onChanged={setOpen} /> : null}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const buildings = useBuildings();
  const create = useCreateMaintenance();
  const [v, setV] = useState({ building_id: '', room_id: '', title: '', description: '', priority: 'NORMAL', reported_by: '' });
  const rooms = useRooms({ building_id: v.building_id || undefined, page: 1, page_size: 100 });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});
  const submit = async () => {
    setError('');
    setFe({});
    try {
      const m = await create.mutateAsync({ room_id: v.room_id, title: v.title, description: v.description || undefined, priority: v.priority, reported_by: v.reported_by || undefined });
      toast.success(`Đã tạo ${m.code}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFe(e.fieldErrors ?? {});
      } else setError('Không lưu được.');
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Tạo yêu cầu bảo trì"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={() => void submit()} disabled={create.isPending || !v.room_id}>
            Tạo yêu cầu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="mc-building" label="Tòa">
            <Select id="mc-building" value={v.building_id} onChange={(e) => setV({ ...v, building_id: e.target.value, room_id: '' })}>
              <option value="">— Chọn tòa —</option>
              {buildings.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="mc-room" label="Phòng" required error={fe.room_id?.[0]}>
            <Select id="mc-room" value={v.room_id} disabled={!v.building_id} onChange={(e) => setV({ ...v, room_id: e.target.value })}>
              <option value="">— Chọn phòng —</option>
              {rooms.data?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="mc-title" label="Nội dung" required error={fe.title?.[0]} className="sm:col-span-2">
            <TextInput id="mc-title" placeholder="VD: Vòi nước rò rỉ" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          </Field>
          <Field id="mc-priority" label="Mức ưu tiên">
            <Select id="mc-priority" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
              {MAINTENANCE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {MAINTENANCE_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="mc-reporter" label="Người báo">
            <TextInput id="mc-reporter" value={v.reported_by} onChange={(e) => setV({ ...v, reported_by: e.target.value })} />
          </Field>
        </div>
        <Field id="mc-desc" label="Mô tả">
          <Textarea id="mc-desc" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

function DetailDialog({ m, manage, onClose, onChanged }: { m: MaintenanceDto; manage: boolean; onClose: () => void; onChanged: (m: MaintenanceDto) => void }) {
  const toast = useToast();
  const me = useMe();
  const update = useUpdateMaintenance();
  const [note, setNote] = useState(m.resolution_note ?? '');
  const [error, setError] = useState('');
  const act = async (patch: Record<string, unknown>, done: string) => {
    setError('');
    try {
      const r = await update.mutateAsync({ id: m.id, ...patch, expected_version: m.version });
      toast.success(done);
      onChanged(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không lưu được.');
    }
  };
  const active = m.status === 'OPEN' || m.status === 'IN_PROGRESS';
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`${m.code} · ${m.title}`}
      description={`${m.building_code} · ${m.room_code} — ${MAINTENANCE_PRIORITY_LABELS[m.priority]}${m.reported_by ? ` · báo bởi ${m.reported_by}` : ''}`}
      footer={
        manage ? (
          <>
            {m.status === 'OPEN' ? (
              <Button variant="outline" disabled={update.isPending} onClick={() => void act({ status: 'IN_PROGRESS', ...(me.data && !m.assignee_id ? { assignee_id: me.data.id } : {}) }, 'Đã nhận xử lý.')}>
                Nhận xử lý
              </Button>
            ) : null}
            {active ? (
              <Button variant="outline" className="text-red-700" disabled={update.isPending} onClick={() => void act({ status: 'CANCELLED' }, 'Đã hủy yêu cầu.')}>
                Hủy yêu cầu
              </Button>
            ) : (
              <Button variant="outline" disabled={update.isPending} onClick={() => void act({ status: 'OPEN' }, 'Đã mở lại.')}>
                Mở lại
              </Button>
            )}
            {active ? (
              <Button disabled={update.isPending} onClick={() => void act({ status: 'DONE', resolution_note: note || undefined }, 'Đã đánh dấu xong.')}>
                Đã sửa xong
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Trạng thái</dt>
          <dd>
            <Badge tone={STATUS_TONE[m.status]}>{MAINTENANCE_STATUS_LABELS[m.status]}</Badge>
          </dd>
          <dt className="text-slate-500">Phụ trách</dt>
          <dd>{m.assignee_name ?? '—'}</dd>
          <dt className="text-slate-500">Tạo bởi</dt>
          <dd>
            {m.created_by_name ?? '—'} · {dateTime(m.created_at)}
          </dd>
          {m.resolved_at ? (
            <>
              <dt className="text-slate-500">Xong lúc</dt>
              <dd>{dateTime(m.resolved_at)}</dd>
            </>
          ) : null}
          {m.expense_number ? (
            <>
              <dt className="text-slate-500">Khoản chi</dt>
              <dd>{m.expense_number}</dd>
            </>
          ) : null}
        </dl>
        {m.description ? <p className="text-sm whitespace-pre-line">{m.description}</p> : null}
        {manage && active ? (
          <Field id="md-note" label="Kết quả xử lý">
            <Textarea id="md-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : m.resolution_note ? (
          <p className="text-sm">
            <span className="text-slate-500">Kết quả: </span>
            {m.resolution_note}
          </p>
        ) : null}
        <Attachments ownerType="maintenance_request" ownerId={m.id} title="Ảnh hư hỏng / sau sửa" categories={['MAINTENANCE_PHOTO', 'RECEIPT']} canManage={manage} />
      </div>
    </Dialog>
  );
}
