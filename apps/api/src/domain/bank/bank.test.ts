import { describe, expect, it } from 'vitest';
import { preCheck } from './normalize.js';
import { extractPaymentCodes, invoiceNumberOf, paymentCodeOf } from './payment-code.js';
import { BankPayloadError, parseSepayListItem, parseSepayWebhook, parseVnDateTime } from './sepay-format.js';

describe('mã thanh toán (D-047)', () => {
  it('số thông báo ↔ mã: bỏ gạch, chỉ loại nợ', () => {
    expect(paymentCodeOf('TB-202609-0001')).toBe('TB2026090001');
    expect(paymentCodeOf('TT-202610-0012')).toBe('TT2026100012');
    expect(paymentCodeOf('DCT-202610-0003')).toBe('DCT2026100003');
    expect(paymentCodeOf('DCG-202610-0003')).toBeNull();
    expect(invoiceNumberOf('TB2026090001')).toBe('TB-202609-0001');
    expect(invoiceNumberOf('XX2026090001')).toBeNull();
  });

  it('dò mã trong nội dung ngân hàng: tiền tố, dấu chấm, dính chữ, chữ thường, có dấu', () => {
    expect(extractPaymentCodes('TB2026090001 A101')).toEqual(['TB2026090001']);
    expect(extractPaymentCodes('MBVCB.123456.TB2026090001 A101.CT tu 0123')).toEqual(['TB2026090001']);
    expect(extractPaymentCodes('tb 202609 0001 a101 chuyển tiền')).toEqual(['TB2026090001']);
    expect(extractPaymentCodes('NGUYEN VAN A chuyen tien phong')).toEqual([]);
    // tháng 13 hoặc năm 19xx không phải mã
    expect(extractPaymentCodes('TB2026130001', 'TB1999010001')).toEqual([]);
    // hai mã khác nhau → trả cả hai để đưa vào chờ đối chiếu; lặp cùng mã → một
    expect(extractPaymentCodes('TB2026090001 TB2026090002')).toEqual(['TB2026090001', 'TB2026090002']);
    expect(extractPaymentCodes('TB2026090001', 'code TB2026090001')).toEqual(['TB2026090001']);
    expect(extractPaymentCodes('DCT2026100003 A101')).toEqual(['DCT2026100003']);
  });

  it('kiểm tra trước: tiền ra, sai loại tiền, sai tài khoản, thiếu/nhiều mã → không tự ghi nhận', () => {
    const t = { direction: 'IN' as const, currency: 'VND', accountNumber: '0011223344' };
    expect(preCheck({ ...t, direction: 'OUT' }, '0011223344', ['TB2026090001'])).toMatchObject({ kind: 'skip', status: 'NOT_APPLICABLE' });
    expect(preCheck({ ...t, currency: 'USD' }, '0011223344', ['TB2026090001'])).toMatchObject({ kind: 'skip', status: 'NOT_APPLICABLE' });
    expect(preCheck(t, null, ['TB2026090001'])).toMatchObject({ kind: 'skip', status: 'PENDING_REVIEW' });
    expect(preCheck(t, '9999', ['TB2026090001'])).toMatchObject({ kind: 'skip', status: 'PENDING_REVIEW' });
    expect(preCheck(t, '0011223344', [])).toMatchObject({ kind: 'skip', status: 'PENDING_REVIEW' });
    expect(preCheck(t, '0011223344', ['TB2026090001', 'TB2026090002'])).toMatchObject({ kind: 'skip', status: 'PENDING_REVIEW' });
    expect(preCheck(t, '00-1122 3344', ['TB2026090001'])).toEqual({ kind: 'code', code: 'TB2026090001' });
  });
});

describe('định dạng SePay', () => {
  const sample = {
    id: 92704,
    gateway: 'Vietcombank',
    transactionDate: '2024-07-02 11:08:33',
    accountNumber: '1017588888',
    subAccount: '',
    code: 'TB2026090001',
    content: 'TB2026090001 A101 chuyen tien',
    transferType: 'in',
    description: 'NGUYEN VAN A chuyen tien',
    transferAmount: 5000000,
    accumulated: 105000000,
    referenceCode: 'FT24012345678',
  };

  it('payload mẫu trong tài liệu → giao dịch chuẩn hóa (giờ Việt Nam)', () => {
    expect(parseSepayWebhook(sample)).toEqual({
      providerTransactionId: '92704',
      accountNumber: '1017588888',
      direction: 'IN',
      amountVnd: 5000000n,
      currency: 'VND',
      content: 'TB2026090001 A101 chuyen tien',
      providerCode: 'TB2026090001',
      referenceCode: 'FT24012345678',
      occurredAt: new Date('2024-07-02T04:08:33.000Z'),
    });
    expect(parseSepayWebhook({ ...sample, transferType: 'out' }).direction).toBe('OUT');
  });

  it('payload sai → lỗi rõ ràng, không đoán', () => {
    expect(() => parseSepayWebhook(null)).toThrow(BankPayloadError);
    expect(() => parseSepayWebhook({ ...sample, id: undefined })).toThrow(BankPayloadError);
    expect(() => parseSepayWebhook({ ...sample, transferType: 'x' })).toThrow(BankPayloadError);
    expect(() => parseSepayWebhook({ ...sample, transferAmount: -5 })).toThrow(BankPayloadError);
    expect(() => parseSepayWebhook({ ...sample, transferAmount: 10.5 })).toThrow(BankPayloadError);
    expect(() => parseSepayWebhook({ ...sample, transactionDate: '02/07/2024' })).toThrow(BankPayloadError);
    expect(() => parseVnDateTime('2024-02-30 10:00:00')).not.toThrow();
  });

  it('dòng API danh sách giao dịch', () => {
    const item = parseSepayListItem({
      id: '19876',
      account_number: '1017588888',
      transaction_date: '2024-07-02 11:08:33',
      amount_in: '250000.00',
      amount_out: '0.00',
      transaction_content: 'TB2026090001 A101',
      reference_number: 'FT1',
      code: null,
    });
    expect(item).toMatchObject({ providerTransactionId: '19876', numericId: 19876n, direction: 'IN', amountVnd: 250000n, providerCode: null });
  });
});
