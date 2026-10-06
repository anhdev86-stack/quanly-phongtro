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

## D-028 — Giá điện nước áp dụng theo kỳ đọc; chuỗi chỉ số qua thay đồng hồ

- `service_price_history` có `building_id`; dịch vụ METER luôn có giá riêng từng tòa. Giá METER có `effective_from` là
  **ngày 1 của kỳ phát hành**. Khoảng tiêu thụ kết thúc bằng chỉ số chốt của kỳ P dùng phiên bản có `effective_from ≤ P`.
  Nhờ vậy “Thay đổi giá” áp dụng từ kỳ đọc tiếp theo cho mọi phòng, không phụ thuộc ngày đọc của từng phòng.
- “Kỳ đọc tiếp theo” = tháng sau kỳ mới nhất của tòa đã có chỉ số chốt (không trước tháng hiện tại). Đặt giá cho kỳ đã có
  chỉ số phải xác nhận (`confirm_existing_readings`); Phase 5 sẽ chặn kỳ đã phát hành và xử lý T15 (đổi giá giữa hai lần
  đọc cần chỉ số tại ngày đổi).
- Thay đồng hồ ghi chỉ số `CLOSING` trên đồng hồ cũ và lắp đồng hồ mới với `initial_reading` riêng (điểm INSTALL ngầm định).
  Tiêu thụ của một khoảng = tổng chênh lệch giữa các điểm liên tiếp **cùng đồng hồ** từ mốc kỳ trước (INITIAL/PERIODIC);
  chuyển đồng hồ đóng góp 0 (`domain/utilities/meter-usage.ts`). Không bao giờ nhập số âm để “sửa”.
- Sửa chỉ số đọc đúng ngày lắp đồng hồ cũng cập nhật `meters.initial_reading` để hai giá trị luôn khớp.
- Chỉ số chốt chỉ nhập cho phòng đang có lần thuê; một chỉ số PERIODIC mỗi đồng hồ mỗi kỳ (partial unique).

## D-029 — Tiền tạm tính: API tính bằng hàm chính thức, web chỉ ước tính khi đang gõ

- API trả `provisional_vnd` tính bằng `meterCharge` (bigint, HALF_UP một lần theo `rounding_unit` của kỳ) — đúng hàm
  billing engine dùng, nên tạm tính bằng tiền chính thức khi dữ liệu không đổi (T61).
- Để hiện tiền ngay khi gõ (MASTER_PLAN 12), web có `features/utilities/estimate.ts` lặp lại công thức chỉ cho số chưa lưu,
  ghi rõ “tạm tính”. Sau khi lưu, màn hình hiện số do API trả. Đây là ngoại lệ có chủ đích của quy tắc “web chỉ hiển thị”;
  có unit test đối chiếu với các ví dụ của API.

## D-030 — Billing engine: khóa đơn vị, mốc điện nước, băm nguồn, số chứng từ

- **Khóa đơn vị u** (`invoice_items.unit_key`): `RENT:<tenancy>:<YYYY-MM>`, `SVC:<tenancy>:<service>:<YYYY-MM>`,
  `METER:<tenancy>:<TYPE>:<điểm đầu>:<điểm cuối>` (điểm = id chỉ số, hoặc `install-<meter>` cho điểm lắp đồng hồ).
  `source_key` theo D-024. Mọi u đã phát hành luôn được tính lại E(u) (kể cả ngoài mốc của chứng từ hiện tại);
  u lỗi (thiếu giá, tiêu thụ âm…) được **bỏ qua**, không coi là E = 0.
- **Mốc điện nước:** INITIAL, PERIODIC có kỳ ≤ kỳ của chứng từ, FINAL (chỉ chứng từ trả phòng). Điểm đầu chuỗi chỉ là
  mốc khi lần thuê không có INITIAL (đồng hồ gắn sau). Mốc nằm hẳn trong khoảng đã phát hành bị bỏ qua (D-025).
  Đơn giá của khoảng = giá kỳ của chỉ số cuối (D-028); có phiên bản giá bắt đầu **giữa** kỳ đầu và kỳ cuối của khoảng
  (kỳ bị bỏ sót) → lỗi chặn, cần chỉ số chốt kỳ đó (T15).
- **Thiếu chỉ số:** thông báo tháng M bắt buộc có chỉ số chốt kỳ M cho đồng hồ đang dùng nếu lần thuê bắt đầu trước
  ngày 1/M. Nháp vẫn tạo được nhưng có lỗi chặn phát hành.
- **Băm nguồn (`source_hash`)**: băm các dòng tính được + lỗi. Phát hành tính lại trong transaction; khác băm của nháp →
  409 `STALE`. Client gửi băm đã xem để không phát hành nội dung khác với nội dung người dùng đã kiểm tra.
- **Số chứng từ:** `TB` (tháng), `TT` (trả phòng), `DCT` (điều chỉnh tăng), `DCG` (điều chỉnh giảm/credit) +
  `-<YYYYMM>-<4 số>`, đếm theo loại và tháng bằng `document_sequences` trong transaction phát hành.
