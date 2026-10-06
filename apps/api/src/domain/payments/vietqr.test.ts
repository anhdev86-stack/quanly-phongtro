import { describe, expect, it } from 'vitest';
import { buildVietQr, crc16, parseTlv, toTransferText, transferContent } from './vietqr.js';

describe('VietQR (T57)', () => {
  it('CRC16-CCITT-FALSE theo vector chuẩn', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('payload đúng cấu trúc EMVCo/NAPAS và CRC tự kiểm', () => {
    const payload = buildVietQr({ bankBin: '970436', accountNumber: '0123456789', amountVnd: 1_200_000n, content: 'TB-202611-0012 A101' });
    const top = parseTlv(payload);
    expect(top['00']).toBe('01');
    expect(top['01']).toBe('12');
    expect(top['53']).toBe('704');
    expect(top['54']).toBe('1200000');
    expect(top['58']).toBe('VN');
    const merchant = parseTlv(top['38']!);
    expect(merchant['00']).toBe('A000000727');
    expect(merchant['02']).toBe('QRIBFTTA');
    expect(parseTlv(merchant['01']!)).toEqual({ '00': '970436', '01': '0123456789' });
    expect(parseTlv(top['62']!)['08']).toBe('TB-202611-0012 A101');
    // CRC nằm cuối, tính trên toàn bộ chuỗi trước nó (gồm "6304")
    expect(payload.slice(-8, -4)).toBe('6304');
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  it('nội dung chuyển khoản không dấu, ≤ 25 ký tự', () => {
    expect(transferContent('TB-202611-0012', 'A101')).toBe('TB2026110012 A101');
    expect(toTransferText('Tiền phòng tháng 11 — Đặng Văn Ánh, P.A101')).toBe('TIEN PHONG THANG 11 DANG');
    expect(toTransferText('x'.repeat(40))).toHaveLength(25);
  });

  it('từ chối dữ liệu sai', () => {
    expect(() => buildVietQr({ bankBin: '97043', accountNumber: '1', amountVnd: 1n, content: '' })).toThrow();
    expect(() => buildVietQr({ bankBin: '970436', accountNumber: '1', amountVnd: 0n, content: '' })).toThrow();
  });
});
