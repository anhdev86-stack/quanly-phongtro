/** Tài khoản dev từ seed; mật khẩu đọc từ .env (SEED_*_PASSWORD), không ghi cứng. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu ${name} trong .env — chạy \`pnpm db:seed\` với cùng giá trị trước khi chạy E2E.`);
  return value;
}

export const accounts = {
  owner: { email: 'owner@example.test', password: () => required('SEED_OWNER_PASSWORD'), name: 'Chủ trọ Demo' },
  staffA: { email: 'staff.a@example.test', password: () => required('SEED_STAFF_PASSWORD'), name: 'Nhân viên Tòa A' },
  staffBC: { email: 'staff.bc@example.test', password: () => required('SEED_STAFF_PASSWORD'), name: 'Nhân viên Tòa B, C' },
  managerA: { email: 'manager.a@example.test', password: () => required('SEED_STAFF_PASSWORD'), name: 'Quản lý Tòa A' },
  accountantB: { email: 'accountant.b@example.test', password: () => required('SEED_STAFF_PASSWORD'), name: 'Kế toán Tòa B' },
} as const;
