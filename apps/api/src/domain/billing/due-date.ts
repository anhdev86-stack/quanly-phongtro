import { addDays, type DateOnly } from '../dates/date-only.js';

/** Số ngày cho khách đóng tiền khi thông báo được lập/phát hành sau hạn theo lịch (D-044). */
export const LATE_ISSUE_GRACE_DAYS = 7;

/**
 * Hạn thanh toán của thông báo tháng. `scheduled`: hạn theo lịch (thông báo đầu tiên = ngày nhận phòng, các tháng sau = ngày đến hạn
 * hằng tháng của lần thuê). Nếu đến ngày lập/phát hành mà hạn đó đã qua thì hạn = ngày phát hành + 7 ngày, để thông báo không
 * “Quá hạn” ngay khi gửi khách. Còn trong hạn thì giữ nguyên.
 */
export function effectiveDueDate(scheduled: DateOnly, issuedOn: DateOnly): DateOnly {
  return scheduled < issuedOn ? addDays(issuedOn, LATE_ISSUE_GRACE_DAYS) : scheduled;
}
