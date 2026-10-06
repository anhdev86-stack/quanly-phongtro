import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

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
    /** Địa chỉ web công khai để ghép link xem thông báo trong tin nhắc. */
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    /** Job nhắc đóng tiền chạy mỗi 15 phút trong tiến trình API (tắt ở test). */
    REMINDER_JOB_ENABLED: booleanString.default(true),
    // Khóa nhà cung cấp tin nhắn: chỉ ở biến môi trường server, không lưu DB, không ghi log (MASTER_PLAN 9.7).
    ZALO_ZNS_ACCESS_TOKEN: z.string().min(1).optional(),
    ZALO_ZNS_TEMPLATE_ID: z.string().min(1).optional(),
    SMS_API_URL: z.string().url().optional(),
    SMS_API_KEY: z.string().min(1).optional(),
    SMS_BRANDNAME: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'Không dùng secret dev ở production.' });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Production bắt buộc COOKIE_SECURE=true.' });
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
