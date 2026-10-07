-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('REPAIR', 'UTILITY_BILL', 'CLEANING', 'INTERNET', 'SALARY', 'SUPPLIES', 'TAX_FEE', 'OTHER');

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "building_id" UUID,
    "room_id" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "spent_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "payee" TEXT,
    "note" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by" UUID,
    "reverse_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_workspace_id_spent_on_idx" ON "expenses"("workspace_id", "spent_on");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_workspace_id_number_key" ON "expenses"("workspace_id", "number");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- Ràng buộc thủ công (MANUAL_SQL.md)
-- Số tiền chi dương.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_chk" CHECK ("amount_vnd" > 0);
-- Đã đảo ⇔ có thời điểm và lý do đảo.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_state_chk" CHECK (("status" = 'REVERSED') = ("reversed_at" IS NOT NULL AND "reverse_reason" IS NOT NULL));
-- Chi cho phòng thì phải ghi tòa.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_room_building_chk" CHECK ("room_id" IS NULL OR "building_id" IS NOT NULL);
