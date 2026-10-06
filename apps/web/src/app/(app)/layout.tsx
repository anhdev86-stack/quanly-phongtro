'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { ErrorState, LoadingState } from '@/components/common/states';
import { AppShell } from '@/components/layout/app-shell';
import { useMe } from '@/features/auth/api';
import { ApiError } from '@/lib/api-client';

/** Khu vực cần đăng nhập. Phiên được xác minh bằng /auth/me (cookie HttpOnly, web không đọc token). */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);

  if (me.isPending || unauthenticated) return <LoadingState label="Đang kiểm tra phiên đăng nhập…" />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  return <AppShell me={me.data}>{children}</AppShell>;
}
