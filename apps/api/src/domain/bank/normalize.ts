/**
 * Giao dịch ngân hàng đã chuẩn hóa, độc lập nhà cung cấp (D-047). Mỗi adapter tự đọc payload của mình về dạng này;
 * không giả định mọi nhà cung cấp có cùng trường, cùng cách xác thực hay cùng cách đánh số giao dịch.
 */
export interface NormalizedBankTransaction {
  /** Mã giao dịch phía nhà cung cấp — khóa chống trùng cùng provider/môi trường/tài khoản. */
  providerTransactionId: string;
  accountNumber: string;
  direction: 'IN' | 'OUT';
  amountVnd: bigint;
  currency: string;
  content: string;
  /** Mã thanh toán nhà cung cấp tự nhận diện (nếu có) — chỉ là gợi ý, vẫn dò lại trong nội dung. */
  providerCode: string | null;
  referenceCode: string | null;
  occurredAt: Date;
}

export type PreCheckResult = { kind: 'skip'; status: 'NOT_APPLICABLE' | 'PENDING_REVIEW'; reason: string } | { kind: 'code'; code: string };

/**
 * Kiểm tra trước khi tìm thông báo: chỉ tự ghi nhận tiền VÀO, đúng loại tiền, đúng tài khoản nhận và có đúng MỘT mã thanh toán.
 * Không bao giờ đoán thông báo chỉ dựa vào số tiền.
 */
export function preCheck(t: Pick<NormalizedBankTransaction, 'direction' | 'currency' | 'accountNumber'>, activeAccount: string | null, codes: string[]): PreCheckResult {
  if (t.direction !== 'IN') return { kind: 'skip', status: 'NOT_APPLICABLE', reason: 'Giao dịch tiền ra — không phải khách thanh toán.' };
  if (t.currency.toUpperCase() !== 'VND') return { kind: 'skip', status: 'NOT_APPLICABLE', reason: `Loại tiền ${t.currency} không được hỗ trợ (chỉ VND).` };
  if (!activeAccount) return { kind: 'skip', status: 'PENDING_REVIEW', reason: 'Chưa cấu hình tài khoản nhận tiền — không đối chiếu tự động.' };
  if (normalizeAccount(t.accountNumber) !== normalizeAccount(activeAccount)) {
    return { kind: 'skip', status: 'PENDING_REVIEW', reason: `Tiền vào tài khoản ${t.accountNumber}, không phải tài khoản nhận tiền đang dùng.` };
  }
  if (codes.length === 0) return { kind: 'skip', status: 'PENDING_REVIEW', reason: 'Không tìm thấy mã thanh toán trong nội dung chuyển khoản.' };
  if (codes.length > 1) return { kind: 'skip', status: 'PENDING_REVIEW', reason: `Nội dung có nhiều mã thanh toán (${codes.join(', ')}) — cần chọn thông báo.` };
  return { kind: 'code', code: codes[0]! };
}

export const normalizeAccount = (s: string) => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
