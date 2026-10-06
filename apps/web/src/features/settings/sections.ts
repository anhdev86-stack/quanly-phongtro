import type { PermissionCode } from '@ql-tro/shared';
import type { LucideIcon } from 'lucide-react';

/** Các mục cấu hình bổ sung theo phase (tài khoản nhận tiền, nhắc đóng tiền, chính sách tính phí…). */
export const SETTINGS_SECTIONS: { href: string; title: string; description: string; icon: LucideIcon; perm: PermissionCode }[] = [];
