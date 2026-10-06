# Quyết định kỹ thuật

Mỗi quyết định có mã D-xxx. Muốn đổi một quyết định thì thêm quyết định mới thay thế, không sửa lịch sử.
Quyết định nghiệp vụ nằm ở MASTER_PLAN.md; file này chỉ ghi lựa chọn kỹ thuật và lý do.

## D-001 — Phiên bản công cụ (06/10/2026)

Tra bằng `npm view` ngày 06/10/2026. Đã pin chính xác trong `package.json` và lockfile.

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 24 LTS (máy dev: 24.19.0) | `.nvmrc`, `engines >=24.11 <25` |
| pnpm | 12.9.1 | `packageManager` |
| TypeScript | 6.0.3 | Xem D-002 |
| Next.js / React | 16.3.8 / 19.3.0 | Turbopack |
| NestJS | 12.1.2 (`@nestjs/cli` 12.0.8, `@nestjs/swagger` 12.0.2) | Express 5.2.1 |
| Prisma | 7.10.0 (`@prisma/client`, `@prisma/adapter-pg`) | Xem D-003 |
| PostgreSQL | `postgres:18.6-alpine` | Xem D-006 |
| Zod | 4.6.5 | Dùng chung api/web; `z.toJSONSchema` cho OpenAPI |
| TanStack Query / React Hook Form | 5.104.1 / 7.89.0 | |
| Tailwind CSS | 4.3.3 | |
| Vitest / Vite | 5.0.3 / 8.3.2 | Xem D-004 |
| Playwright | 1.63.0 | Xem D-018 |
| ESLint | 10.12.0 (web: 9.39.5) | Xem D-016 |
| typescript-eslint | 8.71.0 | Xem D-017 |

## D-002 — TypeScript 6.0.3, chưa lên 7.x

Tag `latest` của TypeScript là 7.0.2 (compiler mới), nhưng `typescript-eslint` chỉ hỗ trợ `<6.1.0` và `@nestjs/cli` 12 dùng `~6.0`.
Chọn bản 6.x mới nhất. Xem xét lại khi hệ sinh thái hỗ trợ TS 7.

## D-003 — Prisma 7.10.0, không dùng 8.0.0-rc

Tag `latest` của gói `prisma` đang trỏ tới `8.0.0-rc.20` (bản RC). Plan yêu cầu bản stable nên chọn 7.10.0 (tag `prev`).
Prisma 7 dùng driver adapter (`@prisma/adapter-pg`), cấu hình ở `apps/api/prisma.config.ts`, client sinh vào
`apps/api/src/generated/prisma` (gitignore) với `moduleFormat = "cjs"`.

## D-004 — Không dùng SWC; Nest build bằng tsc, Vitest dùng Oxc

`@swc/core` 1.16.13 từ chối nạp native binding vì thư mục cache (`%LOCALAPPDATA%\swc`, hoặc thư mục thay thế trong dự án)
cấp quyền ghi cho nhóm `Users`/SID sandbox trên máy này. Sửa ACL là đổi cấu hình bảo mật hệ thống nên không làm.

- Nest dev/build dùng builder `tsc` (`nest-cli.json`).
- Vitest dùng bộ biến đổi Oxc của Vite 8 với `decorator.legacy` + `emitDecoratorMetadata` (`apps/api/vitest.config.mts`).
  Đã kiểm chứng Nest DI theo kiểu hoạt động trong test.
- `@swc/core` vẫn có trong lockfile do `@nestjs/cli` kéo vào, nhưng bị chặn install script (`allowBuilds: false`) và không được dùng.

## D-005 — Cài pnpm bằng npm global của người dùng

`corepack enable` cần ghi vào `C:\Program Files\nodejs` (EPERM khi không có quyền admin). Cài `pnpm@12.9.1` vào
`%APPDATA%\npm` bằng `npm install -g`. Trên Git Bash, shim `pnpm` cần `pnpm.exe` không có sẵn; dùng PowerShell hoặc `pnpm.cmd`.

