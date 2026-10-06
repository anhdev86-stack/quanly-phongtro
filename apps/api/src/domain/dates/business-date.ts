/**
 * Ngày nghiệp vụ (YYYY-MM-DD) tại múi giờ nghiệp vụ cho một thời điểm UTC.
 * Hàm thuần: không đọc đồng hồ hệ thống, không phụ thuộc múi giờ của máy chạy.
 */
export function toBusinessDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) {
    throw new Error(`Không xác định được ngày nghiệp vụ cho múi giờ ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}
