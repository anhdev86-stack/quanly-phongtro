import dotenv from 'dotenv';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env'), override: false, quiet: true });

const devUrl = process.env.DATABASE_URL ?? 'postgresql://ql_tro:ql_tro_dev_only@localhost:55432/ql_tro?schema=public';

/** Database E2E: mặc định cùng server với dev, tên ql_tro_e2e. Đổi bằng E2E_DATABASE_URL. */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? devUrl.replace(/\/([^/?]+)(\?|$)/, '/$1_e2e$2');
export const E2E_API_PORT = 4100;
export const E2E_WEB_PORT = 3100;
