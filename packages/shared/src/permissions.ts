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
  REMINDERS_VIEW: 'reminders.view',
  REMINDERS_MANAGE: 'reminders.manage',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionCode[] = Object.values(PERMISSIONS);

export const ROLE_CODES = {
  OWNER: 'OWNER',
  STAFF: 'STAFF',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

/** Quyền mặc định của các vai trò MVP (MASTER_PLAN mục 11.2). */
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
};
