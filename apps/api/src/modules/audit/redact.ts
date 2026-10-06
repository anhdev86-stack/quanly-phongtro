/**
 * Che dữ liệu nhạy cảm trước khi ghi audit/log (MASTER_PLAN 11.4):
 * không lưu mật khẩu, token, ảnh CCCD; số CCCD chỉ giữ 4 số cuối.
 */
const SECRET_KEYS = /(password|passwd|secret|token|authorization|cookie|csrf|hash)/i;
const IDENTITY_KEYS = /^(identity_?number|identityNumber|cccd|cmnd|passport_?number)$/i;
const IDENTITY_FILE_KEYS = /(identity_?(image|photo|file)|cccd_?(image|photo|file))/i;

export const REDACTED = '[REDACTED]';

export function maskIdentityNumber(value: string): string {
  const digits = value.replace(/\s+/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.test(key) || IDENTITY_FILE_KEYS.test(key)) {
      out[key] = REDACTED;
    } else if (IDENTITY_KEYS.test(key)) {
      out[key] = typeof v === 'string' ? maskIdentityNumber(v) : REDACTED;
    } else {
      out[key] = redact(v, depth + 1);
    }
  }
  return out;
}
