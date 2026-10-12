/**
 * Mã thanh toán của thông báo (D-047) = số thông báo bỏ gạch, chữ hoa: `TB-202609-0001` → `TB2026090001`.
 * Duy nhất (số thông báo unique trong nhà trọ), ổn định (cấp lúc phát hành, không đổi), 12–13 ký tự — nằm gọn trong nội dung
 * chuyển khoản ≤ 25 ký tự (`<mã> <phòng>`) và hợp với cấu hình “tiền tố + hậu tố” mã thanh toán của SePay (tiền tố TB/TT/DCT, hậu tố 10 số).
 * Chỉ thông báo loại nợ có mã: MONTHLY (TB), FINAL (TT), DEBIT_ADJUSTMENT (DCT). Chứng từ credit (DCG) không nhận tiền.
 */
const PREFIXES = ['DCT', 'TB', 'TT'] as const;
const CODE_RE = /(DCT|TB|TT)(20\d{2}(?:0[1-9]|1[0-2])\d{4})/g;
const CODE_EXACT_RE = /^(DCT|TB|TT)(\d{6})(\d{4})$/;

export function paymentCodeOf(invoiceNumber: string): string | null {
  const code = invoiceNumber.replace(/-/g, '').toUpperCase();
  return CODE_EXACT_RE.test(code) ? code : null;
}

export function invoiceNumberOf(code: string): string | null {
  const m = CODE_EXACT_RE.exec(code);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Tìm mã thanh toán trong nội dung chuyển khoản. Ngân hàng hay thêm tiền tố, đổi khoảng trắng/dấu chấm hoặc dính chữ
 * (`MBVCB.123.TB2026090001 A101.CT tu…`), nên bỏ hết ký tự không phải chữ/số rồi mới dò. Trả về các mã khác nhau, giữ thứ tự gặp.
 */
export function extractPaymentCodes(...texts: (string | null | undefined)[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    const compact = text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    for (const m of compact.matchAll(CODE_RE)) {
      const code = m[1]! + m[2]!;
      if (!found.includes(code)) found.push(code);
    }
  }
  return found;
}

export const PAYMENT_CODE_PREFIXES = PREFIXES;
