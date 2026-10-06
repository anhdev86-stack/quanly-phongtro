import type { Db } from '../../infrastructure/prisma/prisma.service.js';

/** Tên hiển thị của người tạo, để ghi “ai đổi” trong lịch sử giá/chỉ số. */
export async function userNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
  return new Map(users.map((u) => [u.id, u.displayName]));
}
