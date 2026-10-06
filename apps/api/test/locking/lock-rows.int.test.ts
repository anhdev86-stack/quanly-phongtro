import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../prisma/seed/foundation.js';
import { lockRows } from '../../src/infrastructure/locking/lock-rows.js';
import { createTestApp, resetDatabase, type TestApp } from '../helpers/test-app.js';

describe('lockRows (SELECT … FOR UPDATE)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(t);
  });
  afterAll(() => t.close());

  it('trả về id tồn tại theo thứ tự đã sắp xếp, bỏ id không tồn tại', async () => {
    const missing = '01920000-0000-7000-8000-0000000000ff';
    const ids = await t.prisma.$transaction((tx) =>
      lockRows(tx, 'buildings', [SEED_IDS.buildings.C, missing, SEED_IDS.buildings.A, SEED_IDS.buildings.C]),
    );
    expect(ids).toEqual([SEED_IDS.buildings.A, SEED_IDS.buildings.C]);
  });

  it('dòng đang bị khóa thì transaction khác phải chờ (hết lock_timeout thì lỗi)', async () => {
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => (releaseFirst = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));

    const first = t.prisma.$transaction(
      async (tx) => {
        await lockRows(tx, 'buildings', [SEED_IDS.buildings.A]);
        locked();
        await held;
      },
      { timeout: 10_000 },
    );
    await isLocked;

    const second = t.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '200ms'`);
      await lockRows(tx, 'buildings', [SEED_IDS.buildings.A]);
    });
    await expect(second).rejects.toThrow(/lock/i);

    releaseFirst();
    await first;
    // Sau khi transaction đầu kết thúc, khóa được bình thường
    await expect(t.prisma.$transaction((tx) => lockRows(tx, 'buildings', [SEED_IDS.buildings.A]))).resolves.toHaveLength(1);
  });

  it('từ chối bảng ngoài danh sách cho phép', async () => {
    await expect(t.prisma.$transaction((tx) => lockRows(tx, 'audit_logs' as never, [SEED_IDS.workspace]))).rejects.toThrow(
      /không được phép/,
    );
  });
});
