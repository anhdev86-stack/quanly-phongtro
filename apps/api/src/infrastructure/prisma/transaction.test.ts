import { describe, expect, it, vi } from 'vitest';
import { isRetryableTransactionError, runInTransaction } from './transaction.js';
import { normalizeLockIds } from '../locking/lock-rows.js';

describe('isRetryableTransactionError', () => {
  it('nhận diện P2034, 40001, 40P01 kể cả khi nằm trong cause', () => {
    expect(isRetryableTransactionError({ code: 'P2034' })).toBe(true);
    expect(isRetryableTransactionError({ code: '40001' })).toBe(true);
    expect(isRetryableTransactionError({ meta: { code: '40P01' } })).toBe(true);
    expect(isRetryableTransactionError(new Error('x', { cause: { originalCode: '40001' } }))).toBe(true);
  });

  it('không thử lại lỗi unique hoặc lỗi nghiệp vụ', () => {
    expect(isRetryableTransactionError({ code: 'P2002' })).toBe(false);
    expect(isRetryableTransactionError(new Error('rule'))).toBe(false);
    expect(isRetryableTransactionError(null)).toBe(false);
  });
});

describe('runInTransaction', () => {
  it('thử lại khi deadlock rồi thành công', async () => {
    const tx = {} as never;
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: '40P01' })
      .mockImplementationOnce(async (fn: (t: never) => Promise<string>) => fn(tx));
    const result = await runInTransaction({ $transaction } as never, async () => 'ok');
    expect(result).toBe('ok');
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('dừng sau số lần thử tối đa', async () => {
    const $transaction = vi.fn().mockRejectedValue({ code: '40001' });
    await expect(runInTransaction({ $transaction } as never, async () => 'x', { maxRetries: 2 })).rejects.toEqual({
      code: '40001',
    });
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it('không thử lại lỗi khác', async () => {
    const $transaction = vi.fn().mockRejectedValue(new Error('rule'));
    await expect(runInTransaction({ $transaction } as never, async () => 'x')).rejects.toThrow('rule');
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeLockIds', () => {
  it('bỏ trùng, chữ thường và sắp xếp ổn định', () => {
    expect(
      normalizeLockIds([
        'BBBBBBBB-0000-4000-8000-000000000000',
        'aaaaaaaa-0000-4000-8000-000000000000',
        'bbbbbbbb-0000-4000-8000-000000000000',
      ]),
    ).toEqual(['aaaaaaaa-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000000']);
  });

  it('từ chối id không phải UUID (chặn chèn SQL)', () => {
    expect(() => normalizeLockIds(["1'; DROP TABLE users; --"])).toThrow();
  });
});
