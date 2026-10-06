import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Số lần thử lại khi gặp deadlock / serialization conflict. */
  maxRetries?: number;
  timeoutMs?: number;
}

const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

/**
 * true nếu lỗi là deadlock (40P01) hoặc serialization failure (40001), có thể thử lại an toàn
 * vì transaction đã bị rollback toàn bộ.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; meta?: { code?: unknown }; cause?: unknown; originalCode?: unknown };
    if (e.code === 'P2034') return true;
    for (const candidate of [e.code, e.meta?.code, e.originalCode]) {
      if (typeof candidate === 'string' && RETRYABLE_SQLSTATES.has(candidate)) return true;
    }
    current = e.cause;
  }
  return false;
}

/**
 * Chạy `fn` trong một transaction, thử lại có giới hạn khi deadlock/serialization conflict.
 * `fn` phải idempotent trong phạm vi transaction (không gây tác dụng phụ ngoài DB).
 */
export async function runInTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: options.timeoutMs ?? 15_000,
        maxWait: 5_000,
      });
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableTransactionError(error)) throw error;
      const backoffMs = 20 * 2 ** attempt + Math.floor(Math.random() * 20);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}
