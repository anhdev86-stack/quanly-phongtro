import { addDays, type DateOnly } from '../dates/date-only.js';

export type ContractLifecycle = 'DRAFT' | 'SIGNED' | 'CANCELLED';
export type ContractStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED_EARLY' | 'CANCELLED';

export interface ContractDates {
  lifecycle: ContractLifecycle;
  termStart: DateOnly;
  termEnd: DateOnly;
  terminatedOn: DateOnly | null;
}

/**
 * Trạng thái hiển thị của hợp đồng, luôn suy ra từ ngày (MASTER_PLAN 5.3). Không cần cron.
 * Cùng logic với hàm SQL contract_effective_status (T05 kiểm tra trùng khớp).
 */
export function contractStatus(c: ContractDates, onDate: DateOnly): ContractStatus {
  if (c.lifecycle === 'CANCELLED') return 'CANCELLED';
  if (c.lifecycle === 'DRAFT') return 'DRAFT';
  if (c.terminatedOn) return 'TERMINATED_EARLY';
  if (onDate < c.termStart) return 'SCHEDULED';
  if (onDate <= c.termEnd) return 'ACTIVE';
  return 'EXPIRED';
}

/** Hợp đồng SIGNED có hiệu lực (bao phủ) tại ngày đang xét. */
export function coversDate(c: ContractDates, onDate: DateOnly): boolean {
  if (c.lifecycle !== 'SIGNED') return false;
  if (onDate < c.termStart || onDate > c.termEnd) return false;
  // Kết thúc sớm: hợp đồng ngừng bao phủ từ ngày terminated_on trở đi.
  return !c.terminatedOn || onDate < c.terminatedOn;
}

/** FIXED_TERM nếu có hợp đồng đã ký bao phủ ngày đang xét, ngược lại MONTH_TO_MONTH (MASTER_PLAN 5.2). */
export function rentalMode(contracts: readonly ContractDates[], onDate: DateOnly): 'FIXED_TERM' | 'MONTH_TO_MONTH' {
  return contracts.some((c) => coversDate(c, onDate)) ? 'FIXED_TERM' : 'MONTH_TO_MONTH';
}

/** Hợp đồng SIGNED gần nhất đã bắt đầu tính tới ngày đang xét (dùng cho mức cọc yêu cầu hiện hành). */
export function latestStartedSigned<T extends ContractDates>(contracts: readonly T[], onDate: DateOnly): T | null {
  return (
    contracts
      .filter((c) => c.lifecycle === 'SIGNED' && c.termStart <= onDate)
      .sort((a, b) => (a.termStart < b.termStart ? -1 : 1))
      .at(-1) ?? null
  );
}

/** Ngày bắt đầu mặc định của kỳ gia hạn: ngày sau kỳ SIGNED cuối cùng (MASTER_PLAN 5.3). */
export function defaultRenewalStart(contracts: readonly ContractDates[], fallback: DateOnly): DateOnly {
  const lastEnd = contracts
    .filter((c) => c.lifecycle === 'SIGNED' && !c.terminatedOn)
    .map((c) => c.termEnd)
    .sort()
    .at(-1);
  return lastEnd ? addDays(lastEnd, 1) : fallback;
}

/** Số ngày từ hôm nay tới ngày hết hạn (âm nếu đã hết hạn). */
export function daysUntil(onDate: DateOnly, termEnd: DateOnly): number {
  return Math.round((Date.parse(`${termEnd}T00:00:00Z`) - Date.parse(`${onDate}T00:00:00Z`)) / 86_400_000);
}
