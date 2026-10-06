import { Injectable, type PipeTransform } from '@nestjs/common';
import { ERROR_MESSAGES } from '@ql-tro/shared';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error.js';
import { zodFieldErrors } from './zod-field-errors.js';

/** Validate body/query bằng Zod schema dùng chung từ @ql-tro/shared. */
@Injectable()
export class ZodPipe<T extends ZodType> implements PipeTransform<unknown, T['_output']> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): T['_output'] {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppError('VALIDATION_FAILED', ERROR_MESSAGES.VALIDATION_FAILED, zodFieldErrors(result.error));
    }
    return result.data;
  }
}
