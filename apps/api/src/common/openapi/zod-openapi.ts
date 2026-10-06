import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import { errorEnvelopeSchema } from '@ql-tro/shared';
import { z, type ZodType } from 'zod';

type SchemaObject = Record<string, unknown>;

/** Chuyển Zod schema sang JSON Schema dạng OpenAPI 3.0 cho Swagger. */
export function zodToOpenApi(schema: ZodType, io: 'input' | 'output' = 'output'): SchemaObject {
  const json = z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' }) as SchemaObject;
  delete json.$schema;
  return json;
}

export function ApiZodBody(schema: ZodType, example?: unknown) {
  return ApiBody({ schema: { ...zodToOpenApi(schema, 'input'), ...(example ? { example } : {}) } as never });
}

export function ApiZodResponse(status: number, schema: ZodType, description: string) {
  return ApiResponse({ status, description, schema: zodToOpenApi(schema) as never });
}

/** Các phản hồi lỗi chuẩn dùng error envelope. */
export function ApiErrorResponses(...statuses: number[]) {
  const descriptions: Record<number, string> = {
    400: 'Dữ liệu không hợp lệ',
    401: 'Chưa đăng nhập',
    403: 'Thiếu quyền hoặc CSRF không hợp lệ',
    404: 'Không tồn tại hoặc ngoài phạm vi',
    409: 'Xung đột',
    422: 'Vi phạm quy tắc nghiệp vụ',
    429: 'Quá nhiều lần thử',
    503: 'Dịch vụ chưa sẵn sàng',
  };
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, description: descriptions[status] ?? 'Lỗi', schema: zodToOpenApi(errorEnvelopeSchema) as never }),
    ),
  );
}
