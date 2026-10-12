-- D-047: giao dịch ngân hàng tự động (webhook/đồng bộ → đối chiếu → phiếu thu). Chỉ thêm bảng/cột mới; payments.source mặc định MANUAL cho dữ liệu cũ.
-- CreateEnum
CREATE TYPE "BankEnvironment" AS ENUM ('MOCK', 'TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "BankDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('RECEIVED', 'MATCHED', 'PENDING_REVIEW', 'ERROR', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "BankTransactionSource" AS ENUM ('WEBHOOK', 'SYNC');

-- CreateEnum
CREATE TYPE "BankPaymentLinkKind" AS ENUM ('CREATED', 'LINKED_EXISTING');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'BANK_AUTO', 'BANK_RECONCILE');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "direction" "BankDirection" NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "content" TEXT NOT NULL,
    "reference_code" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "source" "BankTransactionSource" NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'RECEIVED',
    "reason" TEXT,
    "payment_code" TEXT,
    "invoice_id" UUID,
    "dismissed_vnd" BIGINT NOT NULL DEFAULT 0,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" TEXT,
    "mock_transaction_id" BIGINT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transaction_payments" (
    "id" UUID NOT NULL,
    "bank_transaction_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "kind" "BankPaymentLinkKind" NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transaction_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_sync_states" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "account_number" TEXT NOT NULL,
    "last_provider_id" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_bank_transactions" (
    "id" BIGSERIAL NOT NULL,
    "payload" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_transactions_workspace_id_status_occurred_at_idx" ON "bank_transactions"("workspace_id", "status", "occurred_at");

-- CreateIndex
CREATE INDEX "bank_transactions_invoice_id_idx" ON "bank_transactions"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_provider_environment_account_number_provi_key" ON "bank_transactions"("provider", "environment", "account_number", "provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_payments_payment_id_key" ON "bank_transaction_payments"("payment_id");

-- CreateIndex
CREATE INDEX "bank_transaction_payments_bank_transaction_id_idx" ON "bank_transaction_payments"("bank_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_sync_states_provider_environment_account_number_key" ON "bank_sync_states"("provider", "environment", "account_number");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_payments" ADD CONSTRAINT "bank_transaction_payments_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_payments" ADD CONSTRAINT "bank_transaction_payments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Quyền mới (D-047): mặc định chỉ chủ trọ; quản lý cần được cấp riêng. Idempotent, không đổi quyền đang có.
INSERT INTO "permissions" ("id", "code") VALUES
  (gen_random_uuid(), 'bank_transactions.view'),
  (gen_random_uuid(), 'bank_transactions.reconcile')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."code" = 'OWNER' AND p."code" IN ('bank_transactions.view', 'bank_transactions.reconcile')
ON CONFLICT DO NOTHING;