## D-006 — PostgreSQL 18.6, cổng host 55432

PostgreSQL 19 chưa phát hành tại 06/10/2026. Cổng 5432 và 5433 trên máy đã bị tiến trình PostgreSQL khác chiếm,
nên container map ra 55432 (đổi bằng `POSTGRES_PORT`). Image PG18 lưu dữ liệu dưới `/var/lib/postgresql/18/docker`,
nên volume gắn vào `/var/lib/postgresql`. Script khởi tạo tạo thêm database `ql_tro_test`.

## D-007 — Partial index: tạm dùng SQL thủ công, chờ chủ dự án quyết định về preview

Prisma có partial index từ 7.4.0 dưới dạng preview `partialIndexes` (`@@unique([...], where: raw("..."))`).
Plan cho phép dùng preview chỉ khi chủ dự án chấp nhận. **Mặc định: SQL thủ công.** Trước khi tạo partial index đầu tiên
(Phase 1), phải kiểm tra `migrate dev --create-only` có sinh DROP cho index viết tay hay không.

Đã kiểm chứng: Prisma 7.10 **không** sinh DROP cho CHECK constraint viết tay. Chi tiết: `apps/api/prisma/MANUAL_SQL.md`.

## D-008 — Integration test: `migrate deploy` + TRUNCATE, không tự `migrate reset`

Prisma 7.10 phát hiện khi được gọi từ AI agent và **chặn `prisma migrate reset`** nếu không có sự đồng ý rõ ràng của người dùng.
Không lách cơ chế này. Global setup chạy `prisma migrate deploy` (không xóa dữ liệu) trên `ql_tro_test`. Mỗi file test TRUNCATE
dữ liệu trong database test, có chốt an toàn: URL phải khác `DATABASE_URL` và tên database phải kết thúc bằng `_test`.
Khi cần reset database test (ví dụ migration đã áp bị sửa), **người dùng tự chạy** lệnh trong RUNBOOK.

## D-009 — Giới hạn đăng nhập sai trong bộ nhớ

5 lần sai mỗi (IP, email) và 30 lần mỗi IP trong 15 phút; thời gian lấy từ Clock. Đủ cho một instance API (MVP).
Chạy nhiều instance thì phải chuyển sang PostgreSQL hoặc Redis.

## D-010 — HTTP status cho lỗi dữ liệu

Dữ liệu sai định dạng hoặc field ngoài whitelist trả **400 `VALIDATION_FAILED`** kèm `field_errors`. Vi phạm quy tắc nghiệp vụ trả 422.
Tham số đường dẫn không phải UUID trả 400 (không để database báo lỗi). Plan mục 10 không nêu mã cho lỗi định dạng.

## D-011 — Thành phần UI kiểu shadcn viết tay

Chỉ cần vài thành phần (Button, Input, Label, Card) nên viết tay theo phong cách shadcn/ui (cva + tailwind-merge),
không chạy CLI tương tác. Khi cần thành phần phức tạp (Dialog, Select, Table…) sẽ thêm bằng CLI shadcn và ghi lại.

## D-012 — Phiên đăng nhập, cookie và CSRF

