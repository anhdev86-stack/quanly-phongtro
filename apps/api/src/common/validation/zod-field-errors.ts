import type { ZodError } from 'zod';

/** Gom lỗi Zod theo đường dẫn field: { "email": ["Email không hợp lệ."] }. */
export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const unknownKeys = issue.code === 'unrecognized_keys' ? issue.keys : [];
    const paths = unknownKeys.length > 0 ? unknownKeys.map((k) => [...issue.path, k].join('.')) : [issue.path.join('.') || '_'];
    const message = issue.code === 'unrecognized_keys' ? 'Field không được phép.' : issue.message;
    for (const path of paths) {
      (result[path] ??= []).push(message);
    }
  }
  return result;
}
