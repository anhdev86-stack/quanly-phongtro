import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';

export const API_PREFIX = 'api/v1';

/** Cấu hình dùng chung cho main.ts và integration test, để test chạy đúng như production. */
export function configureApp(app: NestExpressApplication, options: { swagger?: boolean } = {}): void {
  app.useLogger(app.get(Logger));
  // API nằm sau Next.js rewrite (dev) hoặc Caddy (production): chỉ tin proxy được cấu hình (mặc định loopback).
  const trustProxy = app.get<AppConfig>(APP_CONFIG).TRUST_PROXY;
  app.set('trust proxy', trustProxy.split(',').map((s) => s.trim()));
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (options.swagger) {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, () => buildOpenApiDocument(app), {
      jsonDocumentUrl: `${API_PREFIX}/docs-json`,
    });
  }
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('QL Trọ API')
    .setDescription(
      'API phần mềm quản lý nhà trọ. Xác thực bằng cookie HttpOnly; mọi request thay đổi dữ liệu cần header ' +
        'X-CSRF-Token khớp cookie qt_csrf. `x-permissions` liệt kê quyền cần có; `x-public` là endpoint không cần đăng nhập.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('qt_access')
    .build();
  return SwaggerModule.createDocument(app, config);
}
