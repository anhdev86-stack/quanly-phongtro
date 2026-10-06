import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Observable } from 'rxjs';

interface RequestContext {
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** request_id của request hiện tại (dùng cho audit), undefined ngoài phạm vi request. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Gắn request_id vào AsyncLocalStorage cho toàn bộ xử lý của handler. */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx: RequestContext = { requestId: req?.id === undefined ? undefined : String(req.id) };
    return new Observable((subscriber) => storage.run(ctx, () => next.handle().subscribe(subscriber)));
  }
}
