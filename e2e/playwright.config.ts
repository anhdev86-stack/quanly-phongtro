import { defineConfig, devices } from '@playwright/test';
import { E2E_API_PORT, E2E_DATABASE_URL, E2E_WEB_PORT, ROOT } from './e2e-env';

/**
 * E2E chạy trên một stack riêng, không đụng dữ liệu dev:
 *   web :3100 (Next dev, thư mục build .next-e2e) → rewrite /api → api :4100 (bản build) → PostgreSQL ql_tro_e2e.
 * globalSetup dựng lại database E2E (migrate + xóa sạch + seed) trước mỗi lần chạy.
 * Trình duyệt: Microsoft Edge có sẵn (D-018); đặt E2E_BROWSER_CHANNEL=chromium nếu không có Edge.
 */
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';
const browserChannel = channel === 'chromium' ? undefined : channel;

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  // Chặn treo vô hạn (VD Docker/PostgreSQL tắt giữa chừng): cả lượt chạy tối đa 20 phút, mỗi expect tối đa 10 giây.
  globalTimeout: 20 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${E2E_WEB_PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: browserChannel } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: browserChannel } },
  ],
  webServer: [
    {
      // Bản build được tạo sẵn bởi script test:e2e (prisma generate bị treo khi chạy bên trong webServer).
      command: 'node apps/api/dist/main.js',
      // live (không phải ready): webServer khởi động trước globalSetup, lúc đó database E2E có thể chưa tồn tại.
      url: `http://localhost:${E2E_API_PORT}/api/v1/health/live`,
      cwd: ROOT,
      // Kho tệp E2E riêng (apps/api/.data/files-e2e), không lẫn tệp dev.
      env: { DATABASE_URL: E2E_DATABASE_URL, API_PORT: String(E2E_API_PORT), NODE_ENV: 'test', LOG_LEVEL: 'warn', STORAGE_DIR: '.data/files-e2e' },
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: `pnpm --filter @ql-tro/web exec next dev --port ${E2E_WEB_PORT}`,
      url: `http://localhost:${E2E_WEB_PORT}/login`,
      cwd: ROOT,
      env: { API_INTERNAL_URL: `http://localhost:${E2E_API_PORT}`, NEXT_DIST_DIR: '.next-e2e' },
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
