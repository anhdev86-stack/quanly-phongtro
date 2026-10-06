/**
 * Sổ cọc và sổ tiền giữ chỗ (MASTER_PLAN 9.2, 9.3). Hàm thuần, không phụ thuộc DB.
 * amount luôn > 0; dấu suy ra từ loại; REVERSAL mang dấu ngược với giao dịch được đảo.
 */
export interface LedgerTx {
  id: string;
  type: string;
  amount: bigint;
  reversesId: string | null;
}

export const DEPOSIT_SIGN: Record<string, 1 | -1> = {
  RECEIVED: 1,
  TOP_UP: 1,
  CONVERTED_FROM_HOLDING: 1,
  TRANSFER_IN: 1,
  APPLIED_TO_INVOICE: -1,
  DEDUCTION: -1,
  REFUND: -1,
  TRANSFER_OUT: -1,
};

export const HOLDING_SIGN: Record<string, 1 | -1> = {
  RECEIVED: 1,
  CONVERTED_TO_DEPOSIT: -1,
  REFUND: -1,
  FORFEIT: -1,
};

/** Dấu hiệu lực của từng giao dịch (REVERSAL lấy ngược dấu của gốc). Ném lỗi nếu dữ liệu sổ không nhất quán. */
export function signedAmounts(txs: readonly LedgerTx[], signs: Record<string, 1 | -1>): Map<string, bigint> {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const result = new Map<string, bigint>();
  for (const t of txs) {
    if (t.amount <= 0n) throw new Error(`Giao dịch ${t.id} có số tiền không dương`);
    if (t.type === 'REVERSAL') {
      const original = t.reversesId ? byId.get(t.reversesId) : undefined;
      if (!original) throw new Error(`REVERSAL ${t.id} không tìm thấy giao dịch gốc`);
      if (original.type === 'REVERSAL') throw new Error('Không được đảo một giao dịch đảo');
      const sign = signs[original.type];
      if (!sign) throw new Error(`Loại không hợp lệ: ${original.type}`);
      result.set(t.id, -BigInt(sign) * t.amount);
    } else {
      const sign = signs[t.type];
      if (!sign) throw new Error(`Loại không hợp lệ: ${t.type}`);
      result.set(t.id, BigInt(sign) * t.amount);
    }
  }
  return result;
}

export function ledgerBalance(txs: readonly LedgerTx[], signs: Record<string, 1 | -1>): bigint {
  let total = 0n;
  for (const v of signedAmounts(txs, signs).values()) total += v;
  return total;
}

/** Tập id giao dịch đã bị đảo. */
export function reversedIds(txs: readonly LedgerTx[]): Set<string> {
  return new Set(txs.filter((t) => t.type === 'REVERSAL' && t.reversesId).map((t) => t.reversesId as string));
}

export interface DepositSummary {
  /** Đang giữ = Σ có dấu. */
  held: bigint;
  /** Đã thực nhận (RECEIVED + TOP_UP + chuyển từ giữ chỗ + chuyển vào) trừ phần đã đảo. */
  received: bigint;
  applied: bigint;
  deducted: bigint;
  refunded: bigint;
}

/** Tổng hợp sổ cọc theo nhóm, đã loại các giao dịch bị đảo. */
export function summarizeDeposit(txs: readonly LedgerTx[]): DepositSummary {
  const reversed = reversedIds(txs);
  const live = txs.filter((t) => t.type !== 'REVERSAL' && !reversed.has(t.id));
  const sum = (types: string[]) => live.filter((t) => types.includes(t.type)).reduce((a, t) => a + t.amount, 0n);
  return {
    held: ledgerBalance(txs, DEPOSIT_SIGN),
    received: sum(['RECEIVED', 'TOP_UP', 'CONVERTED_FROM_HOLDING', 'TRANSFER_IN']),
    applied: sum(['APPLIED_TO_INVOICE']),
    deducted: sum(['DEDUCTION']),
    refunded: sum(['REFUND', 'TRANSFER_OUT']),
  };
}
