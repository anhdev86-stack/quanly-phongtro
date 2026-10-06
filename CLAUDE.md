# CLAUDE.md

Phần mềm quản lý nhà trọ. **Nguồn yêu cầu chính thức: [MASTER_PLAN.md](MASTER_PLAN.md)** — đọc trước khi sửa code.
Tiến độ: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). Quyết định kỹ thuật: [docs/DECISIONS.md](docs/DECISIONS.md).

## Cách làm việc

- Mỗi phiên chỉ làm một phase (MASTER_PLAN mục 16), trên nhánh `phase/<số>-<tên>`. Không merge vào `main` khi chủ dự án chưa nghiệm thu.
- Không tự suy diễn các điểm B-1…B-4 trong IMPLEMENTATION_STATUS khi làm billing; phải hỏi chủ dự án.
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
  - Ràng buộc SQL thủ công: quy trình và danh mục ở `apps/api/prisma/MANUAL_SQL.md`; mỗi ràng buộc phải có test hành vi (T47).
- `apps/web` (Next.js 16): chỉ hiển thị, gọi API qua `src/lib/api-client.ts` (tự gửi CSRF, tự refresh). Chỉ import `@ql-tro/shared`.
- `packages/shared` (ESM): Zod schema, mã lỗi, mã quyền dùng chung. Không chứa logic tính tiền.
- Tiền: BIGINT VND, JSON dạng chuỗi. Ngày nghiệp vụ: `YYYY-MM-DD`.
- Test integration dùng PostgreSQL thật (`ql_tro_test`), helper ở `apps/api/test/helpers`. Endpoint `/__probe` chỉ có trong test.
