import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Thứ tự khóa bắt buộc cho mọi transaction tài chính (MASTER_PLAN 6.9):
 * room → tenancy → invoice → reservation/holding → deposit → settlement.
 * Chỉ các bảng trong danh sách này được khóa qua helper; tên bảng không bao giờ lấy từ input.
 */
export const LOCK_ORDER = ['users', 'refresh_sessions', 'buildings'] as const;
// Phase sau bổ sung theo đúng thứ tự: 'rooms', 'tenancies', 'invoices', 'reservations',
// 'deposit_transactions', 'move_out_settlements'.

export type LockableTable = (typeof LOCK_ORDER)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chuẩn hóa danh sách id: bỏ trùng, kiểm tra định dạng, sắp xếp để khóa theo thứ tự ổn định. */
export function normalizeLockIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  for (const id of unique) {
    if (!UUID_RE.test(id)) throw new Error(`lockRows: id không phải UUID: ${id}`);
  }
  return unique.sort();
}

/**
 * SELECT … FOR UPDATE các dòng theo id đã sắp xếp. Trả về danh sách id thực sự tồn tại.
 * Gọi lần lượt theo LOCK_ORDER khi cần khóa nhiều bảng.
 */
export async function lockRows(
  tx: Prisma.TransactionClient,
  table: LockableTable,
  ids: readonly string[],
): Promise<string[]> {
  if (!LOCK_ORDER.includes(table)) throw new Error(`lockRows: bảng không được phép: ${table}`);
  const sorted = normalizeLockIds(ids);
  if (sorted.length === 0) return [];
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id::text AS id FROM "${table}" WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    sorted,
  );
  return rows.map((r) => r.id);
}
