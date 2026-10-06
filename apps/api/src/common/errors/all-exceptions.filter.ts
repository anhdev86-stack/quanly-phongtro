import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ERROR_MESSAGES, type ErrorCode, type ErrorEnvelope } from '@ql-tro/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { isRetryableTransactionError } from '../../infrastructure/prisma/transaction.js';
import { PG, pgErrorCode } from '../db/pg-errors.js';
import { AppError } from './app-error.js';
import { zodFieldErrors } from '../validation/zod-field-errors.js';

const HTTP_STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'ROUTE_NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_FAILED',
  422: 'BUSINESS_RULE_VIOLATION',
  429: 'TOO_MANY_ATTEMPTS',
  503: 'SERVICE_UNAVAILABLE',
};

interface Mapped {
  status: number;
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/** Chuyển mọi lỗi thành error envelope `{ code, message, field_errors?, request_id }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const mapped = this.map(exception);

    if (mapped.status >= 500) {
      this.logger.error({ err: exception, requestId: req.id }, 'Unhandled error');
    }

    const body: ErrorEnvelope = {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.fieldErrors ? { field_errors: mapped.fieldErrors } : {}),
      request_id: String(req.id ?? ''),
    };
    res.status(mapped.status).json(body);
  }

  private map(exception: unknown): Mapped {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        ...(exception.fieldErrors ? { fieldErrors: exception.fieldErrors } : {}),
      };
    }
    if (exception instanceof ZodError) {
      return {
        status: 400,
        code: 'VALIDATION_FAILED',
        message: ERROR_MESSAGES.VALIDATION_FAILED,
        fieldErrors: zodFieldErrors(exception),
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return this.simple(409, 'CONFLICT');
      if (exception.code === 'P2025') return this.simple(404, 'NOT_FOUND');
    }
    if (isRetryableTransactionError(exception)) return this.simple(409, 'CONFLICT');
    // Ràng buộc database là lớp bảo vệ cuối: vi phạm vẫn trả lỗi có mã, không thành 500.
    const sqlState = pgErrorCode(exception);
    if (sqlState === PG.UNIQUE_VIOLATION || sqlState === PG.EXCLUSION_VIOLATION) return this.simple(409, 'CONFLICT');
    if (sqlState === PG.CHECK_VIOLATION || sqlState === PG.FOREIGN_KEY_VIOLATION) {
      return this.simple(422, 'BUSINESS_RULE_VIOLATION');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return this.simple(status, HTTP_STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'));
    }
    return this.simple(500, 'INTERNAL_ERROR');
  }

  private simple(status: number, code: ErrorCode): Mapped {
    return { status, code, message: ERROR_MESSAGES[code] };
  }
}
