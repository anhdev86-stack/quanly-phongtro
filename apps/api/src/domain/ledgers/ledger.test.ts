import { describe, expect, it } from 'vitest';
import { DEPOSIT_SIGN, HOLDING_SIGN, ledgerBalance, reversedIds, summarizeDeposit, type LedgerTx } from './ledger.js';

const tx = (id: string, type: string, amount: bigint, reversesId: string | null = null): LedgerTx => ({ id, type, amount, reversesId });

describe('sổ cọc', () => {
  it('cộng các loại nhận, trừ các loại chi', () => {
    const txs = [tx('a', 'RECEIVED', 3_000_000n), tx('b', 'TOP_UP', 500_000n), tx('c', 'APPLIED_TO_INVOICE', 800_000n), tx('d', 'REFUND', 200_000n)];
    expect(ledgerBalance(txs, DEPOSIT_SIGN)).toBe(2_500_000n);
  });

  it('REVERSAL đảo đúng dấu của giao dịch gốc', () => {
    const received = [tx('a', 'RECEIVED', 3_000_000n), tx('r', 'REVERSAL', 3_000_000n, 'a')];
    expect(ledgerBalance(received, DEPOSIT_SIGN)).toBe(0n);
    const applied = [tx('a', 'RECEIVED', 3_000_000n), tx('b', 'APPLIED_TO_INVOICE', 1_000_000n), tx('r', 'REVERSAL', 1_000_000n, 'b')];
    expect(ledgerBalance(applied, DEPOSIT_SIGN)).toBe(3_000_000n);
  });

  it('chuyển từ tiền giữ chỗ là khoản cộng, không phải tiền thu mới trong tổng “đã nhận” riêng', () => {
    const s = summarizeDeposit([tx('a', 'CONVERTED_FROM_HOLDING', 1_000_000n), tx('b', 'RECEIVED', 2_000_000n)]);
    expect(s).toMatchObject({ held: 3_000_000n, received: 3_000_000n, applied: 0n });
  });

  it('tổng hợp bỏ giao dịch đã bị đảo', () => {
    const s = summarizeDeposit([tx('a', 'RECEIVED', 3_000_000n), tx('b', 'REFUND', 1_000_000n), tx('r', 'REVERSAL', 1_000_000n, 'b')]);
    expect(s).toMatchObject({ held: 3_000_000n, refunded: 0n });
    expect(reversedIds([tx('r', 'REVERSAL', 1n, 'b')])).toEqual(new Set(['b']));
  });

  it('dữ liệu sai: số tiền không dương, đảo một REVERSAL, REVERSAL mất gốc', () => {
    expect(() => ledgerBalance([tx('a', 'RECEIVED', 0n)], DEPOSIT_SIGN)).toThrow();
    expect(() => ledgerBalance([tx('a', 'RECEIVED', 5n), tx('r1', 'REVERSAL', 5n, 'a'), tx('r2', 'REVERSAL', 5n, 'r1')], DEPOSIT_SIGN)).toThrow();
    expect(() => ledgerBalance([tx('r', 'REVERSAL', 5n, 'x')], DEPOSIT_SIGN)).toThrow();
  });
});

describe('sổ tiền giữ chỗ', () => {
  it('nhận − chuyển cọc − hoàn − giữ lại', () => {
    const txs = [tx('a', 'RECEIVED', 1_000_000n), tx('b', 'CONVERTED_TO_DEPOSIT', 600_000n), tx('c', 'REFUND', 400_000n)];
    expect(ledgerBalance(txs, HOLDING_SIGN)).toBe(0n);
    expect(ledgerBalance([...txs, tx('r', 'REVERSAL', 600_000n, 'b')], HOLDING_SIGN)).toBe(600_000n);
  });
});
