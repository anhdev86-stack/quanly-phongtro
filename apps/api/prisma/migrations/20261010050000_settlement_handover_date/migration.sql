-- Ngày bàn giao thực tế tách khỏi ngày cuối tính tiền (chủ dự án yêu cầu 10/10/2026, D-046).
-- Chỉ thêm cột cho phép trống; quyết toán cũ giữ nguyên (null = ngày cuối tính tiền).
ALTER TABLE "move_out_settlements" ADD COLUMN "handover_date" DATE;
