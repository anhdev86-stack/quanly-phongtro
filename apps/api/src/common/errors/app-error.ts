import { ERROR_MESSAGES, type ErrorCode } from '@ql-tro/shared';

const DEFAULT_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 401,
  REFRESH_TOKEN_INVALID: 401,
  REFRESH_TOKEN_REUSED: 401,
  TOO_MANY_ATTEMPTS: 429,
  CSRF_TOKEN_INVALID: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  VERSION_CONFLICT: 409,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  REQUEST_IN_PROGRESS: 409,
  BUSINESS_RULE_VIOLATION: 422,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * Lỗi có mã ổn định. Mọi lỗi nghiệp vụ ném AppError; filter chuyển thành error envelope.
 * Quy ước HTTP (MASTER_PLAN mục 10): 401 chưa đăng nhập, 403 thiếu quyền, 404 ngoài phạm vi/không tồn tại,
 * 409 conflict, 422 vi phạm quy tắc nghiệp vụ, 400 dữ liệu sai định dạng.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly fieldErrors?: Record<string, string[]>,
    status?: number,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.status = status ?? DEFAULT_STATUS[code] ?? 500;
  }
}
