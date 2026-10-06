import { addDays, type DateOnly } from '../dates/date-only.js';

/**
 * Lập lịch nhắc đóng tiền (MASTER_PLAN 9.7) — hàm thuần. Giờ Việt Nam cố định UTC+7 (không có giờ mùa hè).
 */
export const VN_OFFSET_HOURS = 7;

export type Milestone = 'BEFORE_DUE' | 'DUE' | 'OVERDUE';

export const milestoneOf = (offsetDays: number): Milestone => (offsetDays < 0 ? 'BEFORE_DUE' : offsetDays === 0 ? 'DUE' : 'OVERDUE');

/** Mốc hợp lệ: tối đa ba mốc, mỗi loại (trước hạn / đúng hạn / quá hạn) tối đa một — khớp unique (invoice, milestone). */
export function validateOffsets(offsets: number[]): string | null {
  if (!offsets.length) return 'Cần ít nhất một mốc nhắc.';
  if (offsets.length > 3) return 'Tối đa 3 mốc nhắc cho mỗi thông báo.';
  const kinds = offsets.map(milestoneOf);
  if (new Set(kinds).size !== kinds.length) return 'Mỗi loại mốc (trước hạn, đúng hạn, quá hạn) chỉ được một.';
  if (offsets.some((o) => o < -15 || o > 30)) return 'Mốc nằm trong khoảng 15 ngày trước hạn đến 30 ngày sau hạn.';
  return null;
}

/** Thời điểm gửi (UTC) của mốc: ngày (hạn + offset) lúc `sendHour` giờ Việt Nam. */
export function scheduledAt(dueDate: DateOnly, offsetDays: number, sendHour: number): Date {
  const day = addDays(dueDate, offsetDays);
  return new Date(Date.parse(`${day}T00:00:00Z`) + (sendHour - VN_OFFSET_HOURS) * 3_600_000);
}

export const localHour = (now: Date): number => (now.getUTCHours() + VN_OFFSET_HOURS) % 24;

/** Giờ yên lặng [start, end) có thể vắt qua nửa đêm (VD 21 → 7). start = end nghĩa là không có giờ yên lặng. */
export function isQuietHour(hour: number, quietStart: number, quietEnd: number): boolean {
  if (quietStart === quietEnd) return false;
  return quietStart < quietEnd ? hour >= quietStart && hour < quietEnd : hour >= quietStart || hour < quietEnd;
}

/** Số di động Việt Nam: 0/+84 + đầu 3/5/7/8/9 + 8 số. Trả dạng 0xxxxxxxxx hoặc null. */
export function normalizeVnMobile(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[\s.-]/g, '');
  const m = /^(?:\+?84|0)([35789]\d{8})$/.exec(digits);
  return m ? `0${m[1]}` : null;
}

/** Che số điện thoại: giữ 2 số đầu và 2 số cuối (09******89). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const d = phone.replace(/\D/g, '');
  if (d.length < 5) return '*'.repeat(d.length);
  return `${d.slice(0, 2)}${'*'.repeat(d.length - 4)}${d.slice(-2)}`;
}

/** Che mọi chuỗi giống số điện thoại trong văn bản lỗi/log (không để lộ số người thuê). */
export const maskPhonesIn = (text: string): string => text.replace(/(?:\+?84|0)\d{8,10}/g, (m) => maskPhone(m));

/** Lỗi tạm thời thử lại tối đa 3 lần, giãn cách 5, 15, 45 phút. */
export const MAX_ATTEMPTS = 3;
export const backoffMinutes = (attempt: number): number => 5 * 3 ** Math.max(0, attempt - 1);

export interface ReminderContent {
  workspace_name: string;
  room_code: string;
  period: string | null;
  invoice_number: string;
  remaining_vnd: string;
  due_date: DateOnly;
  milestone: Milestone;
}

const vnd = (v: string) => `${v.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
const dmy = (d: DateOnly) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Nội dung tin (MASTER_PLAN 9.7 bước 5). Mẫu thật phải khớp mẫu đã đăng ký với nhà cung cấp (N-5). */
export function renderReminder(c: ReminderContent, link: string): string {
  const when = c.milestone === 'BEFORE_DUE' ? `sắp đến hạn ${dmy(c.due_date)}` : c.milestone === 'DUE' ? `đến hạn hôm nay ${dmy(c.due_date)}` : `đã quá hạn ${dmy(c.due_date)}`;
  const month = c.period ? ` tháng ${c.period.slice(5)}/${c.period.slice(0, 4)}` : '';
  return `${c.workspace_name}: Phòng ${c.room_code} - thông báo ${c.invoice_number}${month} còn ${vnd(c.remaining_vnd)}, ${when}. Xem và quét QR: ${link}`;
}
