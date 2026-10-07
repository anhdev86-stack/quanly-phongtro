-- AlterTable
ALTER TABLE "statement_periods" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "closed_by" UUID,
ADD COLUMN     "reopen_reason" TEXT,
ADD COLUMN     "reopened_at" TIMESTAMPTZ(3),
ADD COLUMN     "reopened_by" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "contract_revisions" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "changes" JSONB NOT NULL,
    "terms_before" JSONB NOT NULL,
    "terms_after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_alerts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "term_end" DATE NOT NULL,
    "milestone_days" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by" UUID,

    CONSTRAINT "contract_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_revisions_contract_id_revision_no_key" ON "contract_revisions"("contract_id", "revision_no");

-- CreateIndex
CREATE INDEX "contract_alerts_workspace_id_acknowledged_at_idx" ON "contract_alerts"("workspace_id", "acknowledged_at");

-- CreateIndex
CREATE UNIQUE INDEX "contract_alerts_contract_id_term_end_milestone_days_key" ON "contract_alerts"("contract_id", "term_end", "milestone_days");

-- AddForeignKey
ALTER TABLE "contract_revisions" ADD CONSTRAINT "contract_revisions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_alerts" ADD CONSTRAINT "contract_alerts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- Ràng buộc thủ công (MANUAL_SQL.md)
-- Kỳ CLOSED ⇔ có thời điểm đóng.
ALTER TABLE "statement_periods" ADD CONSTRAINT "statement_periods_closed_chk" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL));
-- Số phụ lục bắt đầu từ 1.
ALTER TABLE "contract_revisions" ADD CONSTRAINT "contract_revisions_no_chk" CHECK ("revision_no" >= 1);
-- Mốc cảnh báo là số ngày dương.
ALTER TABLE "contract_alerts" ADD CONSTRAINT "contract_alerts_milestone_chk" CHECK ("milestone_days" > 0);
