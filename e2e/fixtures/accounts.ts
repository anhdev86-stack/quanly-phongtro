/** Tài khoản dev từ seed; mật khẩu đọc từ .env (SEED_*_PASSWORD), không ghi cứng. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu ${name} trong .env — chạy \`pnpm db:seed\` với cùng giá trị trước khi chạy E2E.`);
  return value;
}

export const accounts = {
  owner: { email: 'owner@example.test', password: () => required('SEED_OWNER_PASSWORD'), name: 'Chủ trọ Demo' },
  // Seed dev/E2E chỉ có Chủ trọ + Quản lý (D-041).
  managerA: { email: 'manager.a@example.test', password: () => required('SEED_STAFF_PASSWORD'), name: 'Quản lý Tòa A' },
  managerBC: { email: 'manager.bc@example.test', password: () => required('SEED_STAFF_PASSWORD'), name: 'Quản lý Tòa B, C' },
} as const;
