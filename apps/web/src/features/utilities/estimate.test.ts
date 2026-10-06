import { describe, expect, it } from 'vitest';
import { estimate, fromHundredths, normalizeReading, toHundredths } from './estimate';

describe('ước tính tạm tính khi gõ (chỉ để xem)', () => {
  it('tiêu thụ và tiền làm tròn HALF_UP như API', () => {
    expect(estimate('1120.5', '1000', '0', '3500', 1)).toEqual({ usage: 12050n, amount: 421750n });
    expect(estimate('1123', '1000', '0', '3500', 1000)).toEqual({ usage: 12300n, amount: 431000n });
    expect(estimate('25', '0', '80', '3500', 1)).toEqual({ usage: 10500n, amount: 367500n });
  });
  it('chưa có giá vẫn ra tiêu thụ; âm hoặc sai định dạng → null', () => {
    expect(estimate('1010', '1000', '0', null, 1)).toEqual({ usage: 1000n, amount: null });
    expect(estimate('999', '1000', '0', '3500', 1)).toBeNull();
    expect(estimate('1,234', '1000', '0', '3500', 1)).toBeNull();
  });
  it('dấu phẩy thập phân kiểu Việt Nam', () => {
    expect(normalizeReading(' 12,5 ')).toBe('12.5');
    expect(toHundredths('12,5')).toBe(1250n);
    expect(fromHundredths(1250n)).toBe('12,5');
    expect(fromHundredths(1200n)).toBe('12');
  });
});
