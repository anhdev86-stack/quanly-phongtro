-- CreateTable
CREATE TABLE "room_transfers" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "from_tenancy_id" UUID NOT NULL,
    "to_tenancy_id" UUID NOT NULL,
    "transfer_date" DATE NOT NULL,
    "deposit_amount_vnd" BIGINT NOT NULL DEFAULT 0,
    "deposit_transfer_out_id" UUID,
    "deposit_transfer_in_id" UUID,
    "reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_transfers_from_tenancy_id_key" ON "room_transfers"("from_tenancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_transfers_to_tenancy_id_key" ON "room_transfers"("to_tenancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_transfers_deposit_transfer_out_id_key" ON "room_transfers"("deposit_transfer_out_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_transfers_deposit_transfer_in_id_key" ON "room_transfers"("deposit_transfer_in_id");

-- CreateIndex
CREATE INDEX "room_transfers_workspace_id_idx" ON "room_transfers"("workspace_id");

-- AddForeignKey
ALTER TABLE "room_transfers" ADD CONSTRAINT "room_transfers_from_tenancy_id_fkey" FOREIGN KEY ("from_tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_transfers" ADD CONSTRAINT "room_transfers_to_tenancy_id_fkey" FOREIGN KEY ("to_tenancy_id") REFERENCES "tenancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_transfers" ADD CONSTRAINT "room_transfers_deposit_transfer_out_id_fkey" FOREIGN KEY ("deposit_transfer_out_id") REFERENCES "deposit_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_transfers" ADD CONSTRAINT "room_transfers_deposit_transfer_in_id_fkey" FOREIGN KEY ("deposit_transfer_in_id") REFERENCES "deposit_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- Ràng buộc thủ công (MANUAL_SQL.md)
-- Có chuyển cọc (số tiền > 0) ⇔ có đủ cặp TRANSFER_OUT/TRANSFER_IN; không chuyển thì không có giao dịch nào.
ALTER TABLE "room_transfers" ADD CONSTRAINT "room_transfers_deposit_chk" CHECK ("deposit_amount_vnd" >= 0 AND ("deposit_amount_vnd" = 0) = ("deposit_transfer_out_id" IS NULL) AND ("deposit_transfer_out_id" IS NULL) = ("deposit_transfer_in_id" IS NULL));
-- Lần thuê cũ khác lần thuê mới.
ALTER TABLE "room_transfers" ADD CONSTRAINT "room_transfers_distinct_chk" CHECK ("from_tenancy_id" <> "to_tenancy_id");
