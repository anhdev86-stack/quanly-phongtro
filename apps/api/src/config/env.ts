import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

/** Biến tùy chọn: chuỗi rỗng (VD `SMS_API_KEY=` hoặc compose truyền `${X:-}`) coi như chưa đặt. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET phải có ít nhất 32 ký tự.'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: booleanString.default(false),
    BUSINESS_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
    /**
     * Proxy được tin để đọc IP thật (X-Forwarded-For) — dùng cho giới hạn đăng nhập và trang công khai.
     * Dev: Next.js rewrite trên cùng máy (loopback). Docker: Caddy trong mạng nội bộ (`loopback, uniquelocal`).
     */
    TRUST_PROXY: z.string().min(1).default('loopback'),
    /** Địa chỉ web công khai để ghép link xem thông báo trong tin nhắc. */
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    /** Job nhắc đóng tiền chạy mỗi 15 phút trong tiến trình API (tắt ở test). */
    REMINDER_JOB_ENABLED: booleanString.default(true),
    /** V1.1: thư mục tệp riêng tư (ảnh CCCD, hợp đồng scan…). Không đặt trong thư mục web công khai. Docker: volume /data/files. */
    STORAGE_DIR: z.string().min(1).default('.data/files'),
    // Khóa nhà cung cấp tin nhắn: chỉ ở biến môi trường server, không lưu DB, không ghi log (MASTER_PLAN 9.7).
    ZALO_ZNS_ACCESS_TOKEN: optional(z.string().min(1)),
    ZALO_ZNS_TEMPLATE_ID: optional(z.string().min(1)),
    SMS_API_URL: optional(z.string().url()),
    SMS_API_KEY: optional(z.string().min(1)),
    SMS_BRANDNAME: optional(z.string().min(1)),
    /**
     * Giao dịch ngân hàng tự động (D-047). off: tắt; mock: nhà cung cấp giả lập (có công cụ giả lập, không tiền thật);
     * test/live: nhà cung cấp thật (môi trường thử nghiệm / thật) — thiếu cấu hình thì dừng khởi động, KHÔNG tự chuyển sang mock.
     */
    BANK_INTEGRATION_MODE: z.enum(['off', 'mock', 'test', 'live']).default('off'),
    BANK_PROVIDER: optional(z.enum(['mock', 'sepay'])),
    /** Khóa xác thực webhook: nhà cung cấp gửi header `Authorization: Apikey <khóa>` (định dạng SePay). */
    BANK_WEBHOOK_API_KEY: optional(z.string().min(16, 'BANK_WEBHOOK_API_KEY phải có ít nhất 16 ký tự.')),
    /** SePay: API token (Bearer) để lấy bù giao dịch qua `GET /transactions/list`. */
    SEPAY_API_TOKEN: optional(z.string().min(16)),
    SEPAY_API_BASE_URL: z.string().url().default('https://my.sepay.vn/userapi'),
    /** Mock: địa chỉ webhook công cụ giả lập gọi tới (mặc định chính API này qua loopback). */
    BANK_MOCK_WEBHOOK_URL: optional(z.string().url()),
  })
  .superRefine((env, ctx) => {
    const mode = env.BANK_INTEGRATION_MODE;
    if (mode === 'off') return;
    const need = (key: keyof typeof env, message: string) => {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message });
    };
    need('BANK_PROVIDER', `BANK_INTEGRATION_MODE=${mode} cần BANK_PROVIDER.`);
    need('BANK_WEBHOOK_API_KEY', `BANK_INTEGRATION_MODE=${mode} cần BANK_WEBHOOK_API_KEY.`);
    if (mode === 'mock' && env.BANK_PROVIDER && env.BANK_PROVIDER !== 'mock') {
      ctx.addIssue({ code: 'custom', path: ['BANK_PROVIDER'], message: 'Chế độ mock chỉ dùng BANK_PROVIDER=mock.' });
    }
    if (mode !== 'mock') {
      if (env.BANK_PROVIDER === 'mock') ctx.addIssue({ code: 'custom', path: ['BANK_PROVIDER'], message: `Chế độ ${mode} không được dùng nhà cung cấp mock.` });
      if (env.BANK_PROVIDER === 'sepay') need('SEPAY_API_TOKEN', `BANK_PROVIDER=sepay (${mode}) cần SEPAY_API_TOKEN.`);
    }
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'Không dùng secret dev ở production.' });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Production bắt buộc COOKIE_SECURE=true.' });
    }
    if (!env.PUBLIC_BASE_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'Production cần PUBLIC_BASE_URL dạng https:// (link gửi người thuê).' });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Đọc và kiểm tra biến môi trường. Lỗi thì dừng khởi động, không in giá trị bí mật. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${details}`);
  }
  return result.data;
}
