import { PERMISSIONS, type PermissionCode } from '@ql-tro/shared';
import { BellRing, Calculator, Landmark, type LucideIcon } from 'lucide-react';

/** Các mục cấu hình bổ sung theo phase (tài khoản nhận tiền, nhắc đóng tiền, chính sách tính phí…). */
export const SETTINGS_SECTIONS: { href: string; title: string; description: string; icon: LucideIcon; perm: PermissionCode }[] = [
  {
    href: '/settings/billing',
    title: 'Chính sách tính phí',
    description: 'Chia theo ngày, làm tròn, ngày đến hạn, thu trước/thu sau mặc định.',
    icon: Calculator,
    perm: PERMISSIONS.SETTINGS_MANAGE,
  },
  {
    href: '/settings/payment-account',
    title: 'Tài khoản nhận tiền (VietQR)',
    description: 'Ngân hàng, số tài khoản, chủ tài khoản dùng cho mã QR trên thông báo.',
    icon: Landmark,
    perm: PERMISSIONS.PAYMENT_ACCOUNTS_MANAGE,
  },
  {
    href: '/settings/reminders',
    title: 'Nhắc đóng tiền (Zalo/SMS)',
    description: 'Bật/tắt, kênh gửi, mốc nhắc, giờ gửi và giờ yên lặng.',
    icon: BellRing,
    perm: PERMISSIONS.REMINDERS_VIEW,
  },
];
