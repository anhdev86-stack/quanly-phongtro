# CLAUDE.md

Phần mềm quản lý nhà trọ. **Nguồn yêu cầu chính thức: [MASTER_PLAN.md](MASTER_PLAN.md)** — đọc trước khi sửa code.
Tiến độ: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). Quyết định kỹ thuật: [docs/DECISIONS.md](docs/DECISIONS.md).

## Cách làm việc

- Mỗi phase làm trên nhánh `phase/<số>-<tên>`. Chủ dự án đã cho phép (06/10/2026) chuyển phase và merge vào `main` khi các kiểm tra liên quan đạt, không cần dừng xin nghiệm thu từng phase.
- B-1…B-4 đã chốt ở DECISIONS D-022…D-025; quy tắc tính tiền mới ảnh hưởng số tiền thực tế thì hỏi chủ dự án.
- Không báo “xong” khi chưa chạy kiểm tra. Ghi lệnh và kết quả vào IMPLEMENTATION_STATUS.
- Không chạy `prisma migrate reset` hay xóa database dev; Prisma chặn AI agent làm việc này và việc đó thuộc về người dùng (D-008).
- Không thêm `minimumReleaseAgeExclude`, không bật install script mới trong `pnpm-workspace.yaml` khi chưa ghi lý do (D-017).

## Lệnh (chạy ở thư mục gốc, PowerShell)

| Việc | Lệnh |
|---|---|
| Cài đặt | `pnpm install` |
| Database | `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed` |
| Chạy dev (api :4000 + web :3000) | `pnpm dev` |
| Kiểm tra | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build` |
| Một gói | `pnpm --filter @ql-tro/api <script>` |

pnpm cài ở `%APPDATA%\npm`; trong Git Bash dùng `pnpm.cmd` hoặc chạy qua PowerShell (D-005).

## Kiến trúc và quy ước

- `apps/api` (NestJS, CommonJS): nơi **duy nhất** tính tiền chính thức. Lớp: controller (DTO/auth) → service (transaction) → Prisma.
  - `src/domain/**`: hàm thuần, ESLint chặn import Nest/Prisma/hạ tầng.
  - Import trong TS dùng đuôi `.js` (module `nodenext`).
  - Guard toàn cục theo thứ tự CSRF → Auth → Permission. Endpoint mặc định cần đăng nhập; dùng `@Public()` chỉ cho login/refresh/logout/health.
  - Mọi endpoint khai báo `@RequirePermissions(...)` (có thể rỗng) và schema OpenAPI qua `ApiZodBody`/`ApiZodResponse`. Test OpenAPI sẽ fail nếu thiếu.
  - Đối tượng ngoài phạm vi tòa trả 404 (`AccessService`).
  - Thao tác tài chính: `IdempotencyService.execute` + `runInTransaction` + `lockRows` theo `LOCK_ORDER` + `AuditService.record(tx, …)`.
  - Thời gian: inject `CLOCK`, không gọi `new Date()` trong nghiệp vụ.
  - Hàm nhận `db: Db` có thể chạy trong transaction: không dùng `Promise.all` trên transaction client (D-026).
  - Nghiệp vụ nằm chung `BusinessModule`; phần mở rộng theo phase cắm qua provider token (RESERVATION_EXTRAS, DEPOSIT_REQUIREMENT, RENTAL_MODE, MOVE_IN_EXTENSIONS…).
  - Ràng buộc SQL thủ công: quy trình và danh mục ở `apps/api/prisma/MANUAL_SQL.md`; mỗi ràng buộc phải có test hành vi (T47).
- `apps/web` (Next.js 16): chỉ hiển thị, gọi API qua `src/lib/api-client.ts` (tự gửi CSRF, tự refresh). Chỉ import `@ql-tro/shared`.
- `packages/shared` (ESM): Zod schema, mã lỗi, mã quyền dùng chung. Không chứa logic tính tiền.
- Tiền: BIGINT VND, JSON dạng chuỗi. Ngày nghiệp vụ: `YYYY-MM-DD`.
- Test integration dùng PostgreSQL thật (`ql_tro_test`), helper ở `apps/api/test/helpers`. Endpoint `/__probe` chỉ có trong test.
- E2E dùng database riêng `ql_tro_e2e` (api :4100, web :3100, `.next-e2e`), được dựng lại sạch trước mỗi lần chạy.
- Schema Prisma nhiều file: `apps/api/prisma/schema/*.prisma`. Sau khi thêm SQL thủ công: `node prisma/tools/sync-manual-catalog.mjs <tên…>`.
