'use client';

import { Building2, ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/features/auth/api';

/**
 * Tổng quan — Phase 0 chỉ hiển thị thông tin phiên và phạm vi tòa, đọc từ API thật.
 * Chỉ số phòng, công nợ, việc cần xử lý được bổ sung ở Phase 8A.
 */
export default function DashboardPage() {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Xin chào, {me.display_name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {me.workspace.name} · múi giờ {me.workspace.timezone}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Building2 className="size-4 text-brand-700" aria-hidden />
            <CardTitle>Tòa trong phạm vi của bạn</CardTitle>
          </CardHeader>
          <CardContent>
            {me.buildings.length === 0 ? (
              <EmptyState title="Bạn chưa được giao tòa nào">
                <p>Liên hệ chủ trọ để được giao phạm vi.</p>
              </EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="building-list">
                {me.buildings.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="flex size-7 items-center justify-center rounded bg-brand-50 font-semibold text-brand-800">
                      {b.code}
                    </span>
                    {b.name}
                  </li>
                ))}
              </ul>
            )}
            {me.all_buildings ? <p className="mt-3 text-xs text-slate-500">Bạn có quyền xem toàn bộ tòa trong nhà trọ.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-brand-700" aria-hidden />
            <CardTitle>Quyền của bạn</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Vai trò: <span className="font-medium text-slate-900">{me.roles.join(', ')}</span>
            </p>
            <p className="mt-1 text-sm text-slate-600">{me.permissions.length} quyền được cấp.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
