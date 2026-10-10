'use client';

import { PERMISSIONS, type Building } from '@ql-tro/shared';
import { Archive, ArchiveRestore, Building2, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/permissions';
import { useArchiveBuilding, useBuildings } from '@/features/property/api';
import { BuildingPriceSummary } from '@/features/utilities/meter-prices-section';
import { BuildingFormDialog } from '@/features/property/building-form';
import { PropertyTabs } from '@/features/property/property-tabs';
import { ApiError } from '@/lib/api-client';

export default function BuildingsPage() {
  const can = useCan();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const buildings = useBuildings(showArchived);
  const archive = useArchiveBuilding();
  const [editing, setEditing] = useState<Building | null>(null);
  const [creating, setCreating] = useState(false);
  const canManage = can(PERMISSIONS.BUILDINGS_MANAGE);

  const toggleArchive = async (b: Building) => {
    try {
      await archive.mutateAsync({ id: b.id, archive: !b.archived_at, expected_version: b.version });
      toast.success(b.archived_at ? `Đã bỏ lưu trữ tòa ${b.code}.` : `Đã lưu trữ tòa ${b.code}.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Không thực hiện được.');
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PropertyTabs active="buildings" />
      <PageHeader
        title="Tòa/khu"
        description="Danh sách tòa trong phạm vi của bạn."
        actions={
          <>
            <Button variant="outline" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Ẩn tòa đã lưu trữ' : 'Hiện tòa đã lưu trữ'}
            </Button>
            {canManage ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                Thêm tòa
              </Button>
            ) : null}
          </>
        }
      />
      <Card>
        {buildings.isPending ? (
          <LoadingState />
        ) : buildings.isError ? (
          <ErrorState error={buildings.error} onRetry={() => void buildings.refetch()} />
        ) : buildings.data.length === 0 ? (
          <EmptyState title="Chưa có tòa nào">{canManage ? <p>Bấm “Thêm tòa” để bắt đầu.</p> : null}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Mã</Th>
                <Th>Tên</Th>
                <Th className="hidden md:table-cell">Địa chỉ</Th>
                <Th className="text-right">Số phòng</Th>
                <Th className="hidden md:table-cell">Giá điện · nước</Th>
                <Th className="hidden sm:table-cell">Quản lý</Th>
                <Th className="hidden sm:table-cell">Liên hệ</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {buildings.data.map((b) => (
                <Tr key={b.id}>
                  <Td className="font-semibold">
                    <Link href={`/buildings/${b.id}`} className="inline-flex items-center gap-2 text-brand-800 hover:underline">
                      <Building2 className="size-4" aria-hidden />
                      {b.code}
                    </Link>
                  </Td>
                  <Td>
                    {b.name} {b.archived_at ? <Badge tone="gray">Đã lưu trữ</Badge> : null}
                  </Td>
                  <Td className="hidden text-slate-600 md:table-cell">{b.address ?? '—'}</Td>
                  <Td className="text-right tabular">{b.room_count}</Td>
                  <Td className="hidden whitespace-nowrap text-sm md:table-cell">
                    <BuildingPriceSummary buildingId={b.id} code={b.code} />
                  </Td>
                  <Td className="hidden text-sm sm:table-cell" data-testid={`building-managers-${b.code}`}>
                    {b.managers.length ? b.managers.map((m) => m.display_name).join(', ') : <span className="text-amber-800">Chưa giao</span>}
                  </Td>
                  <Td className="hidden text-slate-600 sm:table-cell">{[b.contact_name, b.contact_phone].filter(Boolean).join(' · ') || '—'}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {canManage ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(b)} aria-label={`Sửa tòa ${b.code}`}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={archive.isPending}
                          onClick={() => void toggleArchive(b)}
                          aria-label={b.archived_at ? `Bỏ lưu trữ tòa ${b.code}` : `Lưu trữ tòa ${b.code}`}
                        >
                          {b.archived_at ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                        </Button>
                      </>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <BuildingFormDialog open={creating} onClose={() => setCreating(false)} />
      <BuildingFormDialog open={!!editing} onClose={() => setEditing(null)} building={editing ?? undefined} />
    </div>
  );
}
