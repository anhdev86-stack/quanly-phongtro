'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { ErrorState, LoadingState } from '@/components/common/states';
import { useMe } from '@/features/auth/api';
import { ApiError } from '@/lib/api-client';

/** Trang in chứng từ: cần đăng nhập nhưng không có khung ứng dụng (sidebar), nền trắng để In → Lưu PDF. */
export default function PrintLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);
  if (me.isPending || unauthenticated) return <LoadingState />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  return <div className="min-h-screen bg-slate-100 print:bg-white">{children}</div>;
}
