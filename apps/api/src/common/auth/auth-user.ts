import type { PermissionCode } from '@ql-tro/shared';

/** Người dùng đã xác thực, gắn vào request bởi AuthGuard. Quyền luôn đọc lại từ DB mỗi request. */
export interface AuthUser {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: ReadonlySet<PermissionCode | string>;
  /** true nếu có `workspace.all_buildings` (OWNER). */
  allBuildings: boolean;
  /** Các tòa được giao; bỏ qua khi allBuildings = true. */
  buildingIds: readonly string[];
  sessionId: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
