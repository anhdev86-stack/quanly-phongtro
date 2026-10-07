# Quản lý nhà trọ

Phần mềm quản lý nhà trọ cho một chủ trọ: nhiều tòa, nhiều phòng, nhiều người thuê.
Đặc tả nghiệp vụ: [MASTER_PLAN.md](MASTER_PLAN.md). Tiến độ: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

> **Trạng thái:** MVP (Phase 0–9) theo [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). Nhắc đóng tiền Zalo/SMS
> chưa gửi tin thật (chờ chủ dự án chốt nhà cung cấp); VietQR dùng tài khoản demo cho tới khi nhập tài khoản thật.

## Yêu cầu

| Công cụ | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 24 LTS (≥ 24.11) | Xem `.nvmrc` |
| pnpm | 12.9.1 | Cài đặt bên dưới |
| Docker | Docker Desktop (Windows/macOS) hoặc Docker Engine + Compose v2 | Dev: chỉ PostgreSQL; profile `full`: toàn bộ stack |
| Trình duyệt cho E2E | Microsoft Edge (mặc định) | Hoặc Chromium của Playwright |

## Cài đặt lần đầu

Mọi lệnh chạy ở **thư mục gốc** repository.

### 1. Cài pnpm

```powershell
# Windows PowerShell — nếu `corepack enable` báo EPERM (không có quyền admin), dùng npm:
npm install -g pnpm@12.9.1
pnpm --version
```

```bash
# macOS/Linux
corepack enable && corepack prepare pnpm@12.9.1 --activate
# hoặc: npm install -g pnpm@12.9.1
```

Trên Windows nên dùng PowerShell; shim `pnpm` trong Git Bash có thể không chạy (xem docs/DECISIONS.md D-005).

### 2. Biến môi trường

```powershell
Copy-Item .env.example .env      # Windows PowerShell
```

```bash
cp .env.example .env             # macOS/Linux
```

Giá trị mặc định đủ để chạy local. Muốn đổi mật khẩu tài khoản dev thì sửa `SEED_OWNER_PASSWORD`, `SEED_STAFF_PASSWORD`
trước khi seed. Nếu cổng `55432` đã bị dùng, đổi `POSTGRES_PORT` cùng hai URL database.

### 3. Cài dependency, database, seed

```bash
pnpm install
pnpm db:up          # PostgreSQL 18 trong Docker, cổng 55432; tự tạo thêm database ql_tro_test
pnpm db:migrate     # áp migration vào database dev
pnpm db:seed        # 3 tòa, 1 chủ trọ, 2 nhân viên (xem docs/DEMO_SCENARIOS.md)
```

### 4. Chạy

```bash
pnpm dev
```

| Dịch vụ | Địa chỉ |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:4000/api/v1 (web gọi qua rewrite `/api`, trình duyệt không gọi trực tiếp) |
| Swagger | http://localhost:4000/api/v1/docs (không bật ở production) |

API mất khoảng 15 giây để biên dịch lần đầu. Nếu web báo lỗi ngay khi mở, chờ một chút rồi bấm “Thử lại”.

Tài khoản dev: `owner@example.test` (mọi tòa), `staff.a@example.test` (tòa A), `staff.bc@example.test` (tòa B, C),
`manager.a@example.test` (quản lý tòa A), `accountant.b@example.test` (kế toán tòa B).
Mật khẩu lấy từ `SEED_OWNER_PASSWORD` / `SEED_STAFF_PASSWORD` trong `.env`.

## Kiểm tra

| Lệnh | Nội dung |
|---|---|
| `pnpm lint` | ESLint tất cả gói |
| `pnpm typecheck` | TypeScript tất cả gói |
| `pnpm test` | Test unit (shared, api, web) |
| `pnpm test:integration` | Test tích hợp API trên PostgreSQL thật (`ql_tro_test`); cần `pnpm db:up` |
| `pnpm test:e2e` | Playwright trên stack riêng (database `ql_tro_e2e`, api :4100, web :3100); cần `pnpm db:up`. Không đụng dữ liệu dev |
| `pnpm build` | Build shared, api, web |

Máy không có Microsoft Edge thì chạy E2E bằng Chromium:

```powershell
pnpm --filter @ql-tro/e2e exec playwright install chromium
$env:E2E_BROWSER_CHANNEL = "chromium"; pnpm test:e2e
```

```bash
pnpm --filter @ql-tro/e2e exec playwright install chromium
E2E_BROWSER_CHANNEL=chromium pnpm test:e2e
```

## Lệnh database khác

| Lệnh | Ý nghĩa |
|---|---|
| `pnpm db:down` | Dừng PostgreSQL, giữ dữ liệu |
| `pnpm db:deploy` | Áp migration không tạo mới (CI/production) |
| `pnpm db:reset` | **Xóa toàn bộ dữ liệu dev**, áp lại migration; Prisma hỏi xác nhận |
| `pnpm db:backup` | Sao lưu database vào `backups/` (kèm checksum, tự dọn bản cũ) |
| `pnpm db:restore:drill` | Diễn tập: sao lưu rồi khôi phục vào `ql_tro_restore_drill` và đối chiếu |
| `pnpm db:restore <file>` | Khôi phục vào database thử (không ghi đè database chính nếu không xác nhận) |
| `pnpm db:bootstrap` | Production: đồng bộ quyền, tạo chủ trọ đầu tiên (biến `BOOTSTRAP_*`) |

Triển khai bằng Docker + Caddy (profile `full`), nâng cấp, rollback: [docs/RUNBOOK.md](docs/RUNBOOK.md).

Chi tiết vận hành, reset database test, sự cố thường gặp: [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Cấu trúc

```text
apps/api        NestJS + Prisma — nơi duy nhất tính tiền chính thức
apps/web        Next.js — giao diện, gọi API qua /api
packages/shared Zod schema, mã lỗi, mã quyền dùng chung
e2e             Playwright
infra/docker    Dockerfile (migrate/api/web), script khởi tạo PostgreSQL
infra/caddy     Caddyfile (một tên miền: /api → api, còn lại → web)
scripts         Sao lưu/khôi phục database
docs            Tiến độ, quyết định, runbook, kịch bản demo
```

Quy ước code và kiến trúc: [CLAUDE.md](CLAUDE.md).
