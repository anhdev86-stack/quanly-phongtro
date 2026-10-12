import { describe, expect, it } from 'vitest';
import { maskPublicToken } from '../infrastructure/logging/logging.module.js';
import { parseEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_ACCESS_SECRET: 'x'.repeat(40) };

describe('cấu hình môi trường (Phase 9 — rà soát bảo mật)', () => {
  it('dev có mặc định an toàn: chỉ tin proxy loopback, job nhắc bật, chưa có khóa Zalo/SMS', () => {
    const env = parseEnv({ ...base });
    expect(env).toMatchObject({ NODE_ENV: 'development', TRUST_PROXY: 'loopback', COOKIE_SECURE: false, REMINDER_JOB_ENABLED: true });
    expect(env.ZALO_ZNS_ACCESS_TOKEN).toBeUndefined();
  });

  it('khóa Zalo/SMS để trống (docker compose truyền chuỗi rỗng) coi như chưa cấu hình', () => {
    const env = parseEnv({ ...base, ZALO_ZNS_ACCESS_TOKEN: '', ZALO_ZNS_TEMPLATE_ID: '', SMS_API_URL: '', SMS_API_KEY: '', SMS_BRANDNAME: '' });
    expect([env.ZALO_ZNS_ACCESS_TOKEN, env.SMS_API_URL, env.SMS_API_KEY]).toEqual([undefined, undefined, undefined]);
    expect(() => parseEnv({ ...base, SMS_API_URL: 'không-phải-url' })).toThrow(/SMS_API_URL/);
  });

  it('production bắt buộc secret thật, cookie Secure và link https; lỗi không in giá trị bí mật', () => {
    const run = (extra: Record<string, string>) => () => parseEnv({ ...base, NODE_ENV: 'production', ...extra });
    expect(run({ JWT_ACCESS_SECRET: 'dev-only-secret-dev-only-secret-0000', COOKIE_SECURE: 'true', PUBLIC_BASE_URL: 'https://tro.example' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(run({ COOKIE_SECURE: 'false', PUBLIC_BASE_URL: 'https://tro.example' })).toThrow(/COOKIE_SECURE/);
    expect(run({ COOKIE_SECURE: 'true', PUBLIC_BASE_URL: 'http://tro.example' })).toThrow(/PUBLIC_BASE_URL/);
    expect(run({ COOKIE_SECURE: 'true', PUBLIC_BASE_URL: 'https://tro.example', TRUST_PROXY: 'loopback, uniquelocal' })()).toMatchObject({ NODE_ENV: 'production' });
    try {
      parseEnv({ ...base, JWT_ACCESS_SECRET: 'short-secret-value' });
    } catch (e) {
      expect(String(e)).not.toContain('short-secret-value');
    }
  });

  it('D-047: tích hợp ngân hàng — mặc định tắt; mock/test/live thiếu cấu hình thì dừng khởi động, không tự chuyển sang mock', () => {
    expect(parseEnv({ ...base }).BANK_INTEGRATION_MODE).toBe('off');
    const key = 'webhook-key-0123456789';
    expect(parseEnv({ ...base, BANK_INTEGRATION_MODE: 'mock', BANK_PROVIDER: 'mock', BANK_WEBHOOK_API_KEY: key })).toMatchObject({ BANK_INTEGRATION_MODE: 'mock' });
    expect(() => parseEnv({ ...base, BANK_INTEGRATION_MODE: 'mock', BANK_PROVIDER: 'mock' })).toThrow(/BANK_WEBHOOK_API_KEY/);
    expect(() => parseEnv({ ...base, BANK_INTEGRATION_MODE: 'mock', BANK_PROVIDER: 'sepay', BANK_WEBHOOK_API_KEY: key })).toThrow(/BANK_PROVIDER/);
    expect(() => parseEnv({ ...base, BANK_INTEGRATION_MODE: 'live', BANK_PROVIDER: 'mock', BANK_WEBHOOK_API_KEY: key })).toThrow(/mock/);
    expect(() => parseEnv({ ...base, BANK_INTEGRATION_MODE: 'live', BANK_PROVIDER: 'sepay', BANK_WEBHOOK_API_KEY: key })).toThrow(/SEPAY_API_TOKEN/);
    expect(() => parseEnv({ ...base, BANK_INTEGRATION_MODE: 'test' })).toThrow(/BANK_PROVIDER/);
    expect(parseEnv({ ...base, BANK_INTEGRATION_MODE: 'live', BANK_PROVIDER: 'sepay', BANK_WEBHOOK_API_KEY: key, SEPAY_API_TOKEN: 'sepay-token-0123456789' })).toMatchObject({ BANK_INTEGRATION_MODE: 'live' });
  });

  it('log không chứa token của link xem thông báo', () => {
    expect(maskPublicToken('/api/v1/public/invoices/AbC123_-xyz?x=1')).toBe('/api/v1/public/invoices/[REDACTED]?x=1');
    expect(maskPublicToken('/api/v1/invoices/123')).toBe('/api/v1/invoices/123');
  });
});
