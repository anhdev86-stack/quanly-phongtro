'use client';

import type { Building } from '@ql-tro/shared';
import { MeterPricesSection } from '@/features/utilities/meter-prices-section';

/** Các mục bổ sung của trang tòa theo phase (Phase 4: giá điện nước theo tòa). */
export function BuildingExtraSections({ building }: { building: Building }) {
  return <MeterPricesSection buildingId={building.id} />;
}
