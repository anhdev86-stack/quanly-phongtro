import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, LoginRateLimiter, AuthGuard],
  exports: [AuthService, TokenService, LoginRateLimiter, AuthGuard],
})
export class AuthModule {}
