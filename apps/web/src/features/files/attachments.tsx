'use client';

import { FILE_CATEGORY_LABELS, FILE_MAX_BYTES, type FileCategory, type FileDto, type FileOwnerType } from '@ql-tro/shared';
import { useQuery } from '@tanstack/react-query';
import { FileText, Image as ImageIcon, Paperclip, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ReasonDialog } from '@/features/property/reservation-forms';
import { ApiError, api } from '@/lib/api-client';
import { useApiMutation } from '@/lib/query';

const key = (type: FileOwnerType, id: string) => ['files', type, id] as const;
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Tệp riêng tư của một đối tượng (V1.1): tải lên ảnh/PDF ≤ 10 MB, mở bằng link kiểm tra quyền, lưu trữ (ẩn) có lý do.
 * Ảnh giấy tờ tùy thân chỉ người có quyền mới thấy; API ẩn hẳn khỏi danh sách với người khác.
 */
export function Attachments({ ownerType, ownerId, categories, canManage, title = 'Tệp đính kèm' }: { ownerType: FileOwnerType; ownerId: string; categories: FileCategory[]; canManage: boolean; title?: string }) {
  const toast = useToast();
  const list = useQuery({ queryKey: key(ownerType, ownerId), queryFn: ({ signal }) => api<FileDto[]>(`/files?owner_type=${ownerType}&owner_id=${ownerId}`, { signal }) });
  const upload = useApiMutation<FormData, FileDto>((form) => ({ path: '/files', method: 'POST', form }), [key(ownerType, ownerId)]);
  const archive = useApiMutation<{ id: string; reason: string }, FileDto>(({ id, reason }) => ({ path: `/files/${id}/archive`, method: 'POST', body: { reason } }), [key(ownerType, ownerId)]);
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<FileCategory>(categories[0]!);
  const [error, setError] = useState('');
  const [archiving, setArchiving] = useState<FileDto | null>(null);

  const onPick = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) return setError('Tệp tối đa 10 MB.');
    const form = new FormData();
    form.append('owner_type', ownerType);
    form.append('owner_id', ownerId);
    form.append('category', category);
    form.append('file', file);
    try {
      await upload.mutateAsync(form);
      toast.success(`Đã tải lên ${file.name}.`);
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors?.file?.[0] ?? e.message) : 'Không tải lên được.');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card data-testid={`attachments-${ownerType}`}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="size-4" aria-hidden />
          {title}
        </CardTitle>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {categories.length > 1 ? (
              <Select aria-label="Loại tệp" className="w-48" value={category} onChange={(e) => setCategory(e.target.value as FileCategory)}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {FILE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            ) : null}
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="Chọn tệp tải lên" onChange={(e) => void onPick(e.target.files?.[0])} />
            <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
              <Upload className="size-4" aria-hidden />
              {upload.isPending ? 'Đang tải…' : 'Tải lên'}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <FormError message={error} />
        {list.data?.length ? (
          <ul className="flex flex-col divide-y divide-slate-100 text-sm">
            {list.data.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 font-medium text-brand-600 hover:underline">
                  {f.mime === 'application/pdf' ? <FileText className="size-4 shrink-0" aria-hidden /> : <ImageIcon className="size-4 shrink-0" aria-hidden />}
                  <span className="truncate">{f.original_name}</span>
                </a>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {FILE_CATEGORY_LABELS[f.category]} · {size(f.size_bytes)} · {f.uploaded_by_name ?? ''}
                  {canManage ? (
                    <Button size="sm" variant="ghost" onClick={() => setArchiving(f)}>
                      Lưu trữ
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{list.isPending ? 'Đang tải…' : 'Chưa có tệp.'}</p>
        )}
        <p className="text-xs text-slate-500">Ảnh JPG/PNG/WEBP hoặc PDF, tối đa 10 MB. Tệp chỉ mở được khi đăng nhập và có quyền.</p>
      </CardContent>
      <ReasonDialog
        open={!!archiving}
        title={`Lưu trữ ${archiving?.original_name ?? ''}`}
        description="Tệp được ẩn khỏi danh sách và không mở được nữa, nhưng không bị xóa khỏi bản sao lưu. Lý do được ghi nhật ký."
        confirmLabel="Lưu trữ tệp"
        pending={archive.isPending}
        onClose={() => setArchiving(null)}
        onConfirm={async (reason) => {
          if (!archiving) return;
          try {
            await archive.mutateAsync({ id: archiving.id, reason });
            toast.success('Đã lưu trữ tệp.');
            setArchiving(null);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Không lưu trữ được.');
          }
        }}
      />
    </Card>
  );
}
