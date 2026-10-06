import { describe, expect, it } from 'vitest';
import { readCookie } from './api-client';
import { formatBusinessDate, formatVnd } from './format';

describe('formatVnd', () => {
  it('định dạng kiểu Việt Nam, không mất chính xác với số lớn', () => {
    expect(formatVnd('3500000')).toBe('3.500.000 ₫');
    expect(formatVnd('0')).toBe('0 ₫');
    expect(formatVnd('900719925474099312')).toBe('900.719.925.474.099.312 ₫');
  });
});

describe('formatBusinessDate', () => {
  it('YYYY-MM-DD → DD/MM/YYYY', () => {
    expect(formatBusinessDate('2026-10-06')).toBe('06/10/2026');
  });
});

describe('readCookie', () => {
  it('đọc đúng cookie theo tên', () => {
    expect(readCookie('qt_csrf', 'a=1; qt_csrf=abc%2Bdef; b=2')).toBe('abc+def');
    expect(readCookie('missing', 'a=1')).toBeUndefined();
  });
});
