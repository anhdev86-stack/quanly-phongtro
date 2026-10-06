-- SQL THỦ CÔNG — Phase 0. Danh mục và định nghĩa chuẩn: prisma/MANUAL_SQL.md.
-- Prisma schema không biểu diễn được CHECK constraint, nên các ràng buộc này viết tay.

-- Bật sẵn cho exclusion constraint ở các phase sau (MASTER_PLAN 3.6 bước 8).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Email luôn lưu chữ thường; đăng nhập so khớp không phân biệt hoa thường.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));

-- Phiên refresh phải hết hạn sau thời điểm tạo.
ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_expiry_chk" CHECK ("expires_at" > "created_at");

-- Idempotency-Key: 8–128 ký tự an toàn (khớp idempotencyKeySchema ở @ql-tro/shared).
ALTER TABLE "idempotency_requests"
  ADD CONSTRAINT "idempotency_requests_key_format_chk" CHECK ("key" ~ '^[A-Za-z0-9_-]{8,128}$');

-- Bản ghi DONE phải có HTTP status đã lưu để trả lại khi gọi lặp.
ALTER TABLE "idempotency_requests"
  ADD CONSTRAINT "idempotency_requests_done_has_status_chk"
  CHECK ("status" <> 'DONE' OR "response_status" IS NOT NULL);
