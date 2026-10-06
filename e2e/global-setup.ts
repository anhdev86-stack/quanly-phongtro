import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { E2E_DATABASE_URL, ROOT } from './e2e-env';

/**
 * Database riêng cho E2E (ql_tro_e2e): tạo nếu chưa có, áp migration, xóa sạch dữ liệu, seed lại dữ liệu demo.
 * Không bao giờ đụng tới database dev (ql_tro) hay database integration test (ql_tro_test).
 */
export default async function globalSetup(): Promise<void> {
  const url = new URL(E2E_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_e2e')) throw new Error(`Database E2E phải kết thúc bằng _e2e (đang là ${dbName}).`);

  const admin = new pg.Client({ connectionString: E2E_DATABASE_URL.replace(`/${dbName}`, '/postgres'), connectionTimeoutMillis: 10_000 });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(`Không kết nối được PostgreSQL cho E2E (${url.host}). Docker Desktop và container postgres có đang chạy không? (pnpm db:up)`, { cause: error });
  }
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const apiDir = path.join(ROOT, 'apps', 'api');
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, NODE_ENV: 'development' };
  const prismaCli = path.join(apiDir, 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: apiDir, env, stdio: 'pipe', timeout: 120_000 });

  const client = new pg.Client({ connectionString: E2E_DATABASE_URL, connectionTimeoutMillis: 10_000 });
  await client.connect();
  const tables = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (tables.rows.length) {
    await client.query(`TRUNCATE TABLE ${tables.rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await client.end();

  const tsx = path.join(apiDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  execFileSync(process.execPath, [tsx, 'prisma/seed/index.ts'], { cwd: apiDir, env, stdio: 'pipe', timeout: 180_000 });
}
