import { describe, expect, it } from 'vitest';
import { requestHash, stableStringify } from './stable-hash.js';

describe('stableStringify / requestHash', () => {
  it('không phụ thuộc thứ tự key', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
    expect(requestHash('POST /x', { a: 1, b: 2 })).toBe(requestHash('POST /x', { b: 2, a: 1 }));
  });

  it('khác route hoặc khác payload thì khác hash', () => {
    expect(requestHash('POST /x', { a: 1 })).not.toBe(requestHash('POST /y', { a: 1 }));
    expect(requestHash('POST /x', { a: 1 })).not.toBe(requestHash('POST /x', { a: 2 }));
  });
});
