import { AppError } from '../errors/app-error.js';

/**
 * Optimistic concurrency (MASTER_PLAN mục 10): cập nhật chỉ khi `version` khớp, rồi tăng version.
 * `updateMany` trả count = 0 khi version lệch → VERSION_CONFLICT; không tồn tại → NOT_FOUND.
 */
export async function updateVersioned(
  delegate: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  },
  where: Record<string, unknown> & { id: string },
  expectedVersion: number,
  data: Record<string, unknown>,
): Promise<void> {
  const result = await delegate.updateMany({
    where: { ...where, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (result.count === 1) return;
  const exists = await delegate.count({ where });
  throw new AppError(exists ? 'VERSION_CONFLICT' : 'NOT_FOUND');
}
