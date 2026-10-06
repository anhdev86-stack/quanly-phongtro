-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DestinationRoomStatus" AS ENUM ('READY', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "SettlementItemKind" AS ENUM ('INVOICE_BALANCE', 'CREDIT_BALANCE', 'DAMAGE', 'PENALTY', 'OTHER');

-- CreateEnum
CREATE TYPE "SettlementTxKind" AS ENUM ('RECEIPT', 'CREDIT_REFUND', 'DEPOSIT_REFUND', 'DEPOSIT_APPLICATION', 'CREDIT_APPLICATION');

-- CreateEnum
CREATE TYPE "SettlementEventKind" AS ENUM ('PAYMENT_REVERSED', 'DEPOSIT_TX_REVERSED', 'CREDIT_APPLICATION_REVERSED', 'CREDIT_REFUND_REVERSED', 'LATE_PAYMENT', 'NOTE');

-- CreateTable
CREATE TABLE "move_out_notices" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "notice_date" DATE NOT NULL,
    "planned_last_charge_date" DATE NOT NULL,
    "status" "NoticeStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "move_out_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "move_out_settlements" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "last_charge_date" DATE NOT NULL,
    "charge_end_exclusive" DATE NOT NULL,
    "destination_room_status" "DestinationRoomStatus" NOT NULL,
    "handover_by" TEXT,
    "inventory_note" TEXT,
    "final_reading_waiver" TEXT,
    "deposit_to_apply_vnd" BIGINT,
    "note" TEXT,
    "approved_snapshot" JSONB,
    "input_hash" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "final_invoice_id" UUID,
    "credit_invoice_id" UUID,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "move_out_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_items" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "kind" "SettlementItemKind" NOT NULL,
    "source_invoice_id" UUID,
    "amount_vnd" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_transactions" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "kind" "SettlementTxKind" NOT NULL,
    "linked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_events" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "kind" "SettlementEventKind" NOT NULL,
    "linked_entity_type" TEXT,
    "linked_entity_id" UUID,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "move_out_notices_tenancy_id_idx" ON "move_out_notices"("tenancy_id");

-- CreateIndex
CREATE INDEX "move_out_settlements_tenancy_id_idx" ON "move_out_settlements"("tenancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "move_out_settlements_workspace_id_code_key" ON "move_out_settlements"("workspace_id", "code");

-- CreateIndex
CREATE INDEX "settlement_items_settlement_id_idx" ON "settlement_items"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_transactions_settlement_id_kind_linked_id_key" ON "settlement_transactions"("settlement_id", "kind", "linked_id");

-- CreateIndex
CREATE INDEX "settlement_events_settlement_id_idx" ON "settlement_events"("settlement_id");

-- AddForeignKey
ALTER TABLE "move_out_notices" ADD CONSTRAINT "move_out_notices_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "move_out_settlements" ADD CONSTRAINT "move_out_settlements_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "move_out_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_transactions" ADD CONSTRAINT "settlement_transactions_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "move_out_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_events" ADD CONSTRAINT "settlement_events_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "move_out_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== SQL thủ công Phase 7 (danh mục: prisma/MANUAL_SQL.md) =====

-- Một báo trả ACTIVE và một quyết toán chưa hủy mỗi lần thuê (MASTER_PLAN 6.8).
CREATE UNIQUE INDEX "one_active_notice_per_tenancy" ON "move_out_notices" ("tenancy_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "one_live_settlement_per_tenancy" ON "move_out_settlements" ("tenancy_id") WHERE "status" <> 'CANCELLED';

-- Ngày dự kiến trả không trước ngày báo; ngày cuối tính tiền và mốc loại trừ khớp nhau.
ALTER TABLE "move_out_notices" ADD CONSTRAINT "move_out_notices_dates_chk" CHECK ("planned_last_charge_date" >= "notice_date");
ALTER TABLE "move_out_settlements" ADD CONSTRAINT "move_out_settlements_dates_chk" CHECK ("charge_end_exclusive" = "last_charge_date" + 1);
-- Đã duyệt/hoàn tất thì có người duyệt và input_hash; hoàn tất thì có thời điểm hoàn tất.
ALTER TABLE "move_out_settlements" ADD CONSTRAINT "move_out_settlements_workflow_chk" CHECK (
  ("status" NOT IN ('APPROVED', 'COMPLETED') OR ("approved_by" IS NOT NULL AND "input_hash" IS NOT NULL))
  AND (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL))
);
ALTER TABLE "move_out_settlements" ADD CONSTRAINT "move_out_settlements_deposit_chk" CHECK ("deposit_to_apply_vnd" IS NULL OR "deposit_to_apply_vnd" >= 0);

-- Khoản phí trả phòng dương.
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_amount_chk" CHECK ("amount_vnd" >= 0 AND ("kind" IN ('INVOICE_BALANCE', 'CREDIT_BALANCE') OR "amount_vnd" > 0));
