import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api-client';

/**
 * Đưa field_errors của API vào form (để lỗi hiện đúng ô). Trả về thông báo chung nếu có lỗi không gắn với ô nào.
 */
export function applyApiErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, known: readonly string[]): string {
  if (!(error instanceof ApiError)) return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
  let unmatched = false;
  for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
    if (known.includes(field)) setError(field as Path<T>, { type: 'server', message: messages[0] });
    else unmatched = true;
  }
  if (!error.fieldErrors || unmatched || error.code !== 'VALIDATION_FAILED') return error.message;
  return '';
}

/** Chuỗi rỗng → null (cho các field tùy chọn gửi lên API). */
export const blankToNull = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** "12" → 12, "" → null. */
export const intOrNull = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
