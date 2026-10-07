-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('IDENTITY', 'CONTRACT_SCAN', 'METER_PHOTO', 'MAINTENANCE_PHOTO', 'RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "category" "FileCategory" NOT NULL,
    "owner_entity_type" TEXT NOT NULL,
    "owner_entity_id" UUID NOT NULL,
    "building_id" UUID,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by" UUID,
    "archive_reason" TEXT,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "room_id" UUID NOT NULL,
    "tenancy_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "reported_by" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" TEXT,
    "expense_id" UUID,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_owner_entity_type_owner_entity_id_idx" ON "files"("owner_entity_type", "owner_entity_id");

-- CreateIndex
CREATE INDEX "files_workspace_id_created_at_idx" ON "files"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "maintenance_requests_workspace_id_status_idx" ON "maintenance_requests"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_room_id_idx" ON "maintenance_requests"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_workspace_id_code_key" ON "maintenance_requests"("workspace_id", "code");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- Ràng buộc thủ công (MANUAL_SQL.md)
-- Kích thước tệp dương, tối đa 10 MB; sha256 dạng hex 64 ký tự.
ALTER TABLE "files" ADD CONSTRAINT "files_size_chk" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760 AND "sha256" ~ '^[0-9a-f]{64}$');
-- Lưu trữ (ẩn) tệp phải có thời điểm và lý do.
ALTER TABLE "files" ADD CONSTRAINT "files_archive_chk" CHECK (("archived_at" IS NULL) = ("archive_reason" IS NULL));
-- Đã xong ⇔ có thời điểm xử lý.
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_resolved_chk" CHECK (("status" = 'DONE') = ("resolved_at" IS NOT NULL));