- **Nháp có thể tạm âm**: `invoices_amounts_chk` chỉ bắt tổng ≥ 0 với chứng từ không phải nháp; phát hành tách credit.
- **Trạng thái thanh toán** tính qua provider `INVOICE_SETTLEMENT` (Phase 5: luôn 0; Phase 6 thay bằng payment,
  cọc áp vào thông báo, credit) để một hàm dùng chung cho chi tiết, công nợ, báo cáo (MASTER_PLAN 8.8).
- **Prisma và unique index không partial:** Prisma 7.10 sinh `DROP INDEX` cho unique index viết tay không có `WHERE`
  (VD `NULLS NOT DISTINCT`) ở mọi migration. Chỉ dùng partial unique index cho ràng buộc viết tay; đã thay
  `one_service_price_per_day` bằng `one_building_service_price_per_day` + `one_general_service_price_per_day`.

## D-031 — Thu tiền, credit, VietQR, link xem thông báo

- **Không có ví trả trước:** phiếu thu luôn phân bổ hết vào thông báo đã phát hành của cùng lần thuê; tổng phân bổ = số tiền.
- **Một hàm số dư:** `InvoiceBalances.settled()` (provider `INVOICE_SETTLEMENT`) tính đã thu/đã dùng cho mọi nơi; cọc áp vào
  thông báo chỉ có hiệu lực khi giao dịch gốc chưa bị đảo (không có REVERSAL trỏ tới).
- **Cấn trừ credit:** `POST /credit-applications` không truyền đích thì cấn lần lượt vào thông báo còn nợ, đến hạn sớm nhất trước.
  Credit không bao giờ tự động thành tiền hoàn; hoàn ghi qua `credit_refunds` khi thực chi, không dùng sổ cọc.
- **Thứ tự khóa** bổ sung sau `invoices`: `payments`, `credit_applications`, `credit_refunds` (đảo khóa dòng gốc để không đảo hai lần).
- **Số phiếu thu:** `PT-<YYYYMM theo ngày thu>-<4 số>`.
- **VietQR:** hàm thuần `domain/payments/vietqr.ts` (TLV EMVCo, GUID NAPAS `A000000727`, dịch vụ `QRIBFTTA`, CRC16-CCITT-FALSE);
  nội dung `<số thông báo bỏ gạch> <mã phòng>` không dấu ≤ 25 ký tự. Web vẽ QR bằng thư viện `qrcode` 1.5.4 ngay trên
  trình duyệt. Chưa có tài khoản thật: seed **tài khoản demo** (`is_demo = true`, giao diện ghi rõ không chuyển tiền thật).
- **Link xem thông báo:** token `randomBytes(32)` base64url, DB lưu sha256; hạn 60 ngày; sai/hết hạn/thu hồi trả cùng 404
  “Link không còn hiệu lực”; giới hạn 60 lượt/10 phút/IP trong bộ nhớ tiến trình (cùng giới hạn như D-009 khi chạy nhiều instance).
- **Đảo sau quyết toán:** service phát sự kiện qua `REVERSAL_OBSERVERS`; Phase 7 cài observer ghi `settlement_events`.

## D-032 — Quyết toán trả phòng

- **Chỉ số FINAL** lưu ngay khi lưu nháp quyết toán (kind FINAL, gắn lần thuê, ngày = ngày cuối tính tiền); sửa nháp thì thay.
  Chỉ số FINAL chỉ là mốc với chứng từ FINAL. Nhận và trả trong cùng ngày không thể có FINAL trùng ngày INITIAL (unique
  theo đồng hồ + ngày) → dùng lý do miễn chỉ số.
- **Khoản phí trả phòng** (hư hỏng/phạt/khác) là đơn vị `CHARGE:<settlement_item>`; sau khi phát hành giữ nguyên, không đối soát lại.
- **Công thức 9.4:** Debt = Σ còn nợ của chứng từ đã phát hành + phần DEBIT của FINAL; Credit = Σ credit còn lại + phần CREDIT
  mới. Cấn trừ credit và áp cọc theo đến hạn sớm nhất trước. `deposit_to_apply_vnd` bỏ trống = tối đa; nhập lớn hơn tối đa bị chặn.
- **`input_hash`** băm toàn bộ kết quả xem trước (dòng FINAL, công nợ, credit, cọc) + đầu vào; hoàn tất tính lại và so khớp.
- **FINAL** tạo thẳng ở PUBLISHED trong transaction hoàn tất (người duyệt quyết toán đã xem nội dung), đến hạn ngày hoàn tất.
  Không có dòng DEBIT thì không tạo FINAL; CREDIT_ADJUSTMENT khi đó trỏ chứng từ phát hành gần nhất.
