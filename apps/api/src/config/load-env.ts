import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Nạp file .env ở gốc repository (thư mục chứa pnpm-workspace.yaml).
 * Không ghi đè biến môi trường đã có sẵn, để test và production tự đặt giá trị.
 */
export function loadEnv(startDir: string = process.cwd()): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false, quiet: true });
      return candidate;
    }
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
