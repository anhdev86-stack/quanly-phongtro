import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env'), override: false, quiet: true });

/**
 * E2E chạy trên stack dev thật: web (3000) → rewrite /api → api (4000) → PostgreSQL dev đã seed.
 * Trình duyệt: mặc định Microsoft Edge có sẵn trên Windows (không cần tải Chromium).
 * Đặt E2E_BROWSER_CHANNEL=chromium (và chạy `pnpm exec playwright install chromium`) nếu máy không có Edge.
 */
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: channel === 'chromium' ? undefined : channel } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: channel === 'chromium' ? undefined : channel } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @ql-tro/api dev',
      url: 'http://localhost:4000/api/v1/health/ready',
      cwd: '..',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @ql-tro/web dev',
      url: 'http://localhost:3000/login',
      cwd: '..',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
