import { z } from 'zod';
import { expectedVersionSchema } from './common.js';
import { uuidSchema } from './primitives.js';

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email('Email không hợp lệ.'))
  .transform((v) => v.toLowerCase());

export const passwordSchema = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự.').max(200);

export const ASSIGNABLE_ROLES = ['OWNER', 'STAFF', 'MANAGER', 'ACCOUNTANT'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Chủ trọ',
  STAFF: 'Nhân viên',
  MANAGER: 'Quản lý',
  ACCOUNTANT: 'Kế toán',
};

export const userCreateSchema = z.strictObject({
  email: emailSchema,
  display_name: z.string().trim().min(1, 'Vui lòng nhập tên hiển thị.').max(120),
  password: passwordSchema,
  role: z.enum(ASSIGNABLE_ROLES),
  building_ids: z.array(uuidSchema).max(200).default([]),
});

export const userUpdateSchema = z.strictObject({
  display_name: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  expected_version: expectedVersionSchema,
});

export const userScopesSchema = z.strictObject({
  building_ids: z.array(uuidSchema).max(200),
  expected_version: expectedVersionSchema,
});

export const userResetPasswordSchema = z.strictObject({
  new_password: passwordSchema,
  expected_version: expectedVersionSchema,
});

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  is_active: z.boolean(),
  roles: z.array(z.string()),
  buildings: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  version: z.number(),
  created_at: z.string(),
});
export type UserDto = z.infer<typeof userSchema>;
