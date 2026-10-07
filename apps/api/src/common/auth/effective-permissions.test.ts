import { describe, expect, it } from 'vitest';
import { effectivePermissions } from './effective-permissions.js';

describe('quyền hiệu lực theo người dùng', () => {
  it('vai trò ∪ cấp thêm − thu hồi', () => {
    const p = effectivePermissions(['invoices.view', 'payments.record'], [
      { code: 'finance.reverse', granted: true },
      { code: 'payments.record', granted: false },
    ]);
    expect([...p].sort()).toEqual(['finance.reverse', 'invoices.view']);
  });
});
