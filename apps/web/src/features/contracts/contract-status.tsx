import { CONTRACT_STATUS_LABELS, type ContractStatus } from '@ql-tro/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';

const TONES: Record<ContractStatus, BadgeTone> = {
  DRAFT: 'gray',
  SCHEDULED: 'violet',
  ACTIVE: 'green',
  EXPIRED: 'amber',
  TERMINATED_EARLY: 'gray',
  CANCELLED: 'red',
};

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={TONES[status]}>{CONTRACT_STATUS_LABELS[status]}</Badge>;
}

/** "còn 12 ngày" / "hết hạn hôm nay" / "đã hết 3 ngày". */
export function expiryText(days: number | null): string {
  if (days === null) return '';
  if (days > 0) return `còn ${days} ngày`;
  if (days === 0) return 'hết hạn hôm nay';
  return `đã hết ${-days} ngày`;
}
