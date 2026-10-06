/**
 * Tìm SQLSTATE PostgreSQL trong lỗi Prisma/driver adapter (mã có thể nằm ở code, meta, originalCode hoặc cause).
 */
export function pgErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as {
      code?: unknown;
      originalCode?: unknown;
      meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown; code?: unknown } } };
      cause?: unknown;
    };
    for (const c of [e.originalCode, e.meta?.code, e.meta?.driverAdapterError?.cause?.originalCode, e.code]) {
      if (typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c)) return c;
    }
    current = e.cause ?? e.meta?.driverAdapterError;
  }
  return undefined;
}

/** Tên ràng buộc bị vi phạm (nếu tìm được trong thông điệp lỗi). */
export function violatedConstraint(error: unknown): string | undefined {
  const text = `${(error as Error)?.message ?? ''} ${safeJson(error)}`;
  return /constraint "([^"]+)"/.exec(text)?.[1] ?? /constraint `([^`]+)`/.exec(text)?.[1];
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export const PG = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  FOREIGN_KEY_VIOLATION: '23503',
} as const;
