import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadEnv } from '../../src/config/load-env.js';

/**
 * Chạy một lần trước toàn bộ integration test: áp các migration còn thiếu vào database test
 * (chính các migration production dùng, gồm SQL thủ công). `migrate deploy` không xóa dữ liệu;
 * mỗi file test tự TRUNCATE dữ liệu test qua resetDatabase().
 *
 * Nếu một migration đã áp vào database test bị sửa lại, deploy sẽ báo lỗi. Khi đó người dùng tự reset
 * database test (xem README, mục "Reset database test"). Test không tự chạy `migrate reset`.
 */
export default function setup(): void {
  loadEnv();
  const testUrl = process.env.DATABASE_URL_TEST;
  const devUrl = process.env.DATABASE_URL;
  if (!testUrl) throw new Error('Thiếu DATABASE_URL_TEST trong .env (xem .env.example).');
  if (testUrl === devUrl) throw new Error('DATABASE_URL_TEST trùng DATABASE_URL — từ chối chạy test trên database dev.');
  const dbName = new URL(testUrl).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error(`Database test phải có tên kết thúc bằng _test (đang là "${dbName}").`);

  // Vitest chạy từ thư mục apps/api (pnpm --filter @ql-tro/api …).
  const apiDir = process.cwd();
  if (!fs.existsSync(path.join(apiDir, 'prisma.config.ts'))) {
    throw new Error(`Hãy chạy integration test từ apps/api (cwd hiện tại: ${apiDir}).`);
  }
  const prismaCli = createRequire(path.join(apiDir, 'package.json')).resolve('prisma/build/index.js');
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    const e = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy (database test) thất bại:\n${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`, {
      cause: error,
    });
  }
}

/** Chốt an toàn cho resetDatabase(): chỉ TRUNCATE khi đang trỏ vào database *_test. */
export function assertTestDatabase(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL chưa được đặt cho test.');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error(`Từ chối xóa dữ liệu: "${dbName}" không phải database test.`);
}
