# Runbook

Phase 0 mới có vận hành môi trường dev. Backup/restore, triển khai production và rollback được hoàn thiện ở Phase 9.

## Database dev

| Việc | Lệnh (chạy ở thư mục gốc) |
|---|---|
| Khởi động PostgreSQL | `pnpm db:up` |
| Dừng (giữ dữ liệu) | `pnpm db:down` |
| Tạo migration mới từ schema | `pnpm --filter @ql-tro/api exec prisma migrate dev --create-only --name <tên>` rồi làm theo `apps/api/prisma/MANUAL_SQL.md` |
| Áp migration (dev) | `pnpm db:migrate` |
| Áp migration không tạo mới (CI/production) | `pnpm db:deploy` |
| Seed dữ liệu dev | `pnpm db:seed` |
| Reset database dev (**xóa toàn bộ dữ liệu dev**) | `pnpm db:reset` — Prisma sẽ hỏi xác nhận |

Container: `ql-tro-postgres-1`, cổng host `55432` (đổi bằng `POSTGRES_PORT`). Dữ liệu nằm trong volume `ql-tro_pgdata`.
`docker compose down -v` sẽ **xóa volume**, chỉ dùng khi chắc chắn muốn mất dữ liệu dev.

## Database test

- Tên: `ql_tro_test` (tạo tự động lần đầu container khởi động với volume trống).
- `pnpm test:integration` tự áp migration còn thiếu (`migrate deploy`) và tự xóa dữ liệu giữa các file test.
- Nếu test báo `prisma migrate deploy (database test) thất bại` vì một migration đã áp bị sửa lại, hãy **tự** reset database test:

  PowerShell:
  ```powershell
  $env:DATABASE_URL = "postgresql://ql_tro:ql_tro_dev_only@localhost:55432/ql_tro_test?schema=public"
  pnpm --filter @ql-tro/api exec prisma migrate reset
  Remove-Item Env:DATABASE_URL
  ```

  macOS/Linux:
  ```bash
  DATABASE_URL="postgresql://ql_tro:ql_tro_dev_only@localhost:55432/ql_tro_test?schema=public" pnpm --filter @ql-tro/api exec prisma migrate reset
  ```

  Kiểm tra kỹ tên database **kết thúc bằng `_test`** trước khi xác nhận. AI agent không chạy lệnh này thay bạn (D-008).

## Health check

- Liveness: `GET /api/v1/health/live` → `200 {"status":"ok"}`.
- Readiness: `GET /api/v1/health/ready` → `200` khi database sẵn sàng, `503` khi không. Không trả biến môi trường hay chi tiết lỗi.

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `port is already allocated` khi `pnpm db:up` | Cổng 55432 bị chiếm: đổi `POSTGRES_PORT`, `DATABASE_URL`, `DATABASE_URL_TEST` trong `.env`. |
| Web báo “Đã có lỗi xảy ra” ngay sau khi chạy `pnpm dev` | API chưa khởi động xong (tsc watch mất khoảng 15 giây). Chờ log `Found 0 errors` rồi bấm “Thử lại”. |
| Đăng nhập báo “Bạn đã thử quá nhiều lần” | Sai 5 lần trong 15 phút. Chờ hết thời gian, hoặc khởi động lại API (bộ đếm lưu trong bộ nhớ, D-009). |
| `Failed to load native binding` từ `@swc/core` | Dự án không dùng SWC (D-004). Kiểm tra không có công cụ nào bật builder `swc`. |
| `pnpm` không chạy trong Git Bash | Dùng PowerShell hoặc `pnpm.cmd` (D-005). |
