-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('MONTHLY', 'FINAL', 'DEBIT_ADJUSTMENT', 'CREDIT_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InvoiceLifecycle" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('RENT', 'SERVICE', 'METER', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ItemDirection" AS ENUM ('DEBIT', 'CREDIT');

-- DropIndex — có chủ đích: Prisma 7.10 coi unique index NULLS NOT DISTINCT (không partial) là index lạ và sinh DROP ở mọi
-- migration. Thay bằng hai partial unique index tương đương (Prisma không đụng partial index, đã kiểm chứng Phase 2).
DROP INDEX "one_service_price_per_day";

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "statement_period_id" UUID,
    "type" "InvoiceType" NOT NULL,
    "number" TEXT,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "lifecycle" "InvoiceLifecycle" NOT NULL DEFAULT 'DRAFT',
    "subtotal_vnd" BIGINT NOT NULL DEFAULT 0,
    "discount_vnd" BIGINT NOT NULL DEFAULT 0,
    "total_vnd" BIGINT NOT NULL DEFAULT 0,
    "source_invoice_id" UUID,
    "source_hash" TEXT,
    "blocking_errors" JSONB NOT NULL DEFAULT '[]',
    "published_at" TIMESTAMPTZ(3),
    "published_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "charge_kind" "ChargeKind" NOT NULL,
    "charge_timing" "ChargeTiming" NOT NULL,
    "direction" "ItemDirection" NOT NULL,
    "label_snapshot" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "charge_start" DATE,
    "charge_end_exclusive" DATE,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "source_key" TEXT NOT NULL,
    "unit_key" TEXT NOT NULL,
    "corrects_item_id" UUID,
    "reading_start_id" UUID,
    "reading_end_id" UUID,
    "policy_snapshot" JSONB NOT NULL,
    "calculation_snapshot" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_tenancy_id_lifecycle_idx" ON "invoices"("tenancy_id", "lifecycle");

-- CreateIndex
CREATE INDEX "invoices_statement_period_id_idx" ON "invoices"("statement_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_workspace_id_number_key" ON "invoices"("workspace_id", "number");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_items_unit_key_idx" ON "invoice_items"("unit_key");

-- CreateIndex
CREATE INDEX "invoice_items_source_key_idx" ON "invoice_items"("source_key");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_statement_period_id_fkey" FOREIGN KEY ("statement_period_id") REFERENCES "statement_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_invoice_id_fkey" FOREIGN KEY ("source_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_corrects_item_id_fkey" FOREIGN KEY ("corrects_item_id") REFERENCES "invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== SQL thủ công Phase 5 (danh mục: prisma/MANUAL_SQL.md) =====

-- Thay one_service_price_per_day: một phiên bản giá mỗi (dịch vụ, tòa, ngày) và mỗi (dịch vụ, ngày) cho giá chung.
CREATE UNIQUE INDEX "one_building_service_price_per_day" ON "service_price_history" ("service_id", "building_id", "effective_from") WHERE "building_id" IS NOT NULL;
CREATE UNIQUE INDEX "one_general_service_price_per_day" ON "service_price_history" ("service_id", "effective_from") WHERE "building_id" IS NULL;

-- Một thông báo tháng mỗi tenancy mỗi tháng phát hành; tối đa một nháp mỗi tenancy; một FINAL mỗi tenancy (MASTER_PLAN 6.8).
CREATE UNIQUE INDEX "one_monthly_invoice_per_period" ON "invoices" ("tenancy_id", "statement_period_id") WHERE "type" = 'MONTHLY' AND "lifecycle" <> 'CANCELLED';
CREATE UNIQUE INDEX "one_draft_invoice_per_tenancy" ON "invoices" ("tenancy_id") WHERE "lifecycle" = 'DRAFT';
CREATE UNIQUE INDEX "one_final_invoice_per_tenancy" ON "invoices" ("tenancy_id") WHERE "type" = 'FINAL' AND "lifecycle" <> 'CANCELLED';

-- Tiền: subtotal/total không âm; discount luôn 0 (D-022). Đã phát hành thì có số và thời điểm phát hành; MONTHLY gắn kỳ.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_chk" CHECK ("subtotal_vnd" >= 0 AND "total_vnd" >= 0 AND "discount_vnd" = 0 AND "total_vnd" = "subtotal_vnd" - "discount_vnd");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_published_chk" CHECK ("lifecycle" = 'DRAFT' OR "number" IS NOT NULL OR "lifecycle" = 'CANCELLED' AND "published_at" IS NULL);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_monthly_period_chk" CHECK ("type" <> 'MONTHLY' OR "statement_period_id" IS NOT NULL);
-- Chứng từ điều chỉnh không bao giờ ở trạng thái nháp và luôn trỏ tới chứng từ gốc (D-023).
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_adjustment_chk" CHECK ("type" NOT IN ('DEBIT_ADJUSTMENT', 'CREDIT_ADJUSTMENT') OR ("lifecycle" <> 'DRAFT' AND "source_invoice_id" IS NOT NULL));

-- Dòng phí: số tiền không âm, khoảng phí hợp lệ.
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_amount_chk" CHECK ("amount_vnd" >= 0);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_period_chk" CHECK ("charge_end_exclusive" IS NULL OR "charge_start" IS NULL OR "charge_end_exclusive" > "charge_start");
