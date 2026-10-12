import type { NormalizedBankTransaction } from './normalize.js';

/**
 * Định dạng SePay (docs.sepay.vn — “Tích hợp Webhooks”, “API giao dịch”). Mock dùng đúng định dạng này để khi bật thật chỉ đổi cấu hình.
 * Webhook: `id`, `gateway`, `transactionDate` ("YYYY-MM-DD HH:mm:ss", giờ Việt Nam), `accountNumber`, `subAccount`, `code`, `content`,
 * `transferType` ("in"/"out"), `transferAmount`, `accumulated`, `referenceCode`, `description`. Chống trùng theo `id`.
 * API danh sách: `id`, `account_number`, `transaction_date`, `amount_in`, `amount_out`, `transaction_content`, `reference_number`, `code`.
 * Chưa xác minh với tài khoản SePay thật — các trường trên lấy theo tài liệu công khai.
 */
export interface SepayWebhookPayload {
  id: number | string;
  gateway?: string | null;
  transactionDate: string;
  accountNumber: string;
  subAccount?: string | null;
  code?: string | null;
  content?: string | null;
  transferType: 'in' | 'out' | string;
  transferAmount: number | string;
  accumulated?: number | string | null;
  referenceCode?: string | null;
  description?: string | null;
}

export class BankPayloadError extends Error {}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** "2024-07-02 11:08:33" (giờ Việt Nam, UTC+7, không có múi giờ trong chuỗi) → Date. */
export function parseVnDateTime(s: string): Date {
  const m = DATE_RE.exec(s.trim());
  if (!m) throw new BankPayloadError(`Thời gian giao dịch không đúng định dạng: ${s}`);
  const [, y, mo, d, h, mi, se] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se ?? '00'}+07:00`);
  if (Number.isNaN(date.getTime())) throw new BankPayloadError(`Thời gian giao dịch không hợp lệ: ${s}`);
  return date;
}

function amountOf(v: unknown, field: string): bigint {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : '') : typeof v === 'string' ? v.trim() : '';
  if (!/^\d{1,15}$/.test(s)) throw new BankPayloadError(`Số tiền ${field} không hợp lệ.`);
  return BigInt(s);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

export function parseSepayWebhook(body: unknown): NormalizedBankTransaction {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BankPayloadError('Payload không phải object JSON.');
  const b = body as Record<string, unknown>;
  const id = str(b.id);
  if (!id || !/^[0-9A-Za-z_-]{1,64}$/.test(id)) throw new BankPayloadError('Thiếu hoặc sai mã giao dịch (id).');
  const account = str(b.accountNumber);
  if (!account) throw new BankPayloadError('Thiếu số tài khoản (accountNumber).');
  const type = str(b.transferType)?.toLowerCase();
  if (type !== 'in' && type !== 'out') throw new BankPayloadError('transferType phải là "in" hoặc "out".');
  if (typeof b.transactionDate !== 'string') throw new BankPayloadError('Thiếu thời gian giao dịch (transactionDate).');
  const amount = amountOf(b.transferAmount, 'transferAmount');
  if (amount <= 0n) throw new BankPayloadError('Số tiền phải dương.');
  return {
    providerTransactionId: id,
    accountNumber: account,
    direction: type === 'in' ? 'IN' : 'OUT',
    amountVnd: amount,
    // SePay chỉ hỗ trợ tài khoản VND; payload không có trường loại tiền.
    currency: 'VND',
    content: (str(b.content) ?? '').slice(0, 500),
    providerCode: str(b.code),
    referenceCode: str(b.referenceCode),
    occurredAt: parseVnDateTime(b.transactionDate),
  };
}

/** Một dòng của `GET /userapi/transactions/list`. */
export function parseSepayListItem(item: unknown): NormalizedBankTransaction & { numericId: bigint | null } {
  if (!item || typeof item !== 'object') throw new BankPayloadError('Dòng giao dịch không hợp lệ.');
  const b = item as Record<string, unknown>;
  const id = str(b.id);
  if (!id) throw new BankPayloadError('Thiếu id giao dịch.');
  const amountIn = b.amount_in == null ? 0n : amountOf(String(b.amount_in).replace(/\.0+$/, ''), 'amount_in');
  const amountOut = b.amount_out == null ? 0n : amountOf(String(b.amount_out).replace(/\.0+$/, ''), 'amount_out');
  const account = str(b.account_number);
  if (!account) throw new BankPayloadError('Thiếu account_number.');
  if (typeof b.transaction_date !== 'string') throw new BankPayloadError('Thiếu transaction_date.');
  return {
    providerTransactionId: id,
    numericId: /^\d+$/.test(id) ? BigInt(id) : null,
    accountNumber: account,
    direction: amountIn > 0n ? 'IN' : 'OUT',
    amountVnd: amountIn > 0n ? amountIn : amountOut,
    currency: 'VND',
    content: (str(b.transaction_content) ?? '').slice(0, 500),
    providerCode: str(b.code),
    referenceCode: str(b.reference_number),
    occurredAt: parseVnDateTime(b.transaction_date),
  };
}

/** Phản hồi SePay coi là thành công: HTTP 200/201 + `{"success": true}` trong 30 giây. */
export const SEPAY_ACK = { success: true } as const;
