/**
 * Danh mục permission dạng `module.action` (MASTER_PLAN mục 11).
 * Seed đồng bộ bảng `permissions` từ danh mục này.
 */
export const PERMISSIONS = {
  // Phạm vi: có quyền này thì thấy mọi tòa trong workspace (OWNER).
  WORKSPACE_ALL_BUILDINGS: 'workspace.all_buildings',

  BUILDINGS_VIEW: 'buildings.view',
  BUILDINGS_MANAGE: 'buildings.manage',
  ROOMS_VIEW: 'rooms.view',
  ROOMS_MANAGE: 'rooms.manage',
  RESERVATIONS_MANAGE: 'reservations.manage',
  HOLDING_RECORD: 'holding.record',
  HOLDING_REFUND: 'holding.refund',
  HOLDING_FORFEIT: 'holding.forfeit',

  TENANTS_VIEW: 'tenants.view',
  TENANTS_MANAGE: 'tenants.manage',
  SENSITIVE_DATA_VIEW: 'sensitive_data.view',
  FILES_IDENTITY_VIEW: 'files.identity.view',
  TENANCIES_MOVE_IN: 'tenancies.move_in',

  CONTRACTS_VIEW: 'contracts.view',
  CONTRACTS_MANAGE: 'contracts.manage',
  CONTRACTS_CANCEL_SIGNED: 'contracts.cancel_signed',

  SERVICES_MANAGE: 'services.manage',
  METER_PRICES_MANAGE: 'meter_prices.manage',
  METER_READINGS_RECORD: 'meter_readings.record',

  INVOICES_VIEW: 'invoices.view',
  BILLING_GENERATE: 'billing.generate',
  INVOICES_PUBLISH: 'invoices.publish',
  INVOICES_ADJUST: 'invoices.adjust',
  INVOICES_SHARE: 'invoices.share',
  PAYMENT_ACCOUNTS_MANAGE: 'payment_accounts.manage',
  PAYMENTS_RECORD: 'payments.record',
  FINANCE_REVERSE: 'finance.reverse',
  CREDIT_REFUND: 'credit.refund',
  DEPOSIT_RECORD: 'deposit.record',
  DEPOSIT_REFUND: 'deposit.refund',

  SETTLEMENTS_VIEW: 'settlements.view',
  SETTLEMENT_MANAGE: 'settlement.manage',
  SETTLEMENT_APPROVE: 'settlement.approve',
  PERIOD_REOPEN: 'period.reopen',

  REPORTS_VIEW: 'reports.view',
  /** V1.1 Phase 12: chi phí vận hành. Đảo chi phí cần finance.reverse. */
  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_RECORD: 'expenses.record',
  REMINDERS_VIEW: 'reminders.view',
  REMINDERS_MANAGE: 'reminders.manage',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  /** Xem toàn bộ nhật ký (chủ trọ). */
  AUDIT_VIEW: 'audit.view',
  /** V1.1: nhật ký vận hành (phòng, giữ chỗ, người thuê, lần thuê, hợp đồng, điện nước) trong tòa được giao. */
  AUDIT_VIEW_OPERATIONS: 'audit.view_operations',
  /** V1.1: nhật ký tài chính (thông báo, thu tiền, cọc, credit, quyết toán, nhắc đóng tiền) trong tòa được giao. */
  AUDIT_VIEW_FINANCE: 'audit.view_finance',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionCode[] = Object.values(PERMISSIONS);

export const ROLE_CODES = {
  OWNER: 'OWNER',
  STAFF: 'STAFF',
  MANAGER: 'MANAGER',
  ACCOUNTANT: 'ACCOUNTANT',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

/**
 * Quyền chỉ chủ trọ có; không cấp riêng cho người dùng khác (tránh tự nâng quyền: người quản lý người dùng có thể tự cấp mọi quyền).
 */
export const OWNER_ONLY_PERMISSIONS: PermissionCode[] = [PERMISSIONS.WORKSPACE_ALL_BUILDINGS, PERMISSIONS.USERS_MANAGE, PERMISSIONS.AUDIT_VIEW];

/** Quyền mặc định của các vai trò (MASTER_PLAN mục 11.2; MANAGER/ACCOUNTANT từ V1.1 — D-036). */
export const ROLE_PRESETS: Record<RoleCode, { name: string; permissions: PermissionCode[] }> = {
  OWNER: {
    name: 'Chủ trọ',
    permissions: ALL_PERMISSIONS,
  },
  STAFF: {
    name: 'Nhân viên',
    permissions: [
      PERMISSIONS.BUILDINGS_VIEW,
      PERMISSIONS.ROOMS_VIEW,
      PERMISSIONS.RESERVATIONS_MANAGE,
      PERMISSIONS.HOLDING_RECORD,
      PERMISSIONS.TENANTS_VIEW,
      PERMISSIONS.CONTRACTS_VIEW,
      PERMISSIONS.METER_READINGS_RECORD,
      PERMISSIONS.INVOICES_VIEW,
      PERMISSIONS.INVOICES_SHARE,
      PERMISSIONS.PAYMENTS_RECORD,
      PERMISSIONS.REMINDERS_VIEW,
      PERMISSIONS.SETTLEMENTS_VIEW,
    ],
  },
  // Vận hành trong tòa được giao: phòng, giữ chỗ, người thuê, nhận phòng, hợp đồng, điện nước; thông báo chỉ xem/tạo nháp.
  MANAGER: {
    name: 'Quản lý',
    permissions: [
      PERMISSIONS.BUILDINGS_VIEW,
      PERMISSIONS.ROOMS_VIEW,
      PERMISSIONS.ROOMS_MANAGE,
      PERMISSIONS.RESERVATIONS_MANAGE,
      PERMISSIONS.HOLDING_RECORD,
      PERMISSIONS.TENANTS_VIEW,
      PERMISSIONS.TENANTS_MANAGE,
      PERMISSIONS.TENANCIES_MOVE_IN,
      PERMISSIONS.DEPOSIT_RECORD,
      PERMISSIONS.CONTRACTS_VIEW,
      PERMISSIONS.CONTRACTS_MANAGE,
      PERMISSIONS.METER_READINGS_RECORD,
      PERMISSIONS.INVOICES_VIEW,
      PERMISSIONS.BILLING_GENERATE,
      PERMISSIONS.INVOICES_SHARE,
      PERMISSIONS.SETTLEMENTS_VIEW,
      PERMISSIONS.SETTLEMENT_MANAGE,
      PERMISSIONS.REMINDERS_VIEW,
      PERMISSIONS.EXPENSES_VIEW,
      PERMISSIONS.AUDIT_VIEW_OPERATIONS,
    ],
  },
  // Tài chính trong tòa được giao: phát hành, điều chỉnh, thu tiền, báo cáo; đảo/hoàn tiền chỉ khi được cấp riêng.
  ACCOUNTANT: {
    name: 'Kế toán',
    permissions: [
      PERMISSIONS.BUILDINGS_VIEW,
      PERMISSIONS.ROOMS_VIEW,
      PERMISSIONS.TENANTS_VIEW,
      PERMISSIONS.CONTRACTS_VIEW,
      PERMISSIONS.INVOICES_VIEW,
      PERMISSIONS.BILLING_GENERATE,
      PERMISSIONS.INVOICES_PUBLISH,
      PERMISSIONS.INVOICES_ADJUST,
      PERMISSIONS.INVOICES_SHARE,
      PERMISSIONS.PAYMENTS_RECORD,
      PERMISSIONS.DEPOSIT_RECORD,
      PERMISSIONS.SETTLEMENTS_VIEW,
      PERMISSIONS.SETTLEMENT_MANAGE,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.REMINDERS_VIEW,
      PERMISSIONS.REMINDERS_MANAGE,
      PERMISSIONS.EXPENSES_VIEW,
      PERMISSIONS.EXPENSES_RECORD,
      PERMISSIONS.AUDIT_VIEW_FINANCE,
    ],
  },
};

/** Nhãn tiếng Việt và nhóm của từng quyền (màn hình phân quyền). */
export const PERMISSION_GROUPS: { label: string; permissions: [PermissionCode, string][] }[] = [
  {
    label: 'Tòa, phòng, giữ chỗ',
    permissions: [
      [PERMISSIONS.WORKSPACE_ALL_BUILDINGS, 'Xem mọi tòa'],
      [PERMISSIONS.BUILDINGS_VIEW, 'Xem tòa'],
      [PERMISSIONS.BUILDINGS_MANAGE, 'Thêm/sửa tòa'],
      [PERMISSIONS.ROOMS_VIEW, 'Xem phòng'],
      [PERMISSIONS.ROOMS_MANAGE, 'Thêm/sửa phòng, trạng thái vận hành'],
      [PERMISSIONS.RESERVATIONS_MANAGE, 'Giữ phòng'],
      [PERMISSIONS.HOLDING_RECORD, 'Ghi nhận tiền giữ chỗ'],
      [PERMISSIONS.HOLDING_REFUND, 'Hoàn tiền giữ chỗ'],
      [PERMISSIONS.HOLDING_FORFEIT, 'Giữ lại tiền giữ chỗ'],
    ],
  },
  {
    label: 'Người thuê, lần thuê, hợp đồng',
    permissions: [
      [PERMISSIONS.TENANTS_VIEW, 'Xem người thuê'],
      [PERMISSIONS.TENANTS_MANAGE, 'Thêm/sửa người thuê, đồng ý nhận tin'],
      [PERMISSIONS.SENSITIVE_DATA_VIEW, 'Xem số CCCD, địa chỉ thường trú'],
      [PERMISSIONS.FILES_IDENTITY_VIEW, 'Xem ảnh giấy tờ'],
      [PERMISSIONS.TENANCIES_MOVE_IN, 'Nhận phòng'],
      [PERMISSIONS.CONTRACTS_VIEW, 'Xem hợp đồng'],
      [PERMISSIONS.CONTRACTS_MANAGE, 'Tạo/ký/gia hạn hợp đồng'],
      [PERMISSIONS.CONTRACTS_CANCEL_SIGNED, 'Hủy hợp đồng đã ký chưa bắt đầu'],
    ],
  },
  {
    label: 'Điện nước, dịch vụ',
    permissions: [
      [PERMISSIONS.SERVICES_MANAGE, 'Quản lý dịch vụ, giá dịch vụ'],
      [PERMISSIONS.METER_PRICES_MANAGE, 'Đặt/thay đổi giá điện nước'],
      [PERMISSIONS.METER_READINGS_RECORD, 'Nhập chỉ số điện nước'],
    ],
  },
  {
    label: 'Thông báo, thu tiền',
    permissions: [
      [PERMISSIONS.INVOICES_VIEW, 'Xem thông báo, công nợ'],
      [PERMISSIONS.BILLING_GENERATE, 'Tạo nháp thông báo'],
      [PERMISSIONS.INVOICES_PUBLISH, 'Phát hành thông báo'],
      [PERMISSIONS.INVOICES_ADJUST, 'Điều chỉnh, cấn trừ credit'],
      [PERMISSIONS.INVOICES_SHARE, 'Tạo link gửi khách'],
      [PERMISSIONS.PAYMENT_ACCOUNTS_MANAGE, 'Tài khoản nhận tiền (VietQR)'],
      [PERMISSIONS.PAYMENTS_RECORD, 'Ghi nhận thu'],
      [PERMISSIONS.FINANCE_REVERSE, 'Đảo phiếu thu/giao dịch'],
      [PERMISSIONS.CREDIT_REFUND, 'Hoàn tiền dư'],
      [PERMISSIONS.DEPOSIT_RECORD, 'Ghi nhận cọc'],
      [PERMISSIONS.DEPOSIT_REFUND, 'Hoàn cọc'],
      [PERMISSIONS.EXPENSES_VIEW, 'Xem chi phí'],
      [PERMISSIONS.EXPENSES_RECORD, 'Ghi chi phí'],
    ],
  },
  {
    label: 'Trả phòng, quyết toán',
    permissions: [
      [PERMISSIONS.SETTLEMENTS_VIEW, 'Xem quyết toán'],
      [PERMISSIONS.SETTLEMENT_MANAGE, 'Báo trả, tạo nháp quyết toán'],
      [PERMISSIONS.SETTLEMENT_APPROVE, 'Duyệt/hoàn tất quyết toán, khấu trừ'],
      [PERMISSIONS.PERIOD_REOPEN, 'Mở lại tháng phát hành'],
    ],
  },
  {
    label: 'Báo cáo, nhắc, nhật ký, hệ thống',
    permissions: [
      [PERMISSIONS.REPORTS_VIEW, 'Xem báo cáo, xuất CSV'],
      [PERMISSIONS.REMINDERS_VIEW, 'Xem nhật ký nhắc đóng tiền'],
      [PERMISSIONS.REMINDERS_MANAGE, 'Cấu hình nhắc, gửi lại'],
      [PERMISSIONS.AUDIT_VIEW_OPERATIONS, 'Nhật ký vận hành (trong tòa được giao)'],
      [PERMISSIONS.AUDIT_VIEW_FINANCE, 'Nhật ký tài chính (trong tòa được giao)'],
      [PERMISSIONS.AUDIT_VIEW, 'Toàn bộ nhật ký'],
      [PERMISSIONS.SETTINGS_MANAGE, 'Cấu hình chính sách tính phí'],
      [PERMISSIONS.USERS_MANAGE, 'Người dùng và phân quyền'],
    ],
  },
];

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.permissions));

