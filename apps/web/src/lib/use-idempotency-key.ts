'use client';

import { useCallback, useState } from 'react';
import { newIdempotencyKey } from './api-client';

/**
 * Một Idempotency-Key cho mỗi lần người dùng thực hiện thao tác. Gửi lại (do lỗi mạng) dùng cùng key để server trả kết quả cũ;
 * sau khi thành công thì gọi renew() để lần thao tác sau có key mới (MASTER_PLAN 9.5).
 */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState(newIdempotencyKey);
  const renew = useCallback(() => setKey(newIdempotencyKey()), []);
  return [key, renew];
}
