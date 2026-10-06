-- CreateEnum
CREATE TYPE "StatementPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SettingsKind" AS ENUM ('BILLING');

-- AlterEnum
ALTER TYPE "ReadingKind" ADD VALUE 'CLOSING';

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "substitutes_meter" "MeterType";

-- CreateTable
CREATE TABLE "service_price_history" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "building_id" UUID,
    "effective_from" DATE NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_periods" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "month_start" DATE NOT NULL,
    "status" "StatementPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_versions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "kind" "SettingsKind" NOT NULL,
    "effective_from" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_price_history_service_id_building_id_effective_from_idx" ON "service_price_history"("service_id", "building_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "statement_periods_workspace_id_month_start_key" ON "statement_periods"("workspace_id", "month_start");

-- CreateIndex
CREATE UNIQUE INDEX "settings_versions_workspace_id_kind_effective_from_key" ON "settings_versions"("workspace_id", "kind", "effective_from");

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_statement_period_id_fkey" FOREIGN KEY ("statement_period_id") REFERENCES "statement_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_price_history" ADD CONSTRAINT "service_price_history_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_price_history" ADD CONSTRAINT "service_price_history_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== SQL thủ công Phase 4 (danh mục: prisma/MANUAL_SQL.md) =====

-- Một phiên bản giá mỗi (dịch vụ, tòa, ngày); building_id NULL (giá chung) cũng không được trùng.
CREATE UNIQUE INDEX "one_service_price_per_day" ON "service_price_history" ("service_id", "building_id", "effective_from") NULLS NOT DISTINCT;
ALTER TABLE "service_price_history" ADD CONSTRAINT "service_price_nonneg_chk" CHECK ("unit_price" >= 0);

-- Dịch vụ thay đồng hồ chỉ áp dụng cho dịch vụ không đồng hồ.
ALTER TABLE "services" ADD CONSTRAINT "services_substitutes_chk" CHECK ("substitutes_meter" IS NULL OR "type" <> 'METER');

-- Kỳ phát hành luôn là ngày 1 của tháng.
ALTER TABLE "statement_periods" ADD CONSTRAINT "statement_periods_month_start_chk" CHECK (EXTRACT(DAY FROM "month_start") = 1);

-- Chỉ số chốt (PERIODIC) luôn gắn kỳ phát hành, loại khác thì không; một chỉ số chốt mỗi đồng hồ mỗi kỳ.
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_period_chk" CHECK (("kind" = 'PERIODIC') = ("statement_period_id" IS NOT NULL));
CREATE UNIQUE INDEX "one_periodic_reading_per_period" ON "meter_readings" ("meter_id", "statement_period_id") WHERE "kind" = 'PERIODIC';

-- Ngày ngưng đồng hồ không trước ngày lắp.
ALTER TABLE "meters" ADD CONSTRAINT "meters_retired_after_installed_chk" CHECK ("retired_on" IS NULL OR "retired_on" >= "installed_on");
