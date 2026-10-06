import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CsrfGuard } from './common/auth/csrf.guard.js';
import { PermissionsGuard } from './common/auth/permissions.guard.js';
import { ConfigModule } from './config/config.module.js';
import { ClockModule } from './infrastructure/clock/clock.module.js';
import { LoggingModule } from './infrastructure/logging/logging.module.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdempotencyModule } from './modules/idempotency/idempotency.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ClockModule,
    PrismaModule,
    AuditModule,
    AccessModule,
    IdempotencyModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    // Thứ tự đăng ký = thứ tự chạy: CSRF → xác thực → quyền.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
