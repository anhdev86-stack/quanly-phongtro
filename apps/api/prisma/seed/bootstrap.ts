import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { seedDefaultServices, syncRolesAndPermissions } from './foundation.js';

export interface BootstrapEnv {
  BOOTSTRAP_WORKSPACE_NAME?: string;
  BOOTSTRAP_OWNER_EMAIL?: string;
  BOOTSTRAP_OWNER_NAME?: string;
  BOOTSTRAP_OWNER_PASSWORD?: string;
}

/**
 * Khởi tạo/cập nhật database production sau `prisma migrate deploy` (RUNBOOK.md). Không tạo dữ liệu demo.
 *
 * - Luôn: đồng bộ quyền và vai trò mặc định theo bản phát hành.
 * - Chỉ khi chưa có người dùng nào: tạo nhà trọ, danh mục dịch vụ mặc định và tài khoản chủ trọ đầu tiên.
 *   Mật khẩu không in ra.
 */
export async function bootstrapProduction(prisma: PrismaClient, env: BootstrapEnv): Promise<string[]> {
  const log: string[] = [];
  await syncRolesAndPermissions(prisma);
  log.push('Đã đồng bộ quyền và vai trò.');
  if ((await prisma.user.count()) > 0) {
    log.push('Đã có người dùng: không tạo tài khoản chủ trọ.');
    return log;
  }
  const email = env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
  const password = env.BOOTSTRAP_OWNER_PASSWORD;
  const name = env.BOOTSTRAP_OWNER_NAME?.trim() || 'Chủ trọ';
  const workspaceName = env.BOOTSTRAP_WORKSPACE_NAME?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12 || !workspaceName) {
    throw new Error('Database chưa có người dùng. Đặt BOOTSTRAP_WORKSPACE_NAME, BOOTSTRAP_OWNER_EMAIL và BOOTSTRAP_OWNER_PASSWORD (tối thiểu 12 ký tự) rồi chạy lại.');
  }
  const passwordHash = await hashPassword(password);
  const workspace = await prisma.workspace.create({ data: { name: workspaceName, timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' } });
  await seedDefaultServices(prisma, workspace.id);
  const user = await prisma.user.create({ data: { workspaceId: workspace.id, email, displayName: name, passwordHash } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'OWNER' } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  log.push(`Đã tạo nhà trọ “${workspaceName}” và tài khoản chủ trọ ${email}. Nên xóa BOOTSTRAP_OWNER_PASSWORD khỏi môi trường.`);
  return log;
}
