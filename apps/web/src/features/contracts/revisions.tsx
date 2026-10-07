'use client';

import type { ContractDto, ContractRevisionDto } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, MoneyInput, TextInput, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api-client';
import { formatBusinessDate, formatVnd, todayLocal } from '@/lib/format';
import { contractKeys, useContractAction } from './api';

export const useContractRevisions = (contractId: string) =>
  useQuery({ queryKey: [...contractKeys.all, 'revisions', contractId], queryFn: ({ signal }) => api<ContractRevisionDto[]>(`/contracts/${contractId}/revisions`, { signal }) });

/** Phụ lục hợp đồng đã ký (V1.1): đổi điều khoản từ ngày hiệu lực, không sửa hợp đồng gốc. Bỏ trống ô nào thì giữ nguyên điều khoản đó. */
export function RevisionDialog({ contract, onClose }: { contract: ContractDto | null; onClose: () => void }) {
  return contract ? <RevisionForm key={`${contract.id}:${contract.version}`} contract={contract} onClose={onClose} /> : null;
}

function RevisionForm({ contract, onClose }: { contract: ContractDto; onClose: () => void }) {
  const toast = useToast();
  const action = useContractAction<ContractRevisionDto>();
  const firstOfNext = (() => {
    const d = todayLocal();
    const [y, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  })();
  const [v, setV] = useState({
    effective_from: firstOfNext < contract.term_end ? firstOfNext : contract.term_start,
    monthly_rent_vnd: '',
    term_end: '',
    deposit_required_vnd: '',
    notice_days: '',
    terms_note: '',
    reason: '',
    confirm_mid_month_price: false,
  });
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Record<string, string[]>>({});

  const submit = async () => {
    setError('');
    setFe({});
    try {
      const r = await action.mutateAsync({
        path: `/contracts/${contract.id}/revisions`,
        body: {
          effective_from: v.effective_from,
          monthly_rent_vnd: v.monthly_rent_vnd || null,
          term_end: v.term_end || null,
          deposit_required_vnd: v.deposit_required_vnd || null,
          notice_days: v.notice_days === '' ? null : Number(v.notice_days),
          terms_note: v.terms_note || undefined,
          reason: v.reason,
          confirm_mid_month_price: v.confirm_mid_month_price,
          expected_version: contract.version,
        },
      });
      toast.success(`Đã lập phụ lục số ${r.revision_no} cho ${contract.code}.`);
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
      size="lg"
      title={`Phụ lục hợp đồng ${contract.code}`}
      description={`Kỳ ${formatBusinessDate(contract.term_start)} → ${formatBusinessDate(contract.term_end)}. Chỉ điền điều khoản cần đổi; giá thuê mới tạo phiên bản giá từ ngày hiệu lực.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={() => void submit()} disabled={action.isPending}>
            Lập phụ lục
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="rv-from" label="Có hiệu lực từ" required error={fe.effective_from?.[0]}>
            <TextInput id="rv-from" type="date" value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value })} />
          </Field>
          <Field id="rv-end" label="Ngày kết thúc mới" hint={`Hiện tại: ${formatBusinessDate(contract.term_end)}`} error={fe.term_end?.[0]}>
            <TextInput id="rv-end" type="date" value={v.term_end} onChange={(e) => setV({ ...v, term_end: e.target.value })} />
          </Field>
          <Field id="rv-rent" label="Giá thuê mới / tháng" hint={contract.terms.monthly_rent_vnd ? `Hiện tại: ${formatVnd(contract.terms.monthly_rent_vnd)}` : undefined} error={fe.monthly_rent_vnd?.[0]}>
            <MoneyInput id="rv-rent" value={v.monthly_rent_vnd} onChange={(monthly_rent_vnd) => setV({ ...v, monthly_rent_vnd })} />
          </Field>
          <Field id="rv-deposit" label="Mức cọc yêu cầu mới" hint={contract.terms.deposit_required_vnd ? `Hiện tại: ${formatVnd(contract.terms.deposit_required_vnd)}` : undefined} error={fe.deposit_required_vnd?.[0]}>
            <MoneyInput id="rv-deposit" value={v.deposit_required_vnd} onChange={(deposit_required_vnd) => setV({ ...v, deposit_required_vnd })} />
          </Field>
          <Field id="rv-notice" label="Số ngày báo trước mới" hint={`Hiện tại: ${contract.terms.notice_days} ngày`} error={fe.notice_days?.[0]}>
            <TextInput id="rv-notice" type="number" min={0} max={365} value={v.notice_days} onChange={(e) => setV({ ...v, notice_days: e.target.value })} />
          </Field>
        </div>
        <Field id="rv-note" label="Điều khoản khác (ghi chú)">
          <Textarea id="rv-note" rows={2} value={v.terms_note} onChange={(e) => setV({ ...v, terms_note: e.target.value })} />
        </Field>
        <Field id="rv-reason" label="Lý do / nội dung thỏa thuận" required error={fe.reason?.[0]}>
          <TextInput id="rv-reason" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
        {v.monthly_rent_vnd && !v.effective_from.endsWith('-01') ? (
          <Checkbox id="rv-mid" checked={v.confirm_mid_month_price} onChange={(confirm_mid_month_price) => setV({ ...v, confirm_mid_month_price })}>
            Giá mới có hiệu lực giữa tháng: tiền phòng tháng đó chia theo ngày.
          </Checkbox>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Danh sách phụ lục của một hợp đồng (ẩn nếu chưa có). */
export function RevisionList({ contract }: { contract: ContractDto }) {
  const revisions = useContractRevisions(contract.id);
  if (!revisions.data?.length) return null;
  return (
    <div className="border-t border-slate-100 px-4 py-3 text-sm" data-testid={`revisions-${contract.code}`}>
      <p className="mb-1 font-medium">Phụ lục của {contract.code}</p>
      <ul className="flex flex-col gap-1">
        {revisions.data.map((r) => (
          <li key={r.id}>
            <span className="font-medium">Số {r.revision_no}</span> · từ {formatBusinessDate(r.effective_from)} ·{' '}
            {[
              r.changes.monthly_rent_vnd ? `giá ${formatVnd(r.changes.monthly_rent_vnd)}` : null,
              r.changes.term_end ? `kết thúc ${formatBusinessDate(r.term_end_before)} → ${formatBusinessDate(r.term_end_after)}` : null,
              r.changes.deposit_required_vnd ? `cọc ${formatVnd(r.changes.deposit_required_vnd)}` : null,
              r.changes.notice_days !== null ? `báo trước ${r.changes.notice_days} ngày` : null,
              r.changes.terms_note ? 'điều khoản khác' : null,
            ]
              .filter(Boolean)
              .join(', ')}
            <span className="text-slate-500">
              {' '}
              — {r.reason}
              {r.created_by_name ? ` (${r.created_by_name})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
