import { z } from 'zod';

export const loginRequestSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email('Email không hợp lệ.'))
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.').max(200),
});

export type LoginRequest = z.input<typeof loginRequestSchema>;

export const buildingScopeSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});

export const meResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  workspace: z.object({
    id: z.string(),
    name: z.string(),
    timezone: z.string(),
  }),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  /** true nếu người dùng thấy mọi tòa trong workspace (OWNER). */
  all_buildings: z.boolean(),
  buildings: z.array(buildingScopeSchema),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
