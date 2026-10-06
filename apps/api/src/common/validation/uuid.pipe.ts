import { Injectable, type PipeTransform } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tham số đường dẫn phải là UUID; sai định dạng trả 400 thay vì để database báo lỗi. */
@Injectable()
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value)) {
      throw new AppError('VALIDATION_FAILED', undefined, { id: ['Mã không hợp lệ.'] });
    }
    return value.toLowerCase();
  }
}
