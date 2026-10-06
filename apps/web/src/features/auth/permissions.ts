'use client';

import type { PermissionCode } from '@ql-tro/shared';
import { useMe } from './api';

/** Kiểm tra quyền để ẩn/hiện nút. Backend vẫn là nơi enforce (MASTER_PLAN 11.2). */
export function useCan() {
  const { data } = useMe();
  const set = new Set(data?.permissions ?? []);
  return (...perms: PermissionCode[]) => perms.every((p) => set.has(p));
}
