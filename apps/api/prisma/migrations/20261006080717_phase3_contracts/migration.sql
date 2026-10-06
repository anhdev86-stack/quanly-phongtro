-- CreateEnum
CREATE TYPE "ContractLifecycle" AS ENUM ('DRAFT', 'SIGNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "term_start" DATE NOT NULL,
    "term_end" DATE NOT NULL,
    "lifecycle" "ContractLifecycle" NOT NULL DEFAULT 'DRAFT',
    "signed_at" DATE,
    "terminated_on" DATE,
    "previous_contract_id" UUID,
    "terms_snapshot" JSONB NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_tenancy_id_idx" ON "contracts"("tenancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_workspace_id_code_key" ON "contracts"("workspace_id", "code");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================== SQL THỦ CÔNG — Phase 3 (xem prisma/MANUAL_SQL.md) =====================

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_term_chk" CHECK ("term_end" >= "term_start");
-- Hợp đồng đã ký phải có ngày ký.
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_signed_at_chk" CHECK ("lifecycle" <> 'SIGNED' OR "signed_at" IS NOT NULL);

-- Các kỳ SIGNED của cùng tenancy không chồng ngày (MASTER_PLAN 5.3, 6.8).
ALTER TABLE "contracts" ADD CONSTRAINT "no_overlapping_signed_contracts"
  EXCLUDE USING gist ("tenancy_id" WITH =, daterange("term_start", "term_end" + 1, '[)') WITH &&)
  WHERE ("lifecycle" = 'SIGNED');

-- Trạng thái hiển thị suy ra từ ngày; cùng logic với domain/contracts/contract-status.ts (T05 kiểm tra trùng khớp).
CREATE FUNCTION contract_effective_status(
  p_lifecycle "ContractLifecycle", p_terminated_on date, p_term_start date, p_term_end date, p_on date
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_lifecycle = 'CANCELLED' THEN 'CANCELLED'
    WHEN p_lifecycle = 'DRAFT' THEN 'DRAFT'
    WHEN p_terminated_on IS NOT NULL THEN 'TERMINATED_EARLY'
    WHEN p_on < p_term_start THEN 'SCHEDULED'
    WHEN p_on <= p_term_end THEN 'ACTIVE'
    ELSE 'EXPIRED'
  END
$$;
