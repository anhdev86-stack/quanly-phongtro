import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { FILE_MAX_BYTES, type FileDto, type fileListQuerySchema, type FileOwnerType, type fileUploadFieldsSchema, PERMISSIONS, type PermissionCode } from '@ql-tro/shared';
import type { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { iso } from '../../common/dto/mappers.js';
import { AppError } from '../../common/errors/app-error.js';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { runInTransaction } from '../../infrastructure/prisma/transaction.js';
import { STORAGE, type StorageAdapter } from '../../infrastructure/storage/storage.js';
import { AuditService } from '../audit/audit.service.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { userNames } from '../utilities/user-names.js';

/** Quyền xem / quyền tải lên-lưu trữ theo loại đối tượng sở hữu. Ảnh giấy tờ tùy thân cần thêm files.identity.view. */
const OWNER_PERMS: Record<FileOwnerType, { view: PermissionCode; manage: PermissionCode }> = {
  tenant: { view: PERMISSIONS.TENANTS_VIEW, manage: PERMISSIONS.TENANTS_MANAGE },
  tenancy: { view: PERMISSIONS.TENANTS_VIEW, manage: PERMISSIONS.TENANTS_MANAGE },
  contract: { view: PERMISSIONS.CONTRACTS_VIEW, manage: PERMISSIONS.CONTRACTS_MANAGE },
  meter_reading: { view: PERMISSIONS.METER_READINGS_RECORD, manage: PERMISSIONS.METER_READINGS_RECORD },
  maintenance_request: { view: PERMISSIONS.MAINTENANCE_VIEW, manage: PERMISSIONS.MAINTENANCE_MANAGE },
  expense: { view: PERMISSIONS.EXPENSES_VIEW, manage: PERMISSIONS.EXPENSES_RECORD },
};

/** Nhận diện định dạng theo chữ ký đầu tệp, không tin tên/MIME do trình duyệt gửi. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** Tên tệp an toàn để hiển thị/tải về: bỏ đường dẫn và ký tự điều khiển. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'tep';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return (cleaned || 'tep').slice(0, 200);
}

/**
 * Tệp riêng tư (V1.1, MASTER_PLAN 11.4): hợp đồng scan, ảnh CCCD, ảnh đồng hồ, ảnh bảo trì, chứng từ chi.
 * Phạm vi xét theo đối tượng sở hữu (ngoài tòa được giao → 404). Không xóa vĩnh viễn: “lưu trữ” để ẩn, có lý do và nhật ký.
 * Tải ảnh giấy tờ tùy thân được ghi nhật ký (ai xem dữ liệu cá nhân).
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly tenants: TenantsService,
    private readonly expenses: ExpensesService,
    private readonly audit: AuditService,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Kiểm tra quyền + phạm vi đối tượng; trả tòa của đối tượng (null nếu không xác định). */
  private async assertOwner(user: AuthUser, type: FileOwnerType, id: string, action: 'view' | 'manage', category?: string): Promise<string | null> {
    if (!user.permissions.has(OWNER_PERMS[type][action])) throw new AppError('FORBIDDEN');
    if (category === 'IDENTITY' && !user.permissions.has(PERMISSIONS.FILES_IDENTITY_VIEW)) throw new AppError('FORBIDDEN');
    const room = this.rooms.roomWhere(user);
    const w = user.workspaceId;
    switch (type) {
      case 'tenant': {
        const t = await this.prisma.tenant.findFirst({ where: { AND: [{ id }, this.tenants.tenantWhere(user)] }, select: { id: true } });
        if (!t) throw new AppError('NOT_FOUND');
        return null;
      }
      case 'tenancy': {
        const t = await this.prisma.tenancy.findFirst({ where: { id, workspaceId: w, room }, select: { room: { select: { buildingId: true } } } });
        if (!t) throw new AppError('NOT_FOUND');
        return t.room.buildingId;
      }
      case 'contract': {
        const c = await this.prisma.contract.findFirst({ where: { id, workspaceId: w, tenancy: { room } }, select: { tenancy: { select: { room: { select: { buildingId: true } } } } } });
        if (!c) throw new AppError('NOT_FOUND');
        return c.tenancy.room.buildingId;
      }
      case 'meter_reading': {
        const r = await this.prisma.meterReading.findFirst({ where: { id, meter: { workspaceId: w, room } }, select: { meter: { select: { room: { select: { buildingId: true } } } } } });
        if (!r) throw new AppError('NOT_FOUND');
        return r.meter.room.buildingId;
      }
      case 'maintenance_request': {
        const m = await this.prisma.maintenanceRequest.findFirst({ where: { id, workspaceId: w, room }, select: { room: { select: { buildingId: true } } } });
        if (!m) throw new AppError('NOT_FOUND');
        return m.room.buildingId;
      }
      case 'expense': {
        const e = await this.prisma.expense.findFirst({ where: { AND: [{ id }, this.expenses.scopeWhere(user)] }, select: { buildingId: true } });
        if (!e) throw new AppError('NOT_FOUND');
        return e.buildingId;
      }
    }
  }

  async upload(user: AuthUser, fields: z.output<typeof fileUploadFieldsSchema>, file: { buffer: Buffer; originalname: string; size: number } | undefined): Promise<FileDto> {
    if (!file?.buffer?.length) throw new AppError('VALIDATION_FAILED', undefined, { file: ['Chọn tệp cần tải lên.'] });
    if (file.size > FILE_MAX_BYTES) throw new AppError('VALIDATION_FAILED', undefined, { file: ['Tệp tối đa 10 MB.'] });
    const mime = sniffMime(file.buffer);
    if (!mime) throw new AppError('VALIDATION_FAILED', undefined, { file: ['Chỉ nhận ảnh JPG, PNG, WEBP hoặc PDF.'] });
    const buildingId = await this.assertOwner(user, fields.owner_type, fields.owner_id, 'manage', fields.category);
    const id = randomUUID();
    // Khóa không chứa tên gốc; chia thư mục theo tháng để dễ sao lưu từng phần.
    const key = `${user.workspaceId}/${this.clock.today().slice(0, 7)}/${id}`;
    await this.storage.put(key, file.buffer);
    const row = await runInTransaction(this.prisma, async (tx) => {
      const f = await tx.storedFile.create({
        data: {
          id,
          workspaceId: user.workspaceId,
          storageKey: key,
          originalName: safeName(file.originalname),
          mime,
          sizeBytes: file.buffer.length,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          category: fields.category,
          ownerEntityType: fields.owner_type,
          ownerEntityId: fields.owner_id,
          buildingId,
          uploadedBy: user.id,
        },
      });
      await this.audit.record(tx, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'file.upload',
        entityType: 'file',
        entityId: f.id,
        buildingId,
        after: { owner_type: fields.owner_type, owner_id: fields.owner_id, category: fields.category, mime, size_bytes: f.sizeBytes },
      });
      return f;
    });
    return (await this.dtos([row]))[0]!;
  }

  async list(user: AuthUser, q: z.output<typeof fileListQuerySchema>): Promise<FileDto[]> {
    await this.assertOwner(user, q.owner_type, q.owner_id, 'view');
    const rows = await this.prisma.storedFile.findMany({
      where: {
        workspaceId: user.workspaceId,
        ownerEntityType: q.owner_type,
        ownerEntityId: q.owner_id,
        ...(q.include_archived === 'true' ? {} : { archivedAt: null }),
        // Không có quyền xem giấy tờ tùy thân thì không thấy cả tên tệp.
        ...(user.permissions.has(PERMISSIONS.FILES_IDENTITY_VIEW) ? {} : { category: { not: 'IDENTITY' as const } }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.dtos(rows);
  }

  /** Nội dung tệp sau khi kiểm tra quyền. Không phục vụ tệp đã lưu trữ. */
  async content(user: AuthUser, id: string): Promise<{ mime: string; name: string; data: Buffer }> {
    const f = await this.prisma.storedFile.findFirst({ where: { id, workspaceId: user.workspaceId, archivedAt: null } });
    if (!f) throw new AppError('NOT_FOUND');
    try {
      await this.assertOwner(user, f.ownerEntityType as FileOwnerType, f.ownerEntityId, 'view', f.category);
    } catch (e) {
      // Không lộ sự tồn tại của tệp giấy tờ với người không có quyền.
      if (e instanceof AppError && e.code === 'FORBIDDEN' && f.category === 'IDENTITY') throw new AppError('NOT_FOUND');
      throw e;
    }
    const data = await this.storage.get(f.storageKey);
    if (createHash('sha256').update(data).digest('hex') !== f.sha256) throw new AppError('INTERNAL_ERROR', 'Tệp lưu trữ bị hỏng hoặc đã bị thay đổi.');
    if (f.category === 'IDENTITY') {
      await this.audit.record(this.prisma, { workspaceId: user.workspaceId, actorId: user.id, action: 'file.view_identity', entityType: 'file', entityId: f.id, buildingId: f.buildingId });
    }
    return { mime: f.mime, name: f.originalName, data };
  }

  async archive(user: AuthUser, id: string, reason: string): Promise<FileDto> {
    const f = await this.prisma.storedFile.findFirst({ where: { id, workspaceId: user.workspaceId } });
    if (!f) throw new AppError('NOT_FOUND');
    await this.assertOwner(user, f.ownerEntityType as FileOwnerType, f.ownerEntityId, 'manage', f.category);
    if (f.archivedAt) throw new AppError('BUSINESS_RULE_VIOLATION', 'Tệp đã được lưu trữ.');
    const row = await runInTransaction(this.prisma, async (tx) => {
      const u = await tx.storedFile.update({ where: { id }, data: { archivedAt: this.clock.now(), archivedBy: user.id, archiveReason: reason } });
      await this.audit.record(tx, { workspaceId: user.workspaceId, actorId: user.id, action: 'file.archive', entityType: 'file', entityId: id, buildingId: f.buildingId, reason });
      return u;
    });
    return (await this.dtos([row]))[0]!;
  }

  private async dtos(rows: { id: string; originalName: string; mime: string; sizeBytes: number; category: FileDto['category']; ownerEntityType: string; ownerEntityId: string; uploadedBy: string; createdAt: Date; archivedAt: Date | null; archiveReason: string | null }[]): Promise<FileDto[]> {
    const names = await userNames(this.prisma, rows.map((r) => r.uploadedBy));
    return rows.map((r) => ({
      id: r.id,
      original_name: r.originalName,
      mime: r.mime,
      size_bytes: r.sizeBytes,
      category: r.category,
      owner_type: r.ownerEntityType,
      owner_id: r.ownerEntityId,
      uploaded_by_name: names.get(r.uploadedBy) ?? null,
      created_at: iso(r.createdAt)!,
      archived_at: iso(r.archivedAt),
      archive_reason: r.archiveReason,
      url: `/api/v1/files/${r.id}/content`,
    }));
  }
}
