'use client';

import type { TenancyDetail } from '@ql-tro/shared';
import { ContractsSection } from '@/features/contracts/contracts-section';
import { TenancyServicesSection } from '@/features/utilities/tenancy-services-section';

/** Các mục của trang lần thuê bổ sung theo phase: hợp đồng (3), dịch vụ/chỉ số (4), thông báo (5), thu tiền (6), trả phòng (7). */
export function TenancyExtraSections({ tenancy }: { tenancy: TenancyDetail }) {
  return (
    <>
      <ContractsSection tenancy={tenancy} />
      <TenancyServicesSection tenancy={tenancy} />
    </>
  );
}

/** Nút thao tác ở đầu trang lần thuê (báo trả, trả phòng… từ Phase 7). */
export function TenancyHeaderActions(_props: { tenancy: TenancyDetail }) {
  return null;
}
