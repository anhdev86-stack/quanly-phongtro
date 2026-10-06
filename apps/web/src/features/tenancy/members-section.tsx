'use client';

import { PERMISSIONS, RESIDENCE_LABELS, type TenancyDetail } from '@ql-tro/shared';
import { Crown, LogOut, ShieldCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Select, TextInput, Textarea } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { ApiError } from '@/lib/api-client';
import { formatBusinessDate, todayLocal } from '@/lib/format';
import { useMemberAction } from './api';
import { newPerson, PersonPicker, type PersonChoice, personToRef } from './person-picker';
import { scopedErrors } from './tenant-fields';

type Member = TenancyDetail['members'][number];

export function MembersSection({ tenancy }: { tenancy: TenancyDetail }) {
  const can = useCan();
  const toast = useToast();
  const action = useMemberAction();
  const canManage = can(PERMISSIONS.TENANTS_MANAGE) && tenancy.status !== 'ENDED';
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState<Member | null>(null);
  const [residence, setResidence] = useState<Member | null>(null);

  const setPrimary = async (m: Member) => {
    try {
      await action.mutateAsync({ path: `/members/${m.id}/set-primary`, body: { expected_version: tenancy.version } });
      toast.success(`${m.full_name} là người đại diện mới.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không thực hiện được.');
    }
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Người ở ({tenancy.member_count})</CardTitle>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" aria-hidden />
            Thêm người
          </Button>
        ) : null}
      </CardHeader>
      <Table>
        <thead>
          <tr>
            <Th>Họ tên</Th>
            <Th>Vai trò</Th>
            <Th className="hidden sm:table-cell">Thời gian ở</Th>
            <Th>Tạm trú</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {tenancy.members.map((m) => (
            <Tr key={m.id} className={m.left_on ? 'opacity-60' : ''}>
              <Td>
                <Link href={`/tenants/${m.tenant_id}`} className="font-medium text-brand-800 hover:underline">
                  {m.full_name}
                </Link>
                {m.phone ? <div className="text-xs text-slate-500">{m.phone}</div> : null}
              </Td>
              <Td>{m.role === 'PRIMARY' ? <Badge tone="blue">Đại diện</Badge> : <Badge>Ở cùng</Badge>}</Td>
              <Td className="hidden tabular sm:table-cell">
                {formatBusinessDate(m.joined_on)} → {m.left_on ? formatBusinessDate(m.left_on) : 'nay'}
              </Td>
              <Td>
                <Badge tone={m.residence_status === 'REGISTERED' ? 'green' : m.residence_status === 'NOT_REGISTERED' ? 'amber' : 'gray'}>
                  {RESIDENCE_LABELS[m.residence_status]}
                </Badge>
              </Td>
              <Td className="text-right whitespace-nowrap">
                {canManage && !m.left_on ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setResidence(m)} aria-label={`Tạm trú của ${m.full_name}`}>
                      <ShieldCheck className="size-4" />
                    </Button>
                    {m.role !== 'PRIMARY' ? (
                      <Button variant="ghost" size="sm" onClick={() => void setPrimary(m)} aria-label={`Đặt ${m.full_name} làm đại diện`}>
                        <Crown className="size-4" />
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => setLeaving(m)} aria-label={`${m.full_name} rời đi`}>
                      <LogOut className="size-4 text-red-600" />
                    </Button>
                  </>
                ) : null}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Thêm người ở cùng">
        {adding ? <AddMemberForm tenancy={tenancy} onClose={() => setAdding(false)} /> : null}
      </Dialog>
      <Dialog open={!!leaving} onClose={() => setLeaving(null)} title={leaving ? `${leaving.full_name} rời đi` : ''} size="sm">
        {leaving ? <LeaveForm tenancy={tenancy} member={leaving} onClose={() => setLeaving(null)} /> : null}
      </Dialog>
      <Dialog open={!!residence} onClose={() => setResidence(null)} title="Đăng ký tạm trú" size="sm">
        {residence ? <ResidenceForm member={residence} onClose={() => setResidence(null)} /> : null}
      </Dialog>
    </Card>
  );
}

function AddMemberForm({ tenancy, onClose }: { tenancy: TenancyDetail; onClose: () => void }) {
  const toast = useToast();
  const action = useMemberAction();
  const [person, setPerson] = useState<PersonChoice>(newPerson);
  const [joined, setJoined] = useState(todayLocal());
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const submit = async () => {
    setError('');
    try {
      await action.mutateAsync({ path: `/tenancies/${tenancy.id}/members`, body: { person: personToRef(person), joined_on: joined, expected_version: tenancy.version } });
      toast.success('Đã thêm người ở cùng.');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không thêm được.');
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors ?? {});
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <PersonPicker prefix="am" value={person} onChange={setPerson} errors={scopedErrors(fieldErrors, 'person.new_tenant')} />
      <Field id="am-joined" label="Ngày vào ở" required hint="Phí theo đầu người tính từ ngày này.">
        <TextInput id="am-joined" type="date" value={joined} onChange={(e) => setJoined(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending}>
          Thêm
        </Button>
      </div>
    </div>
  );
}

function LeaveForm({ tenancy, member, onClose }: { tenancy: TenancyDetail; member: Member; onClose: () => void }) {
  const toast = useToast();
  const action = useMemberAction();
  const others = tenancy.members.filter((m) => m.id !== member.id && !m.left_on);
  const [lastDay, setLastDay] = useState(todayLocal());
  const [nextPrimary, setNextPrimary] = useState(others[0]?.id ?? '');
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    try {
      await action.mutateAsync({
        path: `/members/${member.id}/leave`,
        body: { last_day: lastDay, new_primary_member_id: member.role === 'PRIMARY' ? nextPrimary || null : null, expected_version: tenancy.version },
      });
      toast.success(`Đã ghi nhận ${member.full_name} rời đi.`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không thực hiện được.');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Field id="lv-day" label="Ngày cuối cùng ở" required hint="Lịch sử vẫn được giữ; phí theo đầu người tính đến hết ngày này.">
        <TextInput id="lv-day" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
      </Field>
      {member.role === 'PRIMARY' ? (
        others.length ? (
          <Field id="lv-next" label="Người đại diện mới" required>
            <Select id="lv-next" value={nextPrimary} onChange={(e) => setNextPrimary(e.target.value)}>
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-sm text-amber-800">Đây là người cuối cùng của phòng. Hãy dùng quy trình trả phòng.</p>
        )
      ) : null}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending || (member.role === 'PRIMARY' && !others.length)}>
          Xác nhận
        </Button>
      </div>
    </div>
  );
}

function ResidenceForm({ member, onClose }: { member: Member; onClose: () => void }) {
  const toast = useToast();
  const action = useMemberAction();
  const [v, setV] = useState({ status: member.residence_status, on: member.residence_registered_on ?? '', note: member.residence_note ?? '' });
  const [error, setError] = useState('');
  const submit = async () => {
    try {
      await action.mutateAsync({
        path: `/members/${member.id}/residence`,
        body: { residence_status: v.status, residence_registered_on: v.on || null, residence_note: v.note || null, expected_version: member.version },
      });
      toast.success('Đã cập nhật tạm trú.');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không cập nhật được.');
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Field id="rs-status" label="Tình trạng">
        <Select id="rs-status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Member['residence_status'] })}>
          {Object.entries(RESIDENCE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      {v.status === 'REGISTERED' ? (
        <Field id="rs-on" label="Ngày đăng ký">
          <TextInput id="rs-on" type="date" value={v.on} onChange={(e) => setV({ ...v, on: e.target.value })} />
        </Field>
      ) : null}
      <Field id="rs-note" label="Ghi chú">
        <Textarea id="rs-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button variant="outline" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={() => void submit()} disabled={action.isPending}>
          Lưu
        </Button>
      </div>
    </div>
  );
}