- **Hợp đồng trả trước hạn:** `terminated_on = charge_end_exclusive` cho hợp đồng đang bao phủ ngày cuối và hết hạn sau đó.
- **Tình trạng tài chính** không lưu: tính lại từ sổ mỗi lần xem (còn nợ > 0 → RECEIVABLE; còn credit/cọc phải hoàn → REFUND_PAYABLE).
- Hoàn tất bị chặn nếu ngày cuối tính tiền ở tương lai.

## D-033 — Dashboard và báo cáo

- Số tiền trên dashboard/báo cáo đi qua `InvoiceBalances` (thêm `breakdown()` tách tiền/cọc/credit; `settled()` = tổng các phần),
  `DebtsService.positions` và `LedgersService` — không cộng lại riêng ở từng nơi.
- “Tháng” của thông báo = tháng phát hành; FINAL/ADJUSTMENT theo tháng của ngày lập. “Đã thu” theo tháng của thông báo;
  “Thực thu trong tháng” theo `paid_at` của phiếu thu POSTED.
- Mốc thời gian nghiệp vụ của cấn trừ credit lấy từ Clock (`created_at` gán tường minh), để báo cáo thu tiền theo khoảng ngày đúng.
- Dashboard không cần quyền riêng nhưng luôn trong phạm vi tòa; phần tiền chỉ trả khi có `invoices.view`. Báo cáo và CSV cần `reports.view`.
- Khi ghép điều kiện Prisma với `roomWhere(user)` thì dùng `AND`, không spread rồi đặt lại khóa `building` (sẽ mất phạm vi).
- Nav: Phase 8B ký hiệu 8.5 trong `availableFromPhase` (hiển thị “8B”).


## D-034 — Nhắc đóng tiền (Phase 8B)

- **Chưa gửi tin thật.** Chủ dự án chưa chốt N-1…N-5 (nhà cung cấp, tài khoản, mẫu tin). `ZaloZnsChannel` và `SmsChannel` chỉ là
  khung: đọc khóa từ biến môi trường (`ZALO_ZNS_*`, `SMS_*`), `ready()` luôn false cho tới khi viết lời gọi API thật và chủ dự án
  gửi thử thành công. Vì vậy mọi môi trường hiện dùng `LogOnlyChannel` (trạng thái SENT, kênh `LOG_ONLY`, UI ghi rõ “chỉ ghi log”).
- Gửi thật chỉ khi đủ: `NODE_ENV=production` + `reminder_settings.enabled` + có adapter `ready()`. Quyết định nằm ở `ChannelRegistry.resolve`;
  test thay kênh bằng `vi.spyOn(registry, 'resolve')` (không có đường tắt riêng cho test trong mã chạy thật).
- Mốc gửi = (ngày đến hạn + offset) lúc `send_hour` giờ Việt Nam (UTC+7 cố định). Tin chỉ được tạo trong 24 giờ sau mốc và ngoài giờ
  yên lặng; job chạy lại sau giờ yên lặng vẫn kịp tạo tin nếu còn trong 24 giờ. Mỗi loại mốc (trước hạn / đúng hạn / quá hạn) tối đa một,
  khớp unique `(invoice_id, milestone)`.
- Người nhận = người đại diện (PRIMARY) của lần thuê, có `reminder_opt_in` và số di động hợp lệ. Thông báo CREDIT_ADJUSTMENT không nhắc.
- Chống trùng: unique + `createMany(skipDuplicates)`; lập lịch trong transaction có `pg_try_advisory_xact_lock`. Gửi: “giành” tin bằng
  `updateMany PENDING → SENDING` (có thời hạn giữ 10 phút, quá hạn thì quay về PENDING) nên chạy song song không gửi hai lần.
- Kiểm tra lại ngay trước khi gửi: hủy → SKIPPED/CANCELLED, chưa phát hành, đã trả đủ → PAID, lần thuê kết thúc (khi cấu hình không nhắc),
  tắt nhận tin, mất số. Tắt nhận tin đổi ngay các tin PENDING của người đó thành SKIPPED; tắt nhắc hủy các tin PENDING (CANCELLED, DISABLED).
- Kênh đầu lỗi thì thử kênh sau trong cùng lượt. Lượt lỗi có lỗi tạm thời thì thử lại sau 5, 15 phút; lượt thứ 3 vẫn lỗi → FAILED (hiện trong
  “Việc cần xử lý”). Gửi lại thủ công cần `reminders.manage`, có audit, là một lượt thử mới cho cùng tin, bị chặn trong giờ yên lặng.
- Link trong tin là link xem thông báo (D-031) tạo lúc gửi; chỉ lưu hash. Lượt gửi sau thu hồi link của lượt trước. Link do job tạo ghi
  `created_by` là chủ trọ.
- Không lưu số điện thoại thật trong `reminder_messages`/`reminder_attempts`/log: lưu `recipient_masked`, lỗi qua `maskPhonesIn`; log của
  `LogOnlyChannel` không in nội dung tin (có token link).
- Job chạy mỗi 15 phút trong tiến trình API (`REMINDER_JOB_ENABLED`, tắt ở test); nút “Chạy nhắc ngay” gọi `POST /reminders/run`.
