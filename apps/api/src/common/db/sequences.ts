import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Lấy số tiếp theo của bộ đếm (workspace, loại, kỳ) một cách nguyên tử trong transaction hiện tại.
 * Dùng INSERT … ON CONFLICT DO UPDATE … RETURNING: hai transaction đồng thời không bao giờ nhận cùng số;
 * transaction rollback thì số đó cũng không bị “tiêu” (không tạo lỗ hổng do lỗi).
 */
export async function nextSequence(tx: Prisma.TransactionClient, workspaceId: string, kind: string, period: string): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO document_sequences (workspace_id, kind, period, last_value)
    VALUES (${workspaceId}::uuid, ${kind}, ${period}, 1)
    ON CONFLICT (workspace_id, kind, period) DO UPDATE SET last_value = document_sequences.last_value + 1
    RETURNING last_value`;
  return Number(rows[0]!.last_value);
}

/** "2026-10-06" → "2610". */
export function yymm(date: string): string {
  return `${date.slice(2, 4)}${date.slice(5, 7)}`;
}
