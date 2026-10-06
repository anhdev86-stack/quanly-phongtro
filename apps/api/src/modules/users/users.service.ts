import { Inject, Injectable } from '@nestjs/common';
import type { UserDto, userCreateSchema, userResetPasswordSchema, userScopesSchema, userUpdateSchema } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PG, pgErrorCode } from '../../common/db/pg-errors.js';
import { updateVersioned } from '../../common/db/versioned.js';
import { naturalCompare } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { lockRows } from '../../infrastructure/locking/lock-rows.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';

const userInclude = {
  roles: { include: { role: true } },
  buildingScopes: { include: { building: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(actor: AuthUser): Promise<UserDto[]> {
    const rows = await this.prisma.user.findMany({ where: { workspaceId: actor.workspaceId }, include: userInclude });
    return rows.sort((a, b) => a.email.localeCompare(b.email)).map(toDto);
  }

  async get(actor: AuthUser, id: string): Promise<UserDto> {
    return toDto(await this.getRow(actor, id));
  }

  async create(actor: AuthUser, input: z.output<typeof userCreateSchema>): Promise<UserDto> {
    const passwordHash = await hashPassword(input.password);
    try {
      const id = await runInTransaction(this.prisma, async (tx) => {
        const role = await this.findRole(tx, input.role);
        const user = await tx.user.create({
          data: { workspaceId: actor.workspaceId, email: input.email, displayName: input.display_name, passwordHash },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
        await this.replaceScopes(tx, actor.workspaceId, user.id, input.role === 'OWNER' ? [] : input.building_ids);
        await this.audit.record(tx, {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          action: 'user.create',
          entityType: 'user',
          entityId: user.id,
          after: { email: input.email, display_name: input.display_name, role: input.role, building_ids: input.building_ids },
        });
        return user.id;
      });
      return this.get(actor, id);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' || pgErrorCode(error) === PG.UNIQUE_VIOLATION) {
        throw new AppError('CONFLICT', 'Email đã được dùng.', { email: ['Email đã được dùng.'] });
      }
      throw error;
    }
  }

  async update(actor: AuthUser, id: string, input: z.output<typeof userUpdateSchema>): Promise<UserDto> {
    const before = await this.getRow(actor, id);
    const isSelf = id === actor.id;
    if (isSelf && input.is_active === false) throw new AppError('BUSINESS_RULE_VIOLATION', 'Không thể tự vô hiệu hóa tài khoản của mình.');
    if (isSelf && input.role !== undefined && input.role !== 'OWNER' && hasRole(before, 'OWNER')) {
      throw new AppError('BUSINESS_RULE_VIOLATION', 'Không thể tự bỏ vai trò chủ trọ của mình.');
    }

    await runInTransaction(this.prisma, async (tx) => {
      await lockRows(tx, 'users', [id]);
      await updateVersioned(tx.user, { id, workspaceId: actor.workspaceId }, input.expected_version, {
        ...(input.display_name !== undefined ? { displayName: input.display_name } : {}),
        ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
      });
      if (input.role !== undefined && !hasRole(before, input.role)) {
        const role = await this.findRole(tx, input.role);
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.create({ data: { userId: id, roleId: role.id } });
        if (input.role === 'OWNER') await tx.userBuildingScope.deleteMany({ where: { userId: id } });
      }
      if (input.is_active === false) await this.revokeSessions(tx, id, 'account_disabled');
      await this.assertHasActiveOwner(tx, actor.workspaceId);
      await this.audit.record(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.id,
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        before: { display_name: before.displayName, is_active: before.isActive, roles: before.roles.map((r) => r.role.code) },
        after: { display_name: input.display_name, is_active: input.is_active, role: input.role },
      });
    });
    return this.get(actor, id);
  }

  async setScopes(actor: AuthUser, id: string, input: z.output<typeof userScopesSchema>): Promise<UserDto> {
    const before = await this.getRow(actor, id);
    if (hasRole(before, 'OWNER')) throw new AppError('BUSINESS_RULE_VIOLATION', 'Chủ trọ luôn xem được mọi tòa, không cần giao phạm vi.');
    await runInTransaction(this.prisma, async (tx) => {
      await updateVersioned(tx.user, { id, workspaceId: actor.workspaceId }, input.expected_version, {});
      await this.replaceScopes(tx, actor.workspaceId, id, input.building_ids);
      await this.audit.record(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.id,
        action: 'user.set_building_scopes',
        entityType: 'user',
        entityId: id,
        before: { building_ids: before.buildingScopes.map((s) => s.buildingId) },
        after: { building_ids: input.building_ids },
      });
    });
    return this.get(actor, id);
  }

  async resetPassword(actor: AuthUser, id: string, input: z.output<typeof userResetPasswordSchema>): Promise<UserDto> {
    await this.getRow(actor, id);
    const passwordHash = await hashPassword(input.new_password);
    await runInTransaction(this.prisma, async (tx) => {
      await updateVersioned(tx.user, { id, workspaceId: actor.workspaceId }, input.expected_version, { passwordHash });
      await this.revokeSessions(tx, id, 'password_reset');
      await this.audit.record(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.id,
        action: 'user.reset_password',
        entityType: 'user',
        entityId: id,
      });
    });
    return this.get(actor, id);
  }

  private async getRow(actor: AuthUser, id: string): Promise<UserRow> {
    const row = await this.prisma.user.findFirst({ where: { id, workspaceId: actor.workspaceId }, include: userInclude });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async findRole(tx: Prisma.TransactionClient, code: string) {
    const role = await tx.role.findUnique({ where: { code } });
    if (!role) throw new AppError('BUSINESS_RULE_VIOLATION', `Vai trò ${code} chưa được kích hoạt.`, { role: ['Vai trò chưa được kích hoạt.'] });
    return role;
  }

  private async replaceScopes(tx: Prisma.TransactionClient, workspaceId: string, userId: string, buildingIds: string[]): Promise<void> {
    const unique = [...new Set(buildingIds)];
    if (unique.length > 0) {
      const found = await tx.building.count({ where: { id: { in: unique }, workspaceId, archivedAt: null } });
      if (found !== unique.length) throw new AppError('BUSINESS_RULE_VIOLATION', 'Có tòa không tồn tại hoặc đã lưu trữ.', { building_ids: ['Tòa không hợp lệ.'] });
    }
    await tx.userBuildingScope.deleteMany({ where: { userId } });
    if (unique.length > 0) {
      await tx.userBuildingScope.createMany({ data: unique.map((buildingId) => ({ userId, buildingId, workspaceId })) });
    }
  }

  private async revokeSessions(tx: Prisma.TransactionClient, userId: string, reason: string): Promise<void> {
    await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: this.clock.now(), revokedReason: reason } });
  }

  private async assertHasActiveOwner(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    const owners = await tx.user.count({ where: { workspaceId, isActive: true, roles: { some: { role: { code: 'OWNER' } } } } });
    if (owners === 0) throw new AppError('BUSINESS_RULE_VIOLATION', 'Phải còn ít nhất một chủ trọ đang hoạt động.');
  }
}

function hasRole(user: UserRow, code: string): boolean {
  return user.roles.some((r) => r.role.code === code);
}

function toDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    display_name: u.displayName,
    is_active: u.isActive,
    roles: u.roles.map((r) => r.role.code).sort(),
    buildings: u.buildingScopes
      .map((s) => ({ id: s.building.id, code: s.building.code, name: s.building.name }))
      .sort((a, b) => naturalCompare(a.code, b.code)),
    version: u.version,
    created_at: u.createdAt.toISOString(),
  };
}
