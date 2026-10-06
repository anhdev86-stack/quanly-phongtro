import { COOKIE_NAMES, CSRF_HEADER, ERROR_MESSAGES, IDEMPOTENCY_HEADER, type ErrorEnvelope } from '@ql-tro/shared';

/** Lỗi từ API, mang `code` ổn định để UI xử lý; `message` đã là tiếng Việt. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Bắt buộc cho thao tác tài chính (MASTER_PLAN 9.5). Tạo một lần cho mỗi lần người dùng bấm. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

export function readCookie(name: string, cookieString: string = typeof document === 'undefined' ? '' : document.cookie): string | undefined {
  for (const part of cookieString.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Chỉ một request refresh tại một thời điểm: nhiều request cùng gặp 401 sẽ chờ chung, tránh dùng lại
 * refresh token cũ (server coi đó là bị đánh cắp và thu hồi cả phiên).
 */
function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= send('/auth/refresh', { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

function send(path: string, options: ApiRequestOptions): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie(COOKIE_NAMES.CSRF);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }
  if (options.idempotencyKey) headers[IDEMPOTENCY_HEADER] = options.idempotencyKey;
  return fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
}

export async function toApiError(res: Response): Promise<ApiError> {
  let envelope: Partial<ErrorEnvelope> = {};
  try {
    envelope = (await res.json()) as Partial<ErrorEnvelope>;
  } catch {
    // Không phải JSON (ví dụ proxy lỗi) — dùng thông báo chung.
  }
  const fallback = res.status >= 500 || res.status === 0 ? ERROR_MESSAGES.INTERNAL_ERROR : ERROR_MESSAGES.VALIDATION_FAILED;
  return new ApiError(
    res.status,
    envelope.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN'),
    envelope.message ?? fallback,
    envelope.field_errors,
    envelope.request_id,
  );
}

/** Gọi API cùng origin. Tự refresh một lần khi access token hết hạn rồi thử lại. */
export async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await send(path, options);
    if (res.status === 401 && !NO_REFRESH_PATHS.includes(path) && (await refreshOnce())) {
      res = await send(path, options);
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
