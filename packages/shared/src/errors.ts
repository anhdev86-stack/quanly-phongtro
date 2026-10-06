import { z } from 'zod';

/**
 * Mã lỗi ổn định trả về trong error envelope. Client dựa vào `code`, không dựa vào `message`.
 * Message mặc định là tiếng Việt; server có thể ghi đè message cụ thể hơn.
 */
export const ERROR_MESSAGES = {
  UNAUTHENTICATED: 'Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.',
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  ACCOUNT_DISABLED: 'Tài khoản đã bị vô hiệu hóa.',
  TOO_MANY_ATTEMPTS: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.',
  REFRESH_TOKEN_INVALID: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
  REFRESH_TOKEN_REUSED: 'Phát hiện phiên đăng nhập bị dùng lại. Tất cả phiên liên quan đã bị thu hồi.',
  CSRF_TOKEN_INVALID: 'Yêu cầu không hợp lệ (CSRF). Vui lòng tải lại trang.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu.',
  ROUTE_NOT_FOUND: 'Không tìm thấy đường dẫn.',
  VALIDATION_FAILED: 'Dữ liệu gửi lên không hợp lệ.',
  VERSION_CONFLICT: 'Dữ liệu đã được người khác thay đổi. Vui lòng tải lại.',
  CONFLICT: 'Thao tác xung đột với dữ liệu hiện có.',
  IDEMPOTENCY_KEY_REQUIRED: 'Thiếu Idempotency-Key cho thao tác này.',
  IDEMPOTENCY_KEY_INVALID: 'Idempotency-Key không hợp lệ.',
  IDEMPOTENCY_KEY_REUSED: 'Idempotency-Key đã được dùng cho một yêu cầu khác.',
  REQUEST_IN_PROGRESS: 'Yêu cầu với cùng Idempotency-Key đang được xử lý. Vui lòng thử lại sau.',
  BUSINESS_RULE_VIOLATION: 'Thao tác vi phạm quy tắc nghiệp vụ.',
  SERVICE_UNAVAILABLE: 'Dịch vụ tạm thời không sẵn sàng.',
  INTERNAL_ERROR: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const ERROR_CODES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

export const errorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  field_errors: z.record(z.string(), z.array(z.string())).optional(),
  request_id: z.string(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
