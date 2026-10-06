-- CreateEnum
CREATE TYPE "ReminderMilestone" AS ENUM ('BEFORE_DUE', 'DUE', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttemptResult" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "reminder_settings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channel_order" JSONB NOT NULL DEFAULT '["ZALO_ZNS","SMS"]',
    "offsets_days" JSONB NOT NULL DEFAULT '[-3,0,3]',
    "send_hour" INTEGER NOT NULL DEFAULT 9,
    "quiet_start" INTEGER NOT NULL DEFAULT 21,
    "quiet_end" INTEGER NOT NULL DEFAULT 7,
    "send_to_ended" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "milestone" "ReminderMilestone" NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "skip_reason" TEXT,
    "channel_used" TEXT,
    "recipient_masked" TEXT NOT NULL,
    "content_snapshot" JSONB NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "share_link_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reminder_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_attempts" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "attempted_at" TIMESTAMPTZ(3) NOT NULL,
    "result" "AttemptResult" NOT NULL,
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "reminder_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_settings_workspace_id_key" ON "reminder_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "reminder_messages_workspace_id_status_idx" ON "reminder_messages"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_messages_invoice_id_milestone_key" ON "reminder_messages"("invoice_id", "milestone");

-- CreateIndex
CREATE INDEX "reminder_attempts_message_id_idx" ON "reminder_attempts"("message_id");

-- AddForeignKey
ALTER TABLE "reminder_messages" ADD CONSTRAINT "reminder_messages_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_attempts" ADD CONSTRAINT "reminder_attempts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "reminder_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== SQL thủ công Phase 8B (danh mục: prisma/MANUAL_SQL.md) =====

-- Giờ gửi và giờ yên lặng trong 0–23.
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_hours_chk" CHECK ("send_hour" BETWEEN 0 AND 23 AND "quiet_start" BETWEEN 0 AND 23 AND "quiet_end" BETWEEN 0 AND 23);
-- Đã gửi thì có thời điểm và kênh; bỏ qua thì có lý do; số lần thử không âm.
ALTER TABLE "reminder_messages" ADD CONSTRAINT "reminder_messages_state_chk" CHECK (
  ("status" = 'SENT') = ("sent_at" IS NOT NULL AND "channel_used" IS NOT NULL)
  AND ("status" <> 'SKIPPED' OR "skip_reason" IS NOT NULL)
  AND "attempt_count" >= 0
);
