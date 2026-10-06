import { describe, expect, it } from 'vitest';
import { businessDateSchema, moneyVndSchema } from './primitives.js';
import { loginRequestSchema } from './auth.js';
import { ROLE_PRESETS, ALL_PERMISSIONS, PERMISSIONS } from './permissions.js';

describe('moneyVndSchema', () => {
  it('chấp nhận số nguyên không âm dạng chuỗi', () => {
    expect(moneyVndSchema.parse('0')).toBe('0');
    expect(moneyVndSchema.parse('3500000')).toBe('3500000');
  });

  it.each(['-1', '01', '1.5', '1e6', '', ' 1'])('từ chối %j', (value) => {
    expect(moneyVndSchema.safeParse(value).success).toBe(false);
  });
});

describe('businessDateSchema', () => {
  it('chấp nhận ngày có thật, kể cả 29/02 năm nhuận', () => {
    expect(businessDateSchema.parse('2028-02-29')).toBe('2028-02-29');
  });

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '06/10/2026'])('từ chối %j', (value) => {
    expect(businessDateSchema.safeParse(value).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('chuẩn hóa email về chữ thường', () => {
    expect(loginRequestSchema.parse({ email: ' Owner@Example.Test ', password: 'x' }).email).toBe('owner@example.test');
  });

  it('từ chối field ngoài whitelist', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.test', password: 'x', role: 'OWNER' }).success).toBe(false);
  });
});

describe('ROLE_PRESETS', () => {
  it('STAFF không có quyền đảo, hoàn tiền, duyệt hay xem toàn bộ tòa', () => {
    const staff = ROLE_PRESETS.STAFF.permissions;
    for (const forbidden of [
      PERMISSIONS.WORKSPACE_ALL_BUILDINGS,
      PERMISSIONS.FINANCE_REVERSE,
      PERMISSIONS.DEPOSIT_REFUND,
      PERMISSIONS.CREDIT_REFUND,
      PERMISSIONS.SETTLEMENT_APPROVE,
      PERMISSIONS.HOLDING_FORFEIT,
      PERMISSIONS.SENSITIVE_DATA_VIEW,
      PERMISSIONS.USERS_MANAGE,
    ]) {
      expect(staff).not.toContain(forbidden);
    }
  });

  it('OWNER có toàn bộ quyền, mã quyền không trùng', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ROLE_PRESETS.OWNER.permissions).toEqual(ALL_PERMISSIONS);
  });
});
