import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { createTestApp, resetDatabase, type TestApp } from '../helpers/test-app.js';

/**
 * T47 — ràng buộc SQL thủ công: định nghĩa khớp danh mục prisma/MANUAL_SQL.md và hành vi đúng.
 * Danh mục là nguồn sự thật; thêm ràng buộc vào danh mục mà chưa thêm test hành vi thì test fail.
 */
interface CatalogEntry {
  name: string;
  kind: 'check' | 'extension' | 'index' | 'exclude';
  table: string | null;
  definition: string;
}

function readCatalog(): CatalogEntry[] {
  const md = fs.readFileSync(path.join(process.cwd(), 'prisma', 'MANUAL_SQL.md'), 'utf8');
  const match = /```json manual-constraints\r?\n([\s\S]*?)```/.exec(md);
  if (!match?.[1]) throw new Error('Không tìm thấy khối ```json manual-constraints trong MANUAL_SQL.md');
  return JSON.parse(match[1]) as CatalogEntry[];
}

class Rollback extends Error {}

describe('T47 — ràng buộc SQL thủ công', () => {
  let t: TestApp;
  let userId: string;
  const catalog = readCatalog();

  /** Chạy fn trong transaction rồi luôn rollback; trả lỗi database nếu có. */
  async function attempt(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<Error | null> {
    try {
      await t.prisma.$transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (error instanceof Rollback) return null;
      return error as Error;
    }
    return null;
  }

  const expectAccepted = async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    expect(await attempt(fn)).toBeNull();
  const expectRejected = async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, constraint: string) => {
    const error = await attempt(fn);
    expect(error, `phải bị ràng buộc ${constraint} từ chối`).not.toBeNull();
    expect(`${error?.message} ${JSON.stringify(error)}`).toContain(constraint);
  };

  /** Mỗi ràng buộc trong danh mục phải có một case hợp lệ sát biên và ít nhất một case vi phạm. */
  const behaviours: Record<string, () => Promise<void>> = {
    btree_gist: async () => {
      const setup = async (tx: Prisma.TransactionClient) => {
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE gist_probe (k uuid, r daterange,
          EXCLUDE USING gist (k WITH =, r WITH &&)) ON COMMIT DROP`);
      };
      const k = SEED_IDS.workspace;
      await expectAccepted(async (tx) => {
        await setup(tx);
        await tx.$executeRawUnsafe(`INSERT INTO gist_probe VALUES ($1::uuid, '[2026-10-01,2026-10-06)'), ($1::uuid, '[2026-10-06,2026-10-10)')`, k);
      });
      const error = await attempt(async (tx) => {
        await setup(tx);
        await tx.$executeRawUnsafe(`INSERT INTO gist_probe VALUES ($1::uuid, '[2026-10-01,2026-10-07)'), ($1::uuid, '[2026-10-06,2026-10-10)')`, k);
      });
      expect(String(error?.message ?? JSON.stringify(error))).toMatch(/exclusion|gist_probe/i);
    },

    users_email_lowercase_chk: async () => {
      const insert = (email: string) => (tx: Prisma.TransactionClient) =>
        tx.$executeRawUnsafe(
          `INSERT INTO users (id, workspace_id, email, password_hash, display_name, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, 'x', 'Probe', now())`,
          SEED_IDS.workspace,
          email,
        );
      await expectAccepted(insert('lowercase.probe@example.test'));
      await expectRejected(insert('Upper.Probe@example.test'), 'users_email_lowercase_chk');
    },

    refresh_sessions_expiry_chk: async () => {
      const insert = (expiresOffset: string) => (tx: Prisma.TransactionClient) =>
        tx.$executeRawUnsafe(
          `INSERT INTO refresh_sessions (id, user_id, family_id, token_hash, created_at, expires_at)
           VALUES (gen_random_uuid(), $1::uuid, gen_random_uuid(), md5(random()::text), '2026-10-06T00:00:00Z',
                   '2026-10-06T00:00:00Z'::timestamptz + $2::interval)`,
          userId,
          expiresOffset,
        );
      await expectAccepted(insert('1 millisecond'));
      await expectRejected(insert('0 seconds'), 'refresh_sessions_expiry_chk');
    },

    idempotency_requests_key_format_chk: async () => {
      const insert = (key: string) => (tx: Prisma.TransactionClient) =>
        tx.$executeRawUnsafe(
          `INSERT INTO idempotency_requests (id, workspace_id, actor_id, route, key, request_hash, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'POST /probe', $3, 'h', now())`,
          SEED_IDS.workspace,
          userId,
          key,
        );
      await expectAccepted(insert('a'.repeat(8)));
      await expectAccepted(insert('b'.repeat(128)));
      await expectRejected(insert('a'.repeat(7)), 'idempotency_requests_key_format_chk');
      await expectRejected(insert('c'.repeat(129)), 'idempotency_requests_key_format_chk');
      await expectRejected(insert('khoá có dấu cách'), 'idempotency_requests_key_format_chk');
    },

    idempotency_requests_done_has_status_chk: async () => {
      const insert = (status: string, responseStatus: number | null) => (tx: Prisma.TransactionClient) =>
        tx.$executeRawUnsafe(
          `INSERT INTO idempotency_requests (id, workspace_id, actor_id, route, key, request_hash, status, response_status, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'POST /probe', 'key-done-0001', 'h', $3::"IdempotencyStatus", $4, now())`,
          SEED_IDS.workspace,
          userId,
          status,
          responseStatus,
        );
      await expectAccepted(insert('DONE', 201));
      await expectAccepted(insert('IN_PROGRESS', null));
      await expectRejected(insert('DONE', null), 'idempotency_requests_done_has_status_chk');
    },
  };

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
    userId = (await t.prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.test' } })).id;
  });
  afterAll(() => t.close());

  it('danh mục không rỗng và mọi ràng buộc đều có test hành vi', () => {
    expect(catalog.length).toBeGreaterThan(0);
    const missing = catalog.map((c) => c.name).filter((name) => !behaviours[name]);
    expect(missing, 'ràng buộc chưa có test hành vi').toEqual([]);
  });

  for (const entry of catalog) {
    it(`định nghĩa khớp danh mục: ${entry.name}`, async () => {
      if (entry.kind === 'extension') {
        const rows = await t.prisma.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = ${entry.definition}`;
        expect(rows).toHaveLength(1);
        return;
      }
      if (entry.kind === 'index') {
        const rows = await t.prisma.$queryRaw<{ def: string }[]>`
          SELECT pg_get_indexdef(c.oid) AS def FROM pg_class c WHERE c.relname = ${entry.name} AND c.relkind = 'i'`;
        expect(rows[0]?.def).toBe(entry.definition);
        return;
      }
      const rows = await t.prisma.$queryRaw<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = ${entry.name} AND conrelid = ${entry.table}::regclass`;
      expect(rows[0]?.def).toBe(entry.definition);
    });

    it(`hành vi đúng: ${entry.name}`, async () => {
      const behaviour = behaviours[entry.name];
      if (!behaviour) throw new Error(`Chưa có test hành vi cho ${entry.name}`);
      await behaviour();
    });
  }
});