export type AuditCategory = 'OPERATIONS' | 'FINANCE' | 'SYSTEM';

export const AUDIT_FINANCE_PREFIXES = ['invoice', 'payment', 'credit', 'deposit', 'holding', 'holding_conversion', 'settlement', 'share_link', 'billing', 'reminder', 'expense'];
export const AUDIT_OPERATIONS_PREFIXES = ['building', 'room', 'reservation', 'tenant', 'tenancy', 'contract', 'meter', 'meter_reading', 'meter_price', 'service', 'tenancy_service', 'rent', 'notice', 'member'];

/**
 * Nhóm nhật ký theo phần đầu của `action` (VD `payment.reverse` → FINANCE). SYSTEM (đăng nhập, người dùng, cấu hình, tài khoản
 * nhận tiền…) chỉ người có `audit.view` xem.
 */
export function auditCategory(action: string): AuditCategory {
  const head = action.split('.')[0] ?? '';
  if (head === 'payment_account' || head === 'reminder_settings') return 'SYSTEM';
  if (AUDIT_FINANCE_PREFIXES.includes(head)) return 'FINANCE';
  if (AUDIT_OPERATIONS_PREFIXES.includes(head)) return 'OPERATIONS';
  return 'SYSTEM';
}

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = { OPERATIONS: 'Vận hành', FINANCE: 'Tài chính', SYSTEM: 'Hệ thống' };
