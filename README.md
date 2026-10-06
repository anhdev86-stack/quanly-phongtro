# Quản lý nhà trọ

Phần mềm quản lý nhà trọ cho một chủ trọ: nhiều tòa, nhiều phòng, nhiều người thuê.
Đặc tả nghiệp vụ: [MASTER_PLAN.md](MASTER_PLAN.md). Tiến độ: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

> **Trạng thái:** đã xong Phase 0 (nền tảng: đăng nhập, phân quyền, phạm vi tòa, idempotency, audit, khung test).
> Các chức năng nghiệp vụ (phòng, hợp đồng, tính tiền…) được bổ sung từ Phase 1.

## Yêu cầu

| Công cụ | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 24 LTS (≥ 24.11) | Xem `.nvmrc` |
| pnpm | 12.9.1 | Cài đặt bên dưới |
| Docker | Docker Desktop (Windows/macOS) hoặc Docker Engine + Compose v2 | Chỉ để chạy PostgreSQL |
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

Tài khoản dev: `owner@example.test` (mọi tòa), `staff.a@example.test` (tòa A), `staff.bc@example.test` (tòa B, C).
Mật khẩu lấy từ `SEED_OWNER_PASSWORD` / `SEED_STAFF_PASSWORD` trong `.env`.

## Kiểm tra

| Lệnh | Nội dung |
|---|---|
| `pnpm lint` | ESLint tất cả gói |
| `pnpm typecheck` | TypeScript tất cả gói |
| `pnpm test` | Test unit (shared, api, web) |
| `pnpm test:integration` | Test tích hợp API trên PostgreSQL thật (`ql_tro_test`); cần `pnpm db:up` |
| `pnpm test:e2e` | Playwright trên stack dev thật; cần `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`. Tự khởi động `pnpm dev` nếu chưa chạy |
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

Chi tiết vận hành, reset database test, sự cố thường gặp: [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Cấu trúc

```text
apps/api        NestJS + Prisma — nơi duy nhất tính tiền chính thức
apps/web        Next.js — giao diện, gọi API qua /api
packages/shared Zod schema, mã lỗi, mã quyền dùng chung
e2e             Playwright
infra/docker    Script khởi tạo PostgreSQL (Dockerfile/Caddy ở Phase 9)
docs            Tiến độ, quyết định, runbook, kịch bản demo
```

Quy ước code và kiến trúc: [CLAUDE.md](CLAUDE.md).
