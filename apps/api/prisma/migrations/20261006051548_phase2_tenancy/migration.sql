-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "TenancyStatus" AS ENUM ('ACTIVE', 'NOTICE_GIVEN', 'MOVE_OUT_PROCESSING', 'ENDED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('PRIMARY', 'MEMBER');

-- CreateEnum
CREATE TYPE "ResidenceStatus" AS ENUM ('NOT_REGISTERED', 'REGISTERED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('FIXED_ROOM', 'PER_PERSON', 'QUANTITY', 'METER');

-- CreateEnum
CREATE TYPE "ChargeTiming" AS ENUM ('ADVANCE', 'ARREARS');

-- CreateEnum
CREATE TYPE "MeterType" AS ENUM ('ELECTRICITY', 'WATER');

-- CreateEnum
CREATE TYPE "ReadingKind" AS ENUM ('INITIAL', 'PERIODIC', 'FINAL');

-- CreateEnum
CREATE TYPE "MeterEventKind" AS ENUM ('REPLACEMENT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'QR', 'OTHER');

-- CreateEnum
CREATE TYPE "DepositTxType" AS ENUM ('RECEIVED', 'TOP_UP', 'CONVERTED_FROM_HOLDING', 'APPLIED_TO_INVOICE', 'DEDUCTION', 'REFUND', 'REVERSAL', 'TRANSFER_OUT', 'TRANSFER_IN');

-- CreateEnum
CREATE TYPE "HoldingTxType" AS ENUM ('RECEIVED', 'CONVERTED_TO_DEPOSIT', 'REFUND', 'FORFEIT', 'REVERSAL');

-- CreateTable
CREATE TABLE "document_sequences" (
    "workspace_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("workspace_id","kind","period")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "birth_date" DATE,
    "gender" "Gender",
    "phone" TEXT,
    "email" TEXT,
    "identity_number" TEXT,
    "issue_date" DATE,
    "issue_place" TEXT,
    "permanent_address" TEXT,
    "hometown" TEXT,
    "note" TEXT,
    "reminder_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "reminder_consent_at" TIMESTAMPTZ(3),
    "reminder_consent_note" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancies" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "charge_end_exclusive" DATE,
    "actual_move_out_date" DATE,
    "status" "TenancyStatus" NOT NULL DEFAULT 'ACTIVE',
    "billing_due_day" INTEGER NOT NULL DEFAULT 5,
    "initial_deposit_required_vnd" BIGINT NOT NULL DEFAULT 0,
    "notice_days_snapshot" INTEGER NOT NULL DEFAULT 30,
    "reservation_id" UUID,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancy_tenants" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "joined_on" DATE NOT NULL,
    "left_on_exclusive" DATE,
    "residence_status" "ResidenceStatus" NOT NULL DEFAULT 'NOT_REGISTERED',
    "residence_registered_on" DATE,
    "residence_note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenancy_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_price_history" (
    "id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "monthly_rent_vnd" BIGINT NOT NULL,
    "source_contract_id" UUID,
    "reason" TEXT,
    "status" "VersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ServiceType" NOT NULL,
    "unit" TEXT NOT NULL,
    "charge_timing" "ChargeTiming" NOT NULL DEFAULT 'ADVANCE',
    "meter_type" "MeterType",
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancy_services" (
    "id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "end_exclusive" DATE,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "billing_policy_snapshot" JSONB,
    "source_contract_id" UUID,
    "reason" TEXT,
    "status" "VersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenancy_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_service_defaults" (
    "room_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,

    CONSTRAINT "room_service_defaults_pkey" PRIMARY KEY ("room_id","service_id")
);

-- CreateTable
CREATE TABLE "meters" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "type" "MeterType" NOT NULL,
    "serial" TEXT,
    "installed_on" DATE NOT NULL,
    "retired_on" DATE,
    "initial_reading" DECIMAL(12,2) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" UUID NOT NULL,
    "meter_id" UUID NOT NULL,
    "tenancy_id" UUID,
    "read_on" DATE NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "kind" "ReadingKind" NOT NULL,
    "statement_period_id" UUID,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_events" (
    "id" UUID NOT NULL,
    "meter_id" UUID NOT NULL,
    "reading_id" UUID,
    "kind" "MeterEventKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "old_value" DECIMAL(12,2),
    "new_value" DECIMAL(12,2),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_transactions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "type" "DepositTxType" NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "reason" TEXT,
    "settlement_id" UUID,
    "target_invoice_id" UUID,
    "reverses_transaction_id" UUID,
    "linked_holding_transaction_id" UUID,
    "linked_deposit_transaction_id" UUID,
    "paid_at" DATE,
    "method" "PaymentMethod",
    "reference" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holding_transactions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "type" "HoldingTxType" NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "reason" TEXT,
    "paid_at" DATE,
    "method" "PaymentMethod",
    "reference" TEXT,
    "linked_deposit_transaction_id" UUID,
    "reverses_transaction_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holding_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenants_workspace_id_full_name_idx" ON "tenants"("workspace_id", "full_name");

-- CreateIndex
CREATE INDEX "tenants_workspace_id_identity_number_idx" ON "tenants"("workspace_id", "identity_number");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_id_workspace_id_key" ON "tenants"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "tenancies_room_id_status_idx" ON "tenancies"("room_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenancies_workspace_id_code_key" ON "tenancies"("workspace_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tenancies_id_workspace_id_key" ON "tenancies"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "tenancy_tenants_tenancy_id_idx" ON "tenancy_tenants"("tenancy_id");

-- CreateIndex
CREATE INDEX "tenancy_tenants_tenant_id_idx" ON "tenancy_tenants"("tenant_id");

-- CreateIndex
CREATE INDEX "rent_price_history_tenancy_id_effective_from_idx" ON "rent_price_history"("tenancy_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "services_workspace_id_code_key" ON "services"("workspace_id", "code");

-- CreateIndex
CREATE INDEX "tenancy_services_tenancy_id_service_id_idx" ON "tenancy_services"("tenancy_id", "service_id");

-- CreateIndex
CREATE INDEX "meters_room_id_type_idx" ON "meters"("room_id", "type");

-- CreateIndex
CREATE INDEX "meter_readings_tenancy_id_idx" ON "meter_readings"("tenancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "meter_readings_meter_id_read_on_key" ON "meter_readings"("meter_id", "read_on");

-- CreateIndex
CREATE INDEX "meter_events_meter_id_idx" ON "meter_events"("meter_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_transactions_reverses_transaction_id_key" ON "deposit_transactions"("reverses_transaction_id");

-- CreateIndex
CREATE INDEX "deposit_transactions_tenancy_id_idx" ON "deposit_transactions"("tenancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "holding_transactions_reverses_transaction_id_key" ON "holding_transactions"("reverses_transaction_id");

-- CreateIndex
CREATE INDEX "holding_transactions_reservation_id_idx" ON "holding_transactions"("reservation_id");

-- AddForeignKey
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_room_id_workspace_id_fkey" FOREIGN KEY ("room_id", "workspace_id") REFERENCES "rooms"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_tenants" ADD CONSTRAINT "tenancy_tenants_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_tenants" ADD CONSTRAINT "tenancy_tenants_tenant_id_workspace_id_fkey" FOREIGN KEY ("tenant_id", "workspace_id") REFERENCES "tenants"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_price_history" ADD CONSTRAINT "rent_price_history_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_services" ADD CONSTRAINT "tenancy_services_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy_services" ADD CONSTRAINT "tenancy_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_service_defaults" ADD CONSTRAINT "room_service_defaults_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_service_defaults" ADD CONSTRAINT "room_service_defaults_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_events" ADD CONSTRAINT "meter_events_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_transactions_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holding_transactions" ADD CONSTRAINT "holding_transactions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================== SQL THỦ CÔNG — Phase 2 (xem prisma/MANUAL_SQL.md) =====================

-- Một tenancy chưa ENDED mỗi phòng (MASTER_PLAN 2.1, 6.8).
CREATE UNIQUE INDEX "one_open_tenancy_per_room" ON "tenancies" ("room_id")
  WHERE "status" IN ('ACTIVE', 'NOTICE_GIVEN', 'MOVE_OUT_PROCESSING');

ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_charge_end_chk"
  CHECK ("charge_end_exclusive" IS NULL OR "charge_end_exclusive" > "start_date");
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_billing_due_day_chk" CHECK ("billing_due_day" BETWEEN 1 AND 31);
ALTER TABLE "tenancies" ADD CONSTRAINT "tenancies_deposit_required_chk" CHECK ("initial_deposit_required_vnd" >= 0);

-- Một PRIMARY đang ở mỗi tenancy; một người không có hai khoảng ở chồng nhau trong cùng tenancy.
CREATE UNIQUE INDEX "one_current_primary" ON "tenancy_tenants" ("tenancy_id")
  WHERE "role" = 'PRIMARY' AND "left_on_exclusive" IS NULL;
ALTER TABLE "tenancy_tenants" ADD CONSTRAINT "tenancy_tenants_dates_chk"
  CHECK ("left_on_exclusive" IS NULL OR "left_on_exclusive" > "joined_on");
ALTER TABLE "tenancy_tenants" ADD CONSTRAINT "no_overlapping_membership"
  EXCLUDE USING gist ("tenancy_id" WITH =, "tenant_id" WITH =, daterange("joined_on", "left_on_exclusive", '[)') WITH &&);

-- Một phiên bản giá ACTIVE cho mỗi ngày hiệu lực; giá không âm.
CREATE UNIQUE INDEX "one_active_rent_price_per_day" ON "rent_price_history" ("tenancy_id", "effective_from")
  WHERE "status" = 'ACTIVE';
ALTER TABLE "rent_price_history" ADD CONSTRAINT "rent_price_nonneg_chk" CHECK ("monthly_rent_vnd" >= 0);

-- Subscription ACTIVE của cùng dịch vụ trong một tenancy không chồng ngày (D-024).
ALTER TABLE "tenancy_services" ADD CONSTRAINT "no_overlapping_tenancy_services"
  EXCLUDE USING gist ("tenancy_id" WITH =, "service_id" WITH =, daterange("effective_from", "end_exclusive", '[)') WITH &&)
  WHERE ("status" = 'ACTIVE');
ALTER TABLE "tenancy_services" ADD CONSTRAINT "tenancy_services_dates_qty_chk"
  CHECK ("quantity" >= 0 AND ("end_exclusive" IS NULL OR "end_exclusive" > "effective_from"));

-- Dịch vụ METER luôn có loại đồng hồ và luôn thu sau.
ALTER TABLE "services" ADD CONSTRAINT "services_meter_chk"
  CHECK (("type" = 'METER') = ("meter_type" IS NOT NULL) AND ("type" <> 'METER' OR "charge_timing" = 'ARREARS'));

-- Một đồng hồ đang hoạt động mỗi loại mỗi phòng; chỉ số không âm.
CREATE UNIQUE INDEX "one_active_meter_per_type" ON "meters" ("room_id", "type") WHERE "retired_on" IS NULL;
ALTER TABLE "meters" ADD CONSTRAINT "meters_initial_reading_chk" CHECK ("initial_reading" >= 0);
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_value_chk" CHECK ("value" >= 0);

-- Sổ cọc và sổ giữ chỗ: số tiền dương; REVERSAL bắt buộc trỏ giao dịch gốc, loại khác thì không.
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_amount_positive_chk" CHECK ("amount_vnd" > 0);
ALTER TABLE "deposit_transactions" ADD CONSTRAINT "deposit_reversal_ref_chk"
  CHECK (("type" = 'REVERSAL') = ("reverses_transaction_id" IS NOT NULL));
ALTER TABLE "holding_transactions" ADD CONSTRAINT "holding_amount_positive_chk" CHECK ("amount_vnd" > 0);
ALTER TABLE "holding_transactions" ADD CONSTRAINT "holding_reversal_ref_chk"
  CHECK (("type" = 'REVERSAL') = ("reverses_transaction_id" IS NOT NULL));
