import { defineConfig, devices } from '@playwright/test';
import '../e2e-env'; // nạp .env (mật khẩu tài khoản seed)

/**
 * Vòng demo có ảnh chụp từng bước, chạy trên bản demo (database ql_tro_demo) đang chạy sẵn:
 *   web http://127.0.0.1:3200 → api :4200. Không dựng lại database, không khởi động server.
 * Dựng lại dữ liệu demo trước khi chạy: node apps/api/prisma/tools/demo-utilities.mjs reset
 * Chạy: pnpm --filter @ql-tro/e2e exec playwright test -c demo/playwright.demo.config.ts
 * Ảnh: e2e/demo/screenshots/*.png
 */
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: '.',
  testMatch: /walkthrough\.spec\.ts/,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.DEMO_WEB_URL ?? 'http://127.0.0.1:3200',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    viewport: { width: 1366, height: 900 },
  },
  projects: [{ name: 'demo', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 }, channel: channel === 'chromium' ? undefined : channel } }],
});
