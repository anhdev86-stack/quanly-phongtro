import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { oxc } from './vitest.config.mjs';

// .env ở gốc repo; không ghi đè biến đã có (CI tự đặt).
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), override: false, quiet: true });
const testDatabaseUrl = process.env.DATABASE_URL_TEST;

export default defineConfig({
  oxc,
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/helpers/global-setup.ts'],
    // Dùng chung một database test: chạy tuần tự từng file để không giẫm dữ liệu của nhau.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      REMINDER_JOB_ENABLED: 'false',
      // D-047: tích hợp ngân hàng chạy bằng nhà cung cấp giả lập (không gọi dịch vụ ngoài).
      BANK_INTEGRATION_MODE: 'mock',
      BANK_PROVIDER: 'mock',
      BANK_WEBHOOK_API_KEY: 'test-bank-webhook-key-0123456789',
      // Kho tệp của test: thư mục tạm riêng, không đụng dữ liệu dev.
      STORAGE_DIR: path.join(os.tmpdir(), 'ql-tro-test-files'),
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}),
    },
  },
});
