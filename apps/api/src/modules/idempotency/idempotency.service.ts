import { Injectable } from '@nestjs/common';
import { idempotencyKeySchema } from '@ql-tro/shared';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { requestHash } from './stable-hash.js';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  /** true nếu đây là kết quả đã lưu của lần gọi trước với cùng key. */
  replayed: boolean;
}

export interface IdempotentParams {
  user: Pick<AuthUser, 'id' | 'workspaceId'>;
  /** Định danh route ổn định, ví dụ "POST /tenancies/move-in". */
  route: string;
  key: string | undefined;
  payload: unknown;
  /** HTTP status khi thành công. Mặc định 200. */
  successStatus?: number;
}

/** Chờ tối đa bao lâu nếu một request khác cùng key đang chạy, trước khi trả REQUEST_IN_PROGRESS. */
const LOCK_TIMEOUT = '5s';

/**
 * Idempotency cho thao tác tài chính (MASTER_PLAN 9.5).
 *
 * Bản ghi idempotency được chèn và hoàn tất **trong cùng transaction nghiệp vụ**:
 * - commit thì kết quả và bản ghi cùng tồn tại; crash sau commit, client gọi lại vẫn nhận kết quả cũ;
 * - rollback thì không còn dấu vết, gọi lại sẽ chạy lại từ đầu;
 * - request đồng thời cùng key bị chặn ở unique index cho tới khi request đầu commit, rồi nhận kết quả đã lưu.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(
    params: IdempotentParams,
    fn: (tx: Prisma.TransactionClient) => Promise<{ body: T; resultReference?: string }>,
  ): Promise<IdempotentResult<T>> {
    if (!params.key) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    if (!idempotencyKeySchema.safeParse(params.key).success) throw new AppError('IDEMPOTENCY_KEY_INVALID');
    const key = params.key;
    const hash = requestHash(params.route, params.payload);
    const where = {
      workspaceId_actorId_route_key: {
        workspaceId: params.user.workspaceId,
        actorId: params.user.id,
        route: params.route,
        key,
      },
    };

    try {
      return await runInTransaction(this.prisma, async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        const inserted = await tx.idempotencyRequest.createMany({
          data: [{ ...where.workspaceId_actorId_route_key, requestHash: hash }],
          skipDuplicates: true,
        });

        if (inserted.count === 0) {
          const existing = await tx.idempotencyRequest.findUniqueOrThrow({ where });
          if (existing.requestHash !== hash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
          if (existing.status !== 'DONE') throw new AppError('REQUEST_IN_PROGRESS');
          return {
            status: existing.responseStatus ?? 200,
            body: existing.responseBody as T,
            replayed: true,
          };
        }

        const result = await fn(tx);
        const status = params.successStatus ?? 200;
        await tx.idempotencyRequest.update({
          where,
          data: {
            status: 'DONE',
            responseStatus: status,
            responseBody: JSON.parse(JSON.stringify(result.body ?? null)) as Prisma.InputJsonValue,
            resultReference: result.resultReference ?? null,
          },
        });
        return { status, body: result.body, replayed: false };
      });
    } catch (error) {
      if (isLockTimeout(error)) throw new AppError('REQUEST_IN_PROGRESS');
      throw error;
    }
  }
}

function isLockTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; meta?: { code?: unknown }; originalCode?: unknown; cause?: unknown; message?: unknown };
    if ([e.code, e.meta?.code, e.originalCode].includes('55P03')) return true;
    if (typeof e.message === 'string' && e.message.includes('lock timeout')) return true;
    current = e.cause;
  }
  return false;
}
