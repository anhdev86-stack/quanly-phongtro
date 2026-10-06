import { Injectable } from '@nestjs/common';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { currentRequestId } from '../../common/context/request-context.js';
import { redact } from './redact.js';

export interface AuditEntry {
  workspaceId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
}

/**
 * Ghi nhật ký thao tác. Với thao tác tài chính, truyền `tx` để audit nằm trong cùng transaction nghiệp vụ:
 * nghiệp vụ rollback thì audit cũng rollback, nghiệp vụ commit thì audit chắc chắn có.
 */
@Injectable()
export class AuditService {
  async record(db: Db, entry: AuditEntry): Promise<string> {
    const row = await db.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason ?? null,
        requestId: entry.requestId ?? currentRequestId() ?? null,
      },
      select: { id: true },
    });
    return row.id;
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return redact(value) as Prisma.InputJsonValue;
}
