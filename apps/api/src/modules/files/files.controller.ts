import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { FILE_MAX_BYTES, fileArchiveSchema, fileListQuerySchema, fileSchema, fileUploadFieldsSchema } from '@ql-tro/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { ApiErrorResponses, ApiZodBody, ApiZodResponse, zodToOpenApi } from '../../common/openapi/zod-openapi.js';
import { UuidPipe } from '../../common/validation/uuid.pipe.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { FilesService } from './files.service.js';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  // Quyền phụ thuộc loại đối tượng sở hữu (tenants.manage, contracts.manage, …; giấy tờ tùy thân cần thêm files.identity.view) — kiểm tra trong service.
  @RequirePermissions()
  // Không khai báo dest/storage: multer giữ tệp trong bộ nhớ (≤ 10 MB), service kiểm tra rồi mới ghi vào kho.
  // defParamCharset utf8: tên tệp tiếng Việt (trình duyệt gửi UTF-8 không khai báo charset).
  @UseInterceptors(FileInterceptor('file', { defParamCharset: 'utf8', limits: { fileSize: FILE_MAX_BYTES, files: 1, fields: 5 } } as never))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'owner_type', 'owner_id', 'category'],
      properties: { file: { type: 'string', format: 'binary' }, ...(zodToOpenApi(fileUploadFieldsSchema, 'input') as { properties: Record<string, unknown> }).properties },
    },
  })
  @ApiOperation({ summary: 'Tải lên tệp riêng tư (ảnh JPG/PNG/WEBP hoặc PDF, ≤ 10 MB) gắn với một đối tượng' })
  @ApiZodResponse(201, fileSchema, 'Đã lưu')
  @ApiErrorResponses(400, 401, 403, 404)
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined, @Body(new ZodPipe(fileUploadFieldsSchema)) body: z.output<typeof fileUploadFieldsSchema>) {
    return this.files.upload(user, body, file);
  }

  @Get()
  @RequirePermissions()
  @ApiOperation({ summary: 'Tệp của một đối tượng (ẩn giấy tờ tùy thân với người không có files.identity.view)' })
  @ApiZodResponse(200, z.array(fileSchema), 'Danh sách')
  @ApiErrorResponses(400, 401, 403, 404)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(fileListQuerySchema)) q: z.output<typeof fileListQuerySchema>) {
    return this.files.list(user, q);
  }

  @Get(':id/content')
  @RequirePermissions()
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  @ApiOperation({ summary: 'Tải nội dung tệp (kiểm tra quyền mỗi lần; xem giấy tờ tùy thân được ghi nhật ký)' })
  @ApiZodResponse(200, z.string(), 'Nội dung tệp')
  @ApiErrorResponses(401, 403, 404)
  async content(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.files.content(user, id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename="file"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Tệp mở trực tiếp trong trình duyệt không chạy được script (PDF/ảnh độc hại).
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'");
    return new StreamableFile(f.data);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions()
  @ApiOperation({ summary: 'Lưu trữ (ẩn) tệp, cần lý do; không xóa vĩnh viễn' })
  @ApiZodBody(fileArchiveSchema)
  @ApiZodResponse(200, fileSchema, 'Đã lưu trữ')
  @ApiErrorResponses(400, 401, 403, 404, 422)
  archive(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body(new ZodPipe(fileArchiveSchema)) body: z.output<typeof fileArchiveSchema>) {
    return this.files.archive(user, id, body.reason);
  }
}