- Access token: JWT HS256, 15 phút, `iat/exp` lấy từ Clock. Cookie `qt_access` HttpOnly, `Path=/`.
- Refresh token: `<sessionId>.<32 byte ngẫu nhiên>`; DB chỉ lưu SHA-256 phần bí mật. Cookie `qt_refresh` HttpOnly, `Path=/api/v1/auth`, 30 ngày.
- Mỗi lần refresh tạo phiên mới cùng `family_id`, phiên cũ đánh dấu `rotated_at`. Dùng lại token đã xoay sẽ thu hồi cả họ phiên (`REFRESH_TOKEN_REUSED`) và ghi audit.
- Access token chỉ hợp lệ khi phiên của nó chưa bị thu hồi. Quyền và phạm vi đọc lại từ DB mỗi request, nên thu hồi có hiệu lực ngay.
- CSRF double-submit: cookie `qt_csrf` (không HttpOnly) phải khớp header `X-CSRF-Token` cho mọi method khác GET/HEAD/OPTIONS. Chỉ `login` được miễn, vì lúc đó chưa có cookie. Refresh và logout đều cần CSRF.
- Tất cả cookie `SameSite=Lax`; `Secure` khi `COOKIE_SECURE=true` (bắt buộc ở production).
- Web gộp các lần refresh đồng thời trong một tab. Hai tab refresh cùng lúc có thể kích hoạt phát hiện dùng lại (hạn chế đã biết).
- Email không tồn tại vẫn chạy một lần argon2 giả để thời gian phản hồi không lộ tài khoản. Tài khoản bị khóa chỉ được báo sau khi mật khẩu đúng.

## D-013 — Idempotency trong cùng transaction nghiệp vụ

`IdempotencyService.execute` chèn bản ghi (`INSERT … ON CONFLICT DO NOTHING`) và lưu response ngay trong transaction nghiệp vụ:

- Commit thì có cả kết quả và bản ghi. Crash sau commit, client gọi lại vẫn nhận kết quả cũ.
- Rollback thì không còn dấu vết.
- Request đồng thời cùng key chờ ở unique index cho tới khi request đầu commit, rồi nhận kết quả đã lưu.
- Chờ quá `lock_timeout` 5 giây trả `409 REQUEST_IN_PROGRESS`. Cùng key, khác payload (hash JSON có sắp xếp key) trả `409 IDEMPOTENCY_KEY_REUSED`.
- Khóa idempotency theo (workspace, người dùng, route, key).

## D-014 — `@ql-tro/shared` là gói ESM đã build

Shared build ra `dist` (ESM + `.d.ts`). API là CommonJS và `require` gói ESM (Node 24 hỗ trợ `require(esm)`; TS 6 `nodenext` cho phép).
Web dùng trực tiếp. Script gốc `build:shared` chạy trước `dev`, `typecheck`, `test`.

## D-015 — Bảng `buildings` tối thiểu từ Phase 0; FK kép cùng workspace

Phạm vi theo tòa cần FK tới `buildings`, nên Phase 0 tạo bảng với các trường tối thiểu; Phase 1 bổ sung.
`user_building_scopes` có `workspace_id` và FK kép `(user_id, workspace_id)`, `(building_id, workspace_id)`, để database chặn
gán tòa của workspace khác (MASTER_PLAN 6.1). Mẫu này áp dụng cho các bảng liên kết chéo về sau.

## D-016 — ESLint 9 riêng cho apps/web

`eslint-config-next` 16.3.8 kéo các plugin `import`, `jsx-a11y`, `react` chưa hỗ trợ ESLint 10. Web dùng ESLint 9.39.5;
api, shared, e2e dùng ESLint 10.12.0 với cấu hình gốc. Luật `no-restricted-imports` chặn `domain/` import framework/hạ tầng,
chặn shared import code server, chặn web import code api/Prisma (MASTER_PLAN 3.4). Rule `consistent-type-imports` được báo
`emitDecoratorMetadata` để không biến import mà Nest DI cần thành `import type`.

## D-017 — Giữ chính sách `minimumReleaseAge` mặc định của pnpm

pnpm 12 không cài gói vừa phát hành (chống tấn công chuỗi cung ứng). `typescript-eslint@8.71.1` mới ra ngày 05/10, nên dùng 8.71.0.
Không thêm `minimumReleaseAgeExclude` trừ khi có lý do bảo mật được ghi ở đây.

## D-018 — E2E dùng Microsoft Edge có sẵn

