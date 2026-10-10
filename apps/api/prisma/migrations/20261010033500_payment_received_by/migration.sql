-- Người nhận tiền trên phiếu thu (chủ dự án yêu cầu 10/10/2026, D-045).
-- Phiếu thu cũ: người nhận = người đã ghi phiếu (created_by). Không xóa, không đổi dữ liệu nào khác.
ALTER TABLE "payments" ADD COLUMN "received_by" UUID;
UPDATE "payments" SET "received_by" = "created_by" WHERE "received_by" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "received_by" SET NOT NULL;
