import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  Gauge,
  Hammer,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Plug,
  Receipt,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Phase triển khai mục này (8.5 = Phase 8B); chưa có thì hiển thị mờ, không dẫn tới trang giả. */
  availableFromPhase: number;
  /** Mục chỉ hiện khi người dùng có ít nhất một quyền trong danh sách. */
  anyPermission?: string[];
  /** Nhóm hiển thị trên sidebar. */
  group: NavGroup;
}

export type NavGroup = 'main' | 'operations' | 'finance' | 'system';
export const NAV_GROUP_LABELS: Record<NavGroup, string | null> = { main: null, operations: 'Vận hành', finance: 'Tài chính', system: 'Hệ thống' };

/** Sidebar theo MASTER_PLAN mục 12. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Tổng quan', href: '/', icon: LayoutDashboard, availableFromPhase: 0, group: 'main' },
  { label: 'Tòa/khu & Phòng', href: '/rooms', icon: Building2, availableFromPhase: 1, group: 'operations' },
  { label: 'Giữ phòng', href: '/reservations', icon: CalendarClock, availableFromPhase: 1, group: 'operations' },
  { label: 'Người thuê', href: '/tenants', icon: Users, availableFromPhase: 2, group: 'operations' },
  { label: 'Lần thuê & Hợp đồng', href: '/tenancies', icon: KeyRound, availableFromPhase: 2, group: 'operations' },
  { label: 'Điện nước', href: '/readings', icon: Gauge, availableFromPhase: 4, group: 'operations' },
  { label: 'Dịch vụ', href: '/services', icon: Plug, availableFromPhase: 4, group: 'operations' },
  { label: 'Bảo trì', href: '/maintenance', icon: Hammer, availableFromPhase: 13, anyPermission: ['maintenance.view'], group: 'operations' },
  { label: 'Thông báo tiền phòng', href: '/invoices', icon: FileText, availableFromPhase: 5, group: 'finance' },
  { label: 'Thu tiền & Công nợ', href: '/payments', icon: HandCoins, availableFromPhase: 6, group: 'finance' },
  { label: 'Cọc & Trả phòng', href: '/move-outs', icon: Receipt, availableFromPhase: 7, group: 'finance' },
  { label: 'Chi phí', href: '/expenses', icon: Wallet, availableFromPhase: 12, anyPermission: ['expenses.view'], group: 'finance' },
  { label: 'Báo cáo', href: '/reports', icon: BarChart3, availableFromPhase: 8, anyPermission: ['reports.view'], group: 'finance' },
  { label: 'Nhắc đóng tiền', href: '/reminders', icon: Bell, availableFromPhase: 8.5, anyPermission: ['reminders.view'], group: 'finance' },
  { label: 'Nhật ký', href: '/audit', icon: ClipboardList, availableFromPhase: 10, anyPermission: ['audit.view', 'audit.view_operations', 'audit.view_finance'], group: 'system' },
  { label: 'Cấu hình', href: '/settings', icon: Settings, availableFromPhase: 1, group: 'system' },
];

/** Phase đã hoàn thành của bản build hiện tại. */
export const CURRENT_PHASE = 14;