Playwright chạy với `channel: 'msedge'`, không cần tải Chromium. Máy không có Edge thì đặt `E2E_BROWSER_CHANNEL=chromium`
và chạy `pnpm --filter @ql-tro/e2e exec playwright install chromium`. E2E chạy trên stack dev thật (web → rewrite → api →
database dev đã seed), tự khởi động server nếu chưa chạy. Có hai project: desktop và mobile (Pixel 7).

## D-019 — Danh tính git ở mức repository

Máy chưa cấu hình `user.name`/`user.email` toàn cục. Đặt ở mức repo (`git config --local`): `aiagent <aiagent@hecatech.vn>`.
Chủ dự án có thể đổi bằng `git config --local user.name "…"`.

## D-020 — Request ID

Nhận `X-Request-Id` từ client nếu khớp `^[A-Za-z0-9_-]{8,64}$`, nếu không thì sinh UUID. Trả lại ở header `X-Request-Id`,
ghi trong log, audit và error envelope.

## D-021 — Endpoint chỉ dùng trong test

`apps/api/test/helpers/probe.module.ts` cung cấp `/__probe/*` để kiểm tra guard, phạm vi tòa, idempotency khi chưa có module
nghiệp vụ. Module này chỉ được nạp trong integration test, không bao giờ nằm trong `AppModule`.

## D-022 — B-1: Giảm giá là mức giá thuê thấp hơn cho đúng tháng (chủ dự án chọn 06/10/2026)

- Không có “discount” tự do ở cấp thông báo trong MVP: `invoices.discount_vnd` luôn bằng 0. API không nhận discount.
- “Giảm giá tiền phòng tháng M” tạo hai phiên bản `rent_price_history` (`source_contract_id = NULL`, `reason` bắt buộc):
  giá giảm có hiệu lực từ ngày 1/M, và giá cũ có hiệu lực lại từ ngày 1/(M+1). Nếu tháng M+1 đã có phiên bản giá khác thì
  không tạo phiên bản khôi phục.
- Vì giảm giá là một mức giá, tiền phòng tự chia theo ngày ở (mục 8.3) và tự đối soát (mục 8.6). Ví dụ: giá 3.000.000,
  giảm còn 2.700.000 cho tháng 11, trả phòng hết 20/11 → phí đúng 1.800.000, đã thu 2.700.000 → credit 900.000.
- Giảm giá cho tháng đã phát hành thì đối soát tự tạo dòng điều chỉnh ở chứng từ kế tiếp.

## D-023 — B-2: Chứng từ thứ hai trong cặp được tạo thẳng ở trạng thái PUBLISHED

- Index `one_draft_invoice_per_tenancy` giữ nguyên cho mọi loại. Không bao giờ tồn tại một CREDIT_ADJUSTMENT hay DEBIT_ADJUSTMENT ở trạng thái DRAFT.
- Phát hành nháp có tổng âm: trong **một transaction**, các dòng CREDIT được chuyển sang một CREDIT_ADJUSTMENT tạo thẳng ở PUBLISHED; nháp gốc chỉ giữ dòng DEBIT rồi phát hành. Cấp số: chứng từ nợ trước, chứng từ credit sau.
- “Điều chỉnh ngay” và quyết toán: preview không ghi gì. Khi xác nhận, trong một transaction: hủy nháp đang mở của tenancy (nếu có), tạo và phát hành chứng từ điều chỉnh, rồi tạo lại nháp nếu trước đó có nháp tháng (tính lại từ Δ mới).
- Mọi bước trong một transaction; lỗi bất kỳ thì không chứng từ nào được tạo.

## D-024 — B-3: Khóa nguồn phí ổn định (`invoice_items.source_key`)

| Loại | Khóa | Ghi chú |
|---|---|---|
| Tiền phòng | `RENT:<tenancy_id>` | Mọi phiên bản giá, kể cả giảm giá (D-022), cùng một nguồn |
| Dịch vụ không đồng hồ | `SVC:<tenancy_id>:<service_id>` | Không cho hai subscription của cùng dịch vụ chồng ngày trong một tenancy (exclusion constraint); nhiều xe = tăng `quantity` |
| Điện / nước | `METER:<tenancy_id>:<ELECTRICITY|WATER>` | Giữ nguyên khi thay đồng hồ (meter mới, id mới) |

