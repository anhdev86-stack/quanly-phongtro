import { RESERVATION_STATUS_LABELS, ROOM_STATUS_LABELS, type RoomDisplayStatus } from '@ql-tro/shared';
import { Wrench } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';

const ROOM_TONES: Record<RoomDisplayStatus, BadgeTone> = {
  OCCUPIED: 'blue',
  MAINTENANCE: 'amber',
  RESERVED: 'violet',
  AVAILABLE: 'green',
};

export function RoomStatusBadge({ status, maintenance }: { status: RoomDisplayStatus; maintenance?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={ROOM_TONES[status]}>{ROOM_STATUS_LABELS[status]}</Badge>
      {maintenance ? (
        <Badge tone="amber">
          <Wrench className="size-3" aria-hidden />
          Bảo trì
        </Badge>
      ) : null}
    </span>
  );
}

const RES_TONES: Record<keyof typeof RESERVATION_STATUS_LABELS, BadgeTone> = {
  ACTIVE: 'violet',
  EXPIRED: 'amber',
  CONVERTED: 'green',
  CANCELLED: 'gray',
};

export function ReservationStatusBadge({ status }: { status: keyof typeof RESERVATION_STATUS_LABELS }) {
  return <Badge tone={RES_TONES[status]}>{RESERVATION_STATUS_LABELS[status]}</Badge>;
}
