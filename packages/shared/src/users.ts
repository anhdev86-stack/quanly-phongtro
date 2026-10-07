import { z } from 'zod';
import { expectedVersionSchema } from './common.js';
import { ALL_PERMISSIONS } from './permissions.js';
import { uuidSchema } from './primitives.js';

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email('Email không hợp lệ.'))
  .transform((v) => v.toLowerCase());

export const passwordSchema = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự.').max(200);

/**
 * Vai trò gán được (chủ dự án chốt 07/10/2026, D-041): chỉ Chủ trọ và Quản lý; tinh chỉnh từng người bằng quyền riêng.
 * STAFF/ACCOUNTANT là vai trò cũ: không gán mới, vẫn hoạt động cho tài khoản đang mang (nếu có).
 */
export const ASSIGNABLE_ROLES = ['OWNER', 'MANAGER'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Chủ trọ',
  MANAGER: 'Quản lý',
  STAFF: 'Nhân viên (vai trò cũ)',
  ACCOUNTANT: 'Kế toán (vai trò cũ)',
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
  /** V1.1: quyền cấp thêm (granted = true) hoặc thu hồi (false) so với vai trò. */
  permission_overrides: z.array(z.object({ permission: z.string(), granted: z.boolean() })),
  /** Quyền hiệu lực = quyền của vai trò ∪ cấp thêm − thu hồi. */
  effective_permissions: z.array(z.string()),
  version: z.number(),
  created_at: z.string(),
});
export type UserDto = z.infer<typeof userSchema>;

/** PUT /users/:id/roles — mỗi người dùng một vai trò. */
export const userRoleSchema = z.strictObject({
  role: z.enum(ASSIGNABLE_ROLES),
  expected_version: expectedVersionSchema,
});

/** PUT /users/:id/permission-overrides — thay toàn bộ danh sách quyền riêng. */
export const permissionOverridesSchema = z.strictObject({
  overrides: z
    .array(z.strictObject({ permission: z.enum(ALL_PERMISSIONS as [string, ...string[]]), granted: z.boolean() }))
    .max(100)
    .refine((xs) => new Set(xs.map((x) => x.permission)).size === xs.length, 'Một quyền bị khai báo trùng.'),
  expected_version: expectedVersionSchema,
});

export const roleSchema = z.object({ code: z.string(), name: z.string(), permissions: z.array(z.string()), assignable: z.boolean() });
export type RoleDto = z.infer<typeof roleSchema>;
