import { AlertTriangle, Inbox, Loader2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

/** Trạng thái bắt buộc cho mọi màn hình dữ liệu (MASTER_PLAN chỉ thị 10). */
export function LoadingState({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-slate-500">
      <Inbox className="size-6 text-slate-400" aria-hidden />
      <p className="font-medium text-slate-700">{title}</p>
      {children}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const isForbidden = error instanceof ApiError && error.status === 403;
  const message = error instanceof ApiError ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.';
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  const Icon = isForbidden ? Lock : AlertTriangle;
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 py-10 text-center text-sm">
      <Icon className={isForbidden ? 'size-6 text-slate-500' : 'size-6 text-red-500'} aria-hidden />
      <p className="max-w-md text-slate-700">{message}</p>
      {requestId ? <p className="text-xs text-slate-400">Mã yêu cầu: {requestId}</p> : null}
      {onRetry && !isForbidden ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}
