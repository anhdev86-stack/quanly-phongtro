import { describe, expect, it } from 'vitest';
import { maskIdentityNumber, REDACTED, redact } from './redact.js';

describe('redact', () => {
  it('che mật khẩu, token, hash, cookie ở mọi độ sâu', () => {
    const result = redact({
      email: 'a@b.test',
      password: 'secret',
      passwordHash: '$argon2id$...',
      nested: { refreshToken: 'abc', list: [{ access_token: 'x', ok: 1 }] },
      headers: { cookie: 'qt_access=...' },
    });
    expect(result).toEqual({
      email: 'a@b.test',
      password: REDACTED,
      passwordHash: REDACTED,
      nested: { refreshToken: REDACTED, list: [{ access_token: REDACTED, ok: 1 }] },
      headers: { cookie: REDACTED },
    });
  });

  it('chỉ giữ 4 số cuối của CCCD và che tệp CCCD', () => {
    expect(redact({ identity_number: '079123456789', identityImageFileId: 'f1' })).toEqual({
      identity_number: '********6789',
      identityImageFileId: REDACTED,
    });
    expect(maskIdentityNumber('123')).toBe('****');
  });

  it('chuyển BigInt và Date về chuỗi để lưu JSON', () => {
    expect(redact({ amount: 3500000n, at: new Date('2026-10-06T00:00:00Z') })).toEqual({
      amount: '3500000',
      at: '2026-10-06T00:00:00.000Z',
    });
  });
});
