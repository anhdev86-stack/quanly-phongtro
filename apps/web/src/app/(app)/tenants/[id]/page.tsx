'use client';

import { GENDER_LABELS, PERMISSIONS } from '@ql-tro/shared';
import { AlertTriangle, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DescriptionList, PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCan } from '@/features/auth/permissions';
import { ReminderConsentSection } from '@/features/reminders/consent-section';
import { useTenancies, useTenant } from '@/features/tenancy/api';
import { TenancyTable } from '@/features/tenancy/tenancy-table';
import { TenantDialog } from '@/features/tenancy/tenant-dialog';
import { Attachments } from '@/features/files/attachments';
import { formatBusinessDate } from '@/lib/format';

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const tenant = useTenant(id);
  const tenancies = useTenancies({ tenant_id: id, page: 1, page_size: 50 });
  const [editing, setEditing] = useState(false);

  if (tenant.isPending) return <LoadingState />;
  if (tenant.isError) return <ErrorState error={tenant.error} onRetry={() => void tenant.refetch()} />;
  const t = tenant.data;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        back={{ href: '/tenants', label: 'Người thuê' }}
        title={t.full_name}
        description={t.current_room ? `Đang ở ${t.current_room}` : 'Hiện không thuê phòng nào'}
        actions={
          can(PERMISSIONS.TENANTS_MANAGE) ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Sửa
            </Button>
          ) : null
        }
      />
      {t.duplicate_identity.length ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Số CCCD trùng với:{' '}
            {t.duplicate_identity.map((d, i) => (
              <span key={d.id}>
                {i ? ', ' : ''}
                <Link href={`/tenants/${d.id}`} className="underline">
                  {d.full_name}
                </Link>
              </span>
            ))}
            . Hãy xác minh có phải cùng một người.
          </span>
        </p>
      ) : null}
      <Card>
        <CardContent>
          <DescriptionList
            items={[
              { label: 'Số điện thoại', value: t.phone },
              { label: 'Email', value: t.email },
              { label: 'Ngày sinh', value: t.birth_date ? formatBusinessDate(t.birth_date) : null },
              { label: 'Giới tính', value: t.gender ? GENDER_LABELS[t.gender] : null },
              { label: 'Số CCCD', value: t.identity_number },
              { label: 'Ngày cấp / nơi cấp', value: t.identity_masked ? 'Không có quyền xem' : [t.issue_date && formatBusinessDate(t.issue_date), t.issue_place].filter(Boolean).join(' · ') || null },
              { label: 'Địa chỉ thường trú', value: t.identity_masked ? 'Không có quyền xem' : t.permanent_address },
              { label: 'Quê quán', value: t.hometown },
              { label: 'Ghi chú', value: t.note },
            ]}
          />
        </CardContent>
      </Card>
      <ReminderConsentSection tenant={t} canManage={can(PERMISSIONS.TENANTS_MANAGE)} />
      <Card>
        <CardHeader>
          <CardTitle>Lịch sử thuê</CardTitle>
        </CardHeader>
        {tenancies.isPending ? (
          <LoadingState />
        ) : tenancies.data?.items.length ? (
          <TenancyTable items={tenancies.data.items} />
        ) : (
          <EmptyState title="Chưa có lần thuê" />
        )}
      </Card>
      <Attachments
        ownerType="tenant"
        ownerId={t.id}
        title="Giấy tờ, tệp đính kèm"
        categories={can(PERMISSIONS.FILES_IDENTITY_VIEW) ? ['IDENTITY', 'OTHER'] : ['OTHER']}
        canManage={can(PERMISSIONS.TENANTS_MANAGE)}
      />
      <TenantDialog open={editing} onClose={() => setEditing(false)} tenant={t} />
    </div>
  );
}
