import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Db } from '../../infrastructure/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Phạm vi theo tòa (MASTER_PLAN 11.2). Đối tượng ngoài phạm vi trả 404 như không tồn tại,
 * để không lộ việc đối tượng có tồn tại hay không.
 */
@Injectable()
export class AccessService {
  /** Điều kiện Prisma lọc tòa theo phạm vi của người dùng; luôn giới hạn trong workspace. */
  buildingWhere(user: AuthUser): Prisma.BuildingWhereInput {
    return user.allBuildings
      ? { workspaceId: user.workspaceId }
      : { workspaceId: user.workspaceId, id: { in: [...user.buildingIds] } };
  }

  canAccessBuilding(user: AuthUser, building: { id: string; workspaceId: string }): boolean {
    if (building.workspaceId !== user.workspaceId) return false;
    return user.allBuildings || user.buildingIds.includes(building.id);
  }

  /** Lấy tòa nếu nằm trong phạm vi, ngược lại ném NOT_FOUND. */
  async getBuildingInScope(db: Db, user: AuthUser, buildingId: string) {
    const building = await db.building.findFirst({ where: { id: buildingId, workspaceId: user.workspaceId } });
    if (!building || !this.canAccessBuilding(user, building)) throw new AppError('NOT_FOUND');
    return building;
  }
}