Đối soát gom theo `source_key`, không theo id của dòng phiên bản.

## D-025 — B-4: Đối soát điện nước theo khoảng đã phát hành

- Đơn vị đối soát điện nước là **khoảng đọc đã phát hành**: `u = (source_key, chỉ số đầu, chỉ số cuối)`. Ranh giới được chốt ở lần phát hành đầu tiên và lưu trên `invoice_items` (`reading_start_id`, `reading_end_id`).
- Chỉ số được chèn vào bên trong một khoảng đã phát hành (chỉ số tại ngày đổi giá, chỉ số FINAL nằm trong khoảng) **không tạo u mới**. Nó chỉ chia khoảng để áp giá: `E(u) = Σ usage của từng đoạn con × giá của đoạn đó`.
- Sửa giá trị của chỉ số đầu hoặc cuối (CORRECTION) làm thay đổi E của các khoảng dùng chỉ số đó; đối soát tạo dòng điều chỉnh cho đúng các khoảng đó.
- Không cho sửa **ngày đọc** của chỉ số đã dùng trên thông báo đã phát hành; muốn sửa thì nhập chỉ số mới.
- Thay đồng hồ trong khoảng: `usage = (chỉ số chốt đồng hồ cũ − chỉ số đầu) + (chỉ số hiện tại − chỉ số ban đầu đồng hồ mới)`. Cùng `source_key` nên không tách u.
- Chỉ số mới nằm sau chỉ số cuối đã phát hành thì tạo khoảng mới, bắt đầu từ chỉ số cuối đó.

## D-026 — Cảnh báo `pg` về truy vấn song song đến từ Prisma; giữ `pg` 8.x

`pg` 8.23 cảnh báo “Calling client.query() when the client is already executing a query”. Đã truy stack
(`--trace-deprecation`): nguồn là `@prisma/adapter-pg` 7.10 (bộ thông dịch query của Prisma tải quan hệ song song
trong interactive transaction), không phải code dự án. Code dự án không dùng `Promise.all` với transaction client
(các hàm nhận `db` chạy tuần tự). **Không nâng `pg` lên 9.x** cho tới khi Prisma hỗ trợ; khi nâng Prisma phải kiểm tra lại.

## D-027 — Trạng thái hợp đồng suy ra từ ngày; lọc danh sách trong bộ nhớ

- Bảng `contracts` chỉ lưu `lifecycle` (DRAFT/SIGNED/CANCELLED) và `terminated_on`. Trạng thái hiển thị
  (SCHEDULED/ACTIVE/EXPIRED/TERMINATED_EARLY) tính bằng hàm thuần `contractStatus` theo ngày nghiệp vụ hôm nay (Clock).
  Hàm SQL `contract_effective_status` cho cùng kết quả (T05), dùng khi cần lọc/báo cáo bằng SQL.
- `GET /contracts` lọc theo trạng thái và “sắp hết hạn trong N ngày” bằng hàm domain sau khi lấy các hợp đồng trong phạm vi
  tòa. Quy mô mục tiêu (vài trăm phòng) đủ nhỏ; khi vượt ~10.000 hợp đồng thì chuyển sang lọc bằng hàm SQL.
- “Sắp hết hạn” chỉ gồm hợp đồng ACTIVE chưa có kỳ đã ký bắt đầu sau ngày kết thúc (đã gia hạn thì không nhắc).
- Hủy hợp đồng đã ký chỉ khi chưa bắt đầu. Phiên bản giá/dịch vụ có `source_contract_id` = hợp đồng đó chuyển VOIDED;
  phiên bản tạo độc lập giữ nguyên. Hợp đồng đang hiệu lực kết thúc qua trả phòng (Phase 7).
