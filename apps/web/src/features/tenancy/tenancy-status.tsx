import { TENANCY_STATUS_LABELS } from '@ql-tro/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';

const TONES: Record<keyof typeof TENANCY_STATUS_LABELS, BadgeTone> = {
  ACTIVE: 'green',
  NOTICE_GIVEN: 'amber',
  MOVE_OUT_PROCESSING: 'violet',
  ENDED: 'gray',
};

export function TenancyStatusBadge({ status }: { status: keyof typeof TENANCY_STATUS_LABELS }) {
  return <Badge tone={TONES[status]}>{TENANCY_STATUS_LABELS[status]}</Badge>;
}

export function RentalModeBadge({ mode }: { mode: 'FIXED_TERM' | 'MONTH_TO_MONTH' }) {
  return mode === 'FIXED_TERM' ? <Badge tone="blue">Có hợp đồng</Badge> : <Badge tone="gray">Thuê theo tháng</Badge>;
}
