import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { COOKIE_NAMES, CSRF_HEADER } from '@ql-tro/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { APP_CONFIG, type AppConfig, parseEnv } from '../../src/config/env.js';
import { CLOCK, FixedClock } from '../../src/infrastructure/clock/clock.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { LoginRateLimiter } from '../../src/modules/auth/login-rate-limiter.js';
import { SEED_USERS, seedFoundation } from '../../prisma/seed/foundation.js';
import { assertTestDatabase } from './global-setup.js';
import { ProbeModule } from './probe.module.js';

export const TEST_PASSWORDS = { owner: 'test-owner-password', staff: 'test-staff-password' } as const;
export const DEFAULT_TEST_INSTANT = '2026-10-06T03:00:00.000Z';

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  clock: FixedClock;
  limiter: LoginRateLimiter;
  server: Parameters<typeof request>[0];
  close: () => Promise<void>;
}

/** `config`: ghi đè vài biến môi trường cho app này (VD chạy thử chế độ live của tích hợp ngân hàng). */
export async function createTestApp(options: { config?: Partial<AppConfig> } = {}): Promise<TestApp> {
  const clock = new FixedClock(DEFAULT_TEST_INSTANT);
  let builder = Test.createTestingModule({ imports: [AppModule, ProbeModule] })
    .overrideProvider(CLOCK)
    .useValue(clock);
  if (options.config) builder = builder.overrideProvider(APP_CONFIG).useValue({ ...parseEnv(), ...options.config });
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, { swagger: true });
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    clock,
    limiter: app.get(LoginRateLimiter),
    server: app.getHttpServer(),
    close: () => app.close(),
  };
}

/** Xóa sạch dữ liệu (giữ bảng migration) rồi seed nền tảng với mật khẩu test. */
export async function resetDatabase(t: TestApp): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL);
  const tables = await t.prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    await t.prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  await seedFoundation(t.prisma, TEST_PASSWORDS);
  t.limiter.reset();
  t.clock.set(DEFAULT_TEST_INSTANT);
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  setCookies: string[];
}

export function getSetCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
}

export function cookieValue(setCookies: string[], name: string): string | undefined {
  const line = setCookies.find((c) => c.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

export async function login(t: TestApp, who: keyof typeof SEED_USERS): Promise<Session> {
  const user = SEED_USERS[who];
  const password = user.role === 'OWNER' ? TEST_PASSWORDS.owner : TEST_PASSWORDS.staff;
  const agent = request.agent(t.server);
  const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password });
  if (res.status !== 200) throw new Error(`Đăng nhập ${who} thất bại: ${res.status} ${JSON.stringify(res.body)}`);
  const setCookies = getSetCookies(res);
  const csrf = cookieValue(setCookies, COOKIE_NAMES.CSRF);
  if (!csrf) throw new Error('Không nhận được cookie CSRF');
  return { agent, csrf, setCookies };
}

export { CSRF_HEADER, COOKIE_NAMES, SEED_USERS };
