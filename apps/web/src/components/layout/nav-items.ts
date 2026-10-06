import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  Gauge,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  Settings,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Phase triển khai mục này (8.5 = Phase 8B); chưa có thì hiển thị mờ, không dẫn tới trang giả. */
  availableFromPhase: number;
  /** Mục chỉ hiện khi người dùng có ít nhất một quyền trong danh sách. */
  anyPermission?: string[];
}

/** Sidebar theo MASTER_PLAN mục 12. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Tổng quan', href: '/', icon: LayoutDashboard, availableFromPhase: 0 },
  { label: 'Tòa/khu & Phòng', href: '/rooms', icon: Building2, availableFromPhase: 1 },
  { label: 'Giữ phòng', href: '/reservations', icon: CalendarClock, availableFromPhase: 1 },
  { label: 'Người thuê', href: '/tenants', icon: Users, availableFromPhase: 2 },
  { label: 'Lần thuê & Hợp đồng', href: '/tenancies', icon: KeyRound, availableFromPhase: 2 },
  { label: 'Điện nước', href: '/readings', icon: Gauge, availableFromPhase: 4 },
  { label: 'Dịch vụ', href: '/services', icon: Wrench, availableFromPhase: 4 },
  { label: 'Thông báo tiền phòng', href: '/invoices', icon: FileText, availableFromPhase: 5 },
  { label: 'Thu tiền & Công nợ', href: '/payments', icon: HandCoins, availableFromPhase: 6 },
  { label: 'Cọc & Trả phòng', href: '/move-outs', icon: Receipt, availableFromPhase: 7 },
  { label: 'Báo cáo', href: '/reports', icon: BarChart3, availableFromPhase: 8, anyPermission: ['reports.view'] },
  { label: 'Nhắc đóng tiền', href: '/reminders', icon: Bell, availableFromPhase: 8.5 },
  { label: 'Chi phí', href: '/expenses', icon: Wallet, availableFromPhase: 12, anyPermission: ['reports.view'] },
  { label: 'Bảo trì', href: '/maintenance', icon: Wrench, availableFromPhase: 13 },
  { label: 'Nhật ký', href: '/audit', icon: ClipboardList, availableFromPhase: 10, anyPermission: ['audit.view'] },
  { label: 'Cấu hình', href: '/settings', icon: Settings, availableFromPhase: 1 },
];

/** Phase đã hoàn thành của bản build hiện tại. */
export const CURRENT_PHASE = 8;
