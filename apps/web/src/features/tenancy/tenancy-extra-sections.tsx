'use client';

import type { TenancyDetail } from '@ql-tro/shared';
import { TenancyInvoicesSection } from '@/features/billing/tenancy-invoices-section';
import { ContractsSection } from '@/features/contracts/contracts-section';
import { MoveOutHeaderActions, MoveOutSection } from '@/features/move-out/move-out-section';
import { StatementSection } from '@/features/payments/statement-section';
import { TenancyServicesSection } from '@/features/utilities/tenancy-services-section';

/** Các mục của trang lần thuê bổ sung theo phase: hợp đồng (3), dịch vụ/chỉ số (4), thông báo (5), thu tiền (6), trả phòng (7). */
export function TenancyExtraSections({ tenancy }: { tenancy: TenancyDetail }) {
  return (
    <>
      <MoveOutSection tenancy={tenancy} />
      <TenancyInvoicesSection tenancy={tenancy} />
      <StatementSection tenancy={tenancy} />
      <ContractsSection tenancy={tenancy} />
      <TenancyServicesSection tenancy={tenancy} />
    </>
  );
}

/** Nút thao tác ở đầu trang lần thuê: báo trả, hủy báo trả, trả phòng (Phase 7). */
export function TenancyHeaderActions({ tenancy }: { tenancy: TenancyDetail }) {
  return <MoveOutHeaderActions tenancy={tenancy} />;
}
