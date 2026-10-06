-- CreateEnum
CREATE TYPE "PostingStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CreditApplicationStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paid_at" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_applications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "credit_invoice_id" UUID NOT NULL,
    "target_invoice_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "status" "CreditApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_refunds" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "tenancy_id" UUID NOT NULL,
    "credit_invoice_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "paid_at" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_allocations" (
    "id" UUID NOT NULL,
    "deposit_transaction_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,

    CONSTRAINT "deposit_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "bank_bin" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" TIMESTAMPTZ(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_tenancy_id_idx" ON "payments"("tenancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_workspace_id_number_key" ON "payments"("workspace_id", "number");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_invoice_id_key" ON "payment_allocations"("payment_id", "invoice_id");

-- CreateIndex
CREATE INDEX "credit_applications_credit_invoice_id_idx" ON "credit_applications"("credit_invoice_id");

-- CreateIndex
CREATE INDEX "credit_applications_target_invoice_id_idx" ON "credit_applications"("target_invoice_id");

-- CreateIndex
CREATE INDEX "credit_refunds_credit_invoice_id_idx" ON "credit_refunds"("credit_invoice_id");

-- CreateIndex
CREATE INDEX "deposit_allocations_invoice_id_idx" ON "deposit_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_allocations_deposit_transaction_id_invoice_id_key" ON "deposit_allocations"("deposit_transaction_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_accounts_workspace_id_idx" ON "payment_accounts"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");

-- CreateIndex
CREATE INDEX "share_links_invoice_id_idx" ON "share_links"("invoice_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_credit_invoice_id_fkey" FOREIGN KEY ("credit_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_target_invoice_id_fkey" FOREIGN KEY ("target_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refunds_tenancy_id_workspace_id_fkey" FOREIGN KEY ("tenancy_id", "workspace_id") REFERENCES "tenancies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refunds_credit_invoice_id_fkey" FOREIGN KEY ("credit_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_allocations" ADD CONSTRAINT "deposit_allocations_deposit_transaction_id_fkey" FOREIGN KEY ("deposit_transaction_id") REFERENCES "deposit_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_allocations" ADD CONSTRAINT "deposit_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== SQL thủ công Phase 6 (danh mục: prisma/MANUAL_SQL.md) =====

-- Số tiền luôn dương (MASTER_PLAN 6.8).
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive_chk" CHECK ("amount_vnd" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_positive_chk" CHECK ("amount_vnd" > 0);
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_amount_positive_chk" CHECK ("amount_vnd" > 0);
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refunds_amount_positive_chk" CHECK ("amount_vnd" > 0);
ALTER TABLE "deposit_allocations" ADD CONSTRAINT "deposit_allocations_amount_positive_chk" CHECK ("amount_vnd" > 0);

-- Đảo là đổi trạng thái: đã đảo thì có thời điểm và lý do; chưa đảo thì không (một cơ chế đảo duy nhất).
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal_chk" CHECK (("status" = 'REVERSED') = ("reversed_at" IS NOT NULL AND "reversal_reason" IS NOT NULL));
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_reversal_chk" CHECK (("status" = 'REVERSED') = ("reversed_at" IS NOT NULL AND "reversal_reason" IS NOT NULL));
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refunds_reversal_chk" CHECK (("status" = 'REVERSED') = ("reversed_at" IS NOT NULL AND "reversal_reason" IS NOT NULL));

-- Tối đa một tài khoản nhận tiền active mỗi workspace.
CREATE UNIQUE INDEX "one_active_payment_account" ON "payment_accounts" ("workspace_id") WHERE "is_active";

-- Credit không cấn vào chính nó.
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_distinct_chk" CHECK ("credit_invoice_id" <> "target_invoice_id");
