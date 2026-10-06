# Tiến độ triển khai

Nguồn yêu cầu: [MASTER_PLAN.md](../MASTER_PLAN.md) v2.4. Quyết định kỹ thuật: [DECISIONS.md](DECISIONS.md).

Quy ước: ✅ đã triển khai **và** đã kiểm thử · 🟡 đã triển khai, chưa kiểm thử đầy đủ · ⛔ bị chặn · ⬜ chưa làm.

---

## ✅ Bốn điểm B-1…B-4 đã chốt (D-022…D-025)

B-1 do chủ dự án chọn (giảm theo tỷ lệ ngày ở); B-2, B-3, B-4 là quy tắc kỹ thuật được đề xuất và ghi ở DECISIONS. Nội dung phân tích gốc giữ lại bên dưới để tham khảo.

### Phân tích gốc (06/10/2026)

Chủ dự án yêu cầu ghi lại bốn điểm dưới đây ngày 06/10/2026. **Chưa có quyết định nào.** Khi triển khai billing,
không được tự suy diễn quy tắc cho các điểm này. Phải hỏi và ghi quyết định vào DECISIONS.md trước.

### B-1. Discount khi đối soát và hoàn tiền

- **Hiện trạng plan:** mục 8.6 ghi “discount của invoice không tham gia đối soát”. `P(u)` chỉ tính dòng DEBIT/CREDIT. `remaining` (mục 8.8) trừ discount ở cấp invoice.
- **Vấn đề:** discount không gắn với nguồn phí hay tháng nào. Ví dụ: thông báo tháng 11 có tiền phòng 3.000.000, discount 300.000, khách trả 2.700.000. Khách trả phòng ngày 20/11 thì credit = P − E = 1.000.000, tính trên giá **chưa giảm**. Chưa rõ:
  - khách được hoàn trên số đã thực trả hay trên giá niêm yết;
  - discount có được chia theo tỷ lệ cho phần ngày không ở hay không;
  - discount có thể làm tổng credit lớn hơn số tiền khách đã trả cho khoảng đó hay không.
- **Cần chốt:** discount gắn với nguồn phí/khoảng nào (hay chỉ gắn cấp invoice); cách tính credit và hoàn tiền khi invoice có discount; trần hoàn tiền.

### B-2. Phát hành cặp chứng từ dưới ràng buộc “một invoice DRAFT mỗi tenancy”

- **Hiện trạng plan:** mục 6.8 có index `one_draft_invoice_per_tenancy`. Mục 8.6 (quy tắc nháp 3–4) và 7.6 bước 7 cần tạo **hai** chứng từ (MONTHLY/FINAL + CREDIT_ADJUSTMENT) trong cùng transaction.
- **Vấn đề:**
  - Nếu CREDIT_ADJUSTMENT được tạo ở trạng thái DRAFT trước khi phát hành thì vi phạm index.
  - “Điều chỉnh ngay” khi tenancy đang có nháp (quy tắc 4) cũng chạm index.
  - Chưa rõ thứ tự cấp số chứng từ cho cặp và cách xử lý khi một nửa cặp lỗi.
- **Cần chốt:** chứng từ thứ hai có được tạo thẳng ở PUBLISHED trong cùng transaction hay không; index có loại trừ loại ADJUSTMENT hay không; thứ tự cấp số; việc hủy/tính lại nháp đang mở khi điều chỉnh ngay.

### B-3. Định danh nguồn phí ổn định xuyên các phiên bản subscription

- **Hiện trạng plan:** đơn vị đối soát `u = (tenancy, nguồn phí, tháng)`. `tenancy_services` và `rent_price_history` có phiên bản (dòng mới mỗi lần đổi số lượng/giá, có trạng thái VOIDED).
- **Vấn đề:**
  - Mỗi phiên bản là một dòng có id riêng. Nếu “nguồn phí” là id dòng thì đổi số xe giữa tháng sẽ tách thành hai u, và P(u) của phiên bản mới bằng 0 → **có thể thu trùng**.
  - Nếu nguồn phí là `service_id` thì không phân biệt được hai subscription song song của cùng một dịch vụ (ví dụ hai loại xe), nếu nghiệp vụ cho phép.
  - Chưa rõ thay đồng hồ (meter mới, id mới) có tính là cùng một nguồn phí hay không.
- **Cần chốt:** khóa định danh ổn định của từng loại nguồn phí (tiền phòng, dịch vụ, đồng hồ); có cho phép nhiều subscription song song cùng dịch vụ hay không; trường nào lưu khóa đó trên `invoice_items`.

### B-4. Đối soát điện nước khi khoảng giữa các chỉ số thay đổi

- **Hiện trạng plan:** đơn vị đối soát điện nước `u = (tenancy, đồng hồ, khoảng giữa hai chỉ số liên tiếp)`.
- **Vấn đề:**
  - Chèn thêm một chỉ số vào giữa khoảng đã phát hành sẽ làm khoảng cũ biến mất và sinh hai khoảng mới. Các trường hợp: chỉ số tại ngày đổi giá (8.5), chỉ số FINAL khi trả phòng, sửa ngày đọc, thay đồng hồ.
  - Khi đó P(khoảng mới) = 0 trong khi tiền đã thu nằm ở khoảng cũ → đối soát ngây thơ sẽ **thu trùng** hoặc bỏ sót.
- **Cần chốt:** độ mịn đối soát cho điện nước (theo từng khoảng đã phát hành, theo tổng tiêu thụ lũy kế của đồng hồ đến mốc tính, hay cách khác); cách gắn tiền đã phát hành của khoảng cũ vào các khoảng mới; cách xử lý khi thay đồng hồ giữa khoảng.

---

## Phase 0 — Foundation ✅ (chờ chủ dự án nghiệm thu)

Nhánh: `phase/0-foundation`. Ngày: 06/10/2026.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Kiểm tra môi trường thực tế | ✅ | Thư mục chỉ có MASTER_PLAN.md, chưa có git. Node 24.19.0, Docker 29.8.2, chưa có pnpm. Cổng 5432/5433 đã bị tiến trình khác chiếm. |
| `git init`, commit plan lên `main` | ✅ | `aa662b6 docs: add MASTER_PLAN v2.3`. Danh tính git đặt ở mức repo (D-019). |
| Chốt và pin phiên bản công cụ | ✅ | Bảng ở DECISIONS D-001. |
| Bảng cách triển khai ràng buộc theo Prisma đã pin | ✅ | `apps/api/prisma/MANUAL_SQL.md` |
| Monorepo pnpm theo mục 3.3 | ✅ | `apps/api`, `apps/web`, `packages/shared`, `e2e`, `infra`, `docs` |
| `CLAUDE.md` | ✅ | |
| Docker Compose PostgreSQL 18.6 + DB test | ✅ | Cổng host 55432 |
| Prisma: schema, migration đầu, SQL thủ công | ✅ | 2 migration; 4 CHECK + extension btree_gist |
| Khung test `test/schema/` (T47) | ✅ | So định nghĩa + hành vi từ danh mục MANUAL_SQL.md |
| Đăng nhập / refresh / đăng xuất / me | ✅ | argon2id, JWT 15 phút, refresh xoay vòng + phát hiện dùng lại |
| Cookie HttpOnly, SameSite=Lax, CSRF double-submit | ✅ | |
| Permission guard (mặc định cần đăng nhập) | ✅ | Thứ tự: CSRF → Auth → Permission |
| Phạm vi theo tòa (404 ngoài phạm vi) | ✅ | `AccessService`; FK kép chặn gán tòa khác workspace |
| Error envelope `{code, message, field_errors?, request_id}` | ✅ | Message tiếng Việt |
| OpenAPI `/api/v1/docs` (`x-public`/`x-permissions`) | ✅ | Có test bắt buộc mọi endpoint khai báo quyền |
| Logging JSON + request ID, che dữ liệu nhạy cảm | ✅ | |
| Health live/ready | ✅ | |
| Audit backend (che CCCD/mật khẩu, cùng transaction) | ✅ | |
| Hạ tầng idempotency | ✅ | Cùng transaction nghiệp vụ; T26/T33-style tests |
| Clock inject được | ✅ | `FixedClock` cho test |
| Khóa dòng theo thứ tự + retry deadlock | ✅ | `lockRows`, `runInTransaction` |
| Seed tài khoản dev (1 OWNER, 2 STAFF khác tòa) | ✅ | Idempotent; mật khẩu từ `.env` |
| Rewrite `/api` cùng tên miền (dev) | ✅ | Kiểm chứng bằng E2E |
| Web: đăng nhập, layout, tổng quan từ API thật | ✅ | Loading / error / empty / 401 → login |
| E2E Playwright (desktop + mobile) | ✅ | Dùng Edge có sẵn |
| `.env.example`, không có bí mật thật | ✅ | |
| README chạy trên Windows PowerShell và macOS/Linux | 🟡 | Đã viết và chạy trên Windows; chưa chạy thử trên macOS/Linux |

### Lệnh kiểm tra đã chạy (06/10/2026, Windows 11, Node 24.19.0)

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ 4 gói, 0 lỗi, 0 cảnh báo |
| `pnpm typecheck` | ✅ 4 gói |
| `pnpm test` | ✅ shared 16, api 15, web 3 = **34 test unit** |
| `pnpm test:integration` | ✅ **60 test**, 9 file, PostgreSQL thật (`ql_tro_test`) |
| `pnpm build` | ✅ shared, api (tsc), web (Next.js production) |
| `pnpm test:e2e` | ✅ **12 test** (6 kịch bản × desktop/mobile), Microsoft Edge |
| `pnpm db:seed` chạy 2 lần | ✅ cùng kết quả (3 user, 3 tòa, 36 quyền, 46 role_permission) |
| Kiểm tra drift: `prisma migrate dev --create-only` sau SQL thủ công | ✅ migration rỗng (Prisma không đòi DROP CHECK) |

Số liệu chi tiết từng lần chạy cuối cùng nằm ở báo cáo nghiệm thu Phase 0.

### Hạn chế đã biết của Phase 0

- Giới hạn đăng nhập sai lưu trong bộ nhớ tiến trình, chỉ đúng khi chạy một instance API (D-009).
- Hai tab cùng refresh đúng một thời điểm có thể bị coi là dùng lại refresh token, dẫn tới đăng xuất (D-012). Web đã gộp refresh trong cùng tab.
- Profile `full` của docker compose và Dockerfile để ở Phase 9 theo plan.
- Bảng `settings_versions` chưa tạo; sẽ thêm khi có cấu hình đầu tiên cần dùng (Phase 1 hoặc 5).

### Câu hỏi khác đang chờ chủ dự án

1. ~~Partial index~~ → SQL thủ công (chủ dự án chốt 06/10).
2. ~~/users~~ → Phase 1 (đã làm).
3. ~~Danh tính git~~ → giữ nguyên.
4. Các mục ở MASTER_PLAN 2.3 (pháp lý tạm trú/dữ liệu cá nhân, mẫu báo cáo thuế) vẫn chờ, chưa chặn MVP.
5. **Nhắc đóng tiền Zalo/SMS (N-1…N-5, MASTER_PLAN 2.3):** nhà cung cấp, tài khoản và khóa API, chi phí, cách ghi nhận đồng ý, mẫu tin. Chặn phần gửi thật ở Phase 8B.

---

## Yêu cầu mới v2.4 (06/10/2026)

Chủ dự án bổ sung; đã ghi vào MASTER_PLAN v2.4, **chưa triển khai** (Phase 0 chưa có module nghiệp vụ):

| Yêu cầu | Lựa chọn của chủ dự án | Triển khai ở |
|---|---|---|
| Mã QR để khách đóng tiền | VietQR, chủ trọ xác nhận tay | Phase 6 (cần thông báo tiền phòng từ Phase 5) |
| Nhắc tới ngày đóng tiền | Zalo/SMS tới người thuê | Phase 8B; gửi thật cần chốt N-1…N-5 |
| Điện nước: giá nhập một lần, nút thay đổi, mỗi tháng chỉ nhập chỉ số | Giá riêng từng tòa; điện đ/kWh, nước đ/m³ | Phase 4 (nhập, giá) + Phase 5 (tính tiền) |
| Báo cáo doanh thu | Theo tháng: phát sinh/giảm trừ/đã thu/còn nợ + thực thu trong tháng | Phase 8A |

---

## Phase 1 — Property và giữ phòng ✅

Nhánh `phase/1-property`, merge vào `main` 06/10/2026.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Tòa: CRUD, lưu trữ/bỏ lưu trữ, phạm vi | ✅ | Mã tòa unique trong workspace; lưu trữ bị chặn khi còn phòng |
| Phòng: CRUD, READY/MAINTENANCE, lưu trữ | ✅ | FK kép (building_id, workspace_id); trạng thái hiển thị tính theo 5.1 |
| Giữ phòng: ba mốc ngày, đổi lịch, hủy có lý do | ✅ | EXCLUDE `no_overlapping_active_reservations` + khóa phòng; EXPIRED suy ra từ ngày |
| Quản lý người dùng (đưa vào Phase 1 theo chủ dự án) | ✅ | Tạo, sửa, vai trò, phạm vi tòa, đặt lại mật khẩu, khóa tài khoản (thu hồi phiên ngay) |
| UI: tòa, phòng (lưới/bảng, lọc), chi tiết phòng, giữ phòng, người dùng | ✅ | Bộ component dùng chung (Dialog, Field, MoneyInput, Table, Toast…) |
| Seed: 45 phòng demo | ✅ | `prisma/seed/demo.ts` |
| T47 cho 4 ràng buộc mới | ✅ | Kiểm chứng: Prisma không sinh DROP cho EXCLUDE viết tay |
| T55 phần chồng lịch và đồng thời | ✅ | 3 request đồng thời → 1 thành công, 2 nhận 409 |

Kiểm tra: lint ✅ · typecheck ✅ · unit 39 ✅ · integration **93** ✅ · E2E **16** (desktop + mobile) ✅.

## Phase 2 — Tenant, Tenancy, cọc, tiền giữ chỗ ✅

Nhánh `phase/2-tenancy`, merge vào `main` 06/10/2026.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Người thuê: CRUD, tìm kiếm, che CCCD theo quyền, cảnh báo trùng CCCD | ✅ | STAFF thấy `********6789`, không tìm được theo CCCD |
| Nhận phòng một transaction (7.2 bước 1–7) + Idempotency-Key | ✅ | Khóa phòng; kiểm tra bảo trì, sức chứa, khách trước, lịch giữ phòng; mã `LTyymm-nnnn` |
| Thành viên: thêm, rời đi (giữ lịch sử), đổi đại diện, tạm trú | ✅ | Đúng một PRIMARY đang ở (partial unique) |
| Giá thuê, dịch vụ, chỉ số ban đầu (tạo đồng hồ nếu chưa có) | ✅ | Nhập chỉ số đầu một lần (v2.4) |
| Sổ cọc: nhận, nhận thêm, hoàn, khấu trừ, đảo | ✅ | Domain `ledger.ts`; số dư không âm; không đảo hai lần |
| Sổ tiền giữ chỗ: nhận, hoàn, giữ lại theo thỏa thuận, đảo | ✅ | Hủy giữ phòng không tự mất tiền |
| Chuyển giữ chỗ → cọc bằng cặp liên kết; đảo cả cặp atomic | ✅ | T43, T56 |
| UI: người thuê, lần thuê, wizard nhận phòng 6 bước, sổ cọc/giữ chỗ | ✅ | Bước hợp đồng bật ở Phase 3 |
| T47 cho 19 ràng buộc mới (gồm partial unique đầu tiên) | ✅ | Kiểm chứng: Prisma không sinh DROP cho partial index viết tay |
| E2E chạy trên database riêng `ql_tro_e2e` (api :4100, web :3100) | ✅ | Không còn làm bẩn dữ liệu dev |

Kiểm tra: lint ✅ · typecheck ✅ · unit 45 ✅ · integration **151** ✅ · E2E **20** (desktop + mobile) ✅.

Ghi chú: cảnh báo `pg` về truy vấn song song đến từ Prisma (D-026), không ảnh hưởng kết quả.

## Phase 3 — Contract và Pricing (lõi) ✅

Nhánh `phase/3-contracts`, merge vào `main` 06/10/2026.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Hợp đồng: nháp, ký, mã `HDyymm-nnnn`, ảnh chụp điều khoản | ✅ | Lifecycle lưu DRAFT/SIGNED/CANCELLED; trạng thái hiển thị suy ra từ ngày (domain `contract-status.ts`) |
| Hàm SQL `contract_effective_status` khớp hàm domain | ✅ | T05 so sánh 4 trường hợp × ~20 mốc ngày |
| EXCLUDE `no_overlapping_signed_contracts`, CHECK kỳ/ngày ký | ✅ | Nháp được chồng ngày; ký nháp chồng ngày → 409 |
| `rental_mode` FIXED_TERM / MONTH_TO_MONTH theo hợp đồng đã ký bao phủ ngày | ✅ | Provider `RENTAL_MODE`; hết hạn không kết thúc lần thuê (T04) |
| Gia hạn = kỳ mới cùng `tenancy_id`, `previous_contract_id`; không nhận lại cọc | ✅ | T06; giá mới gắn `source_contract_id`; mức cọc yêu cầu đổi khi kỳ mới bắt đầu |
| Hủy nháp; hủy hợp đồng đã ký chưa bắt đầu (`contracts.cancel_signed`) | ✅ | T50: giá/dịch vụ phụ thuộc → VOIDED, giá độc lập giữ nguyên, audit ghi id bị vô hiệu |
| Đổi giá theo ngày; giữa tháng phải xác nhận; giảm giá một tháng tự khôi phục (D-022) | ✅ | T09 |
| Hợp đồng kèm khi nhận phòng (cùng transaction) | ✅ | Provider `MOVE_IN_EXTENSIONS` |
| Danh sách hợp đồng, lọc trạng thái/tòa/sắp hết hạn | ✅ | Sắp hết hạn bỏ qua hợp đồng đã có kỳ gia hạn (D-027) |
| UI: mục Hợp đồng ở trang lần thuê (tạo, ký, gia hạn, hủy, cảnh báo sắp hết hạn, banner thuê theo tháng), đổi giá, trang `/contracts`, bước hợp đồng trong wizard | ✅ | |
| T47 cho 4 ràng buộc mới (gồm hàm SQL đầu tiên) | ✅ | Catalog hỗ trợ loại `function` |

Kiểm tra (06/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 54 (shared 16, api 35, web 3) |
| `pnpm test:integration` | ✅ **169** (16 file) |
| `pnpm test:e2e` | ✅ **22** (desktop + mobile) |

## Phase 4 — Utilities và Services ✅

Nhánh `phase/4-utilities`, merge vào `main` 06/10/2026.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Danh mục dịch vụ: thêm, sửa, ngừng; `charge_timing`; giá có phiên bản (chung hoặc riêng tòa) | ✅ | Trang `/services`; điện nước luôn thu sau, không sửa loại |
| Giá điện nước theo tòa + “Thay đổi giá” + lịch sử (ai đổi, khi nào, từ kỳ nào, lý do) | ✅ | Áp dụng theo kỳ đọc (D-028); kỳ đã có chỉ số phải xác nhận; T60 phần giá |
| Dịch vụ của lần thuê: thêm, đổi số lượng, ngưng theo ngày; giữa tháng cần xác nhận | ✅ | Không ghi đè phiên bản; T12 phần dữ liệu (`domain/utilities/timeline.ts`) |
| Đồng hồ: gắn (chỉ số ban đầu một lần), thay đồng hồ (chốt CLOSING), sửa chỉ số ban đầu | ✅ | T14 phần thay đồng hồ |
| Nhập chỉ số theo đợt (kỳ phát hành), chỉ số trước tự lấy, sửa chỉ số có lý do + audit + meter_event | ✅ | T13, T61 phần nhập và sửa |
| Tiền tạm tính = `meterCharge` (cùng hàm billing sẽ dùng), làm tròn theo cấu hình kỳ | ✅ | Web ước tính khi gõ chỉ để xem (D-029) |
| Cảnh báo bất thường (0 khi có người ở, gấp >3 lần / <1/3 trung bình 3 kỳ) — không chặn | ✅ | |
| Chặn bật đồng thời nước đồng hồ và “Nước theo người” nếu chưa xác nhận | ✅ | Nhận phòng: chặn; mục Dịch vụ/gắn đồng hồ: cần `confirm_dual_utility` |
| Cấu hình tính phí có phiên bản (`settings_versions`): chia ngày, làm tròn, hạn, thu trước/sau | ✅ | Trang `/settings/billing` |
| UI: `/readings` ưu tiên điện thoại (360px không tràn ngang), mục Giá điện nước ở trang tòa, mục Đồng hồ ở trang phòng, mục Dịch vụ ở lần thuê | ✅ | |
| T47 cho 7 ràng buộc mới | ✅ | Gồm `UNIQUE … NULLS NOT DISTINCT` |

Kiểm tra (06/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 70 (shared 16, api 48, web 6) |
| `pnpm test:integration` | ✅ **194** (17 file) |
| `pnpm test:e2e` | ✅ **25** (desktop + mobile; 1 test đổi giá chỉ chạy desktop) |

Ghi chú: `prisma migrate dev` treo sau khi áp migration (bước sinh client); migration đã áp đủ (`migrate status` sạch), client sinh lại bằng `prisma generate`.

## Phase 5 — Billing Engine ✅

Nhánh `phase/5-billing`, merge vào `main` 06/10/2026. Quy tắc B-1…B-4 áp dụng đúng D-022…D-025.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Domain chia ngày ở cấp tháng × nguồn phí, làm tròn một lần, phân bổ phần dư lớn nhất | ✅ | `domain/billing/proration.ts`; ba ví dụ mục 8.3, T10, T54 (unit) |
| Đơn vị đối soát u và khóa nguồn ổn định | ✅ | RENT/SVC theo tháng, METER theo khoảng chỉ số (D-024, D-025, D-030) |
| Đối soát E(u) − P(u), chỉ PUBLISHED vào P(u); u lỗi không bị coi là 0 | ✅ | `domain/billing/reconcile.ts`; T46, T49 |
| Chính sách chốt theo u ở lần phát hành đầu | ✅ | T42 |
| Xem trước / tạo nháp hàng loạt (mỗi phòng một transaction, kết quả từng phòng) | ✅ | T16 (lặp và đồng thời) |
| Tối đa một nháp mỗi tenancy; tạo tháng mới khi còn nháp → lỗi cho tenancy đó | ✅ | T49 |
| Tính lại; phát hành cần `expected_version` + `source_hash` (STALE khi dữ liệu nguồn đổi) | ✅ | Mã lỗi mới `STALE` (409) |
| Phát hành tổng âm → tách CREDIT_ADJUSTMENT PUBLISHED cùng transaction, cấp số nợ trước | ✅ | T45 (D-023) |
| “Điều chỉnh ngay”: xem trước / phát hành DEBIT/CREDIT_ADJUSTMENT, hủy và tạo lại nháp | ✅ | D-023 |
| Hủy nháp; hủy đã phát hành khi chưa có khoản thu (provider Phase 6) | ✅ | T19 phần sửa |
| Thiếu chỉ số, thiếu giá (nêu đúng tòa), giá đổi giữa hai lần đọc → lỗi chặn phát hành | ✅ | T14, T15, T60 |
| Thay đồng hồ, sửa chỉ số đã phát hành → dòng điều chỉnh đúng khoảng | ✅ | T14, D-025 |
| Bước 8 nhận phòng: nháp thông báo đầu tiên, đến hạn ngày nhận | ✅ | T01, T40 |
| Thu trước 12 tháng liên tiếp: mỗi ngày/khoảng tính đúng một lần | ✅ | T39 |
| Đổi giá sau khi đã thu → dòng đối soát liên kết `corrects_item_id` | ✅ | T41, T09, T50 phần điều chỉnh, T04 phần sinh phí, T12 phần tính tiền |
| UI: `/invoices` (tính phí theo kỳ, phát hành hàng loạt, lọc), chi tiết (nhóm Thu trước/Thu sau/Điều chỉnh), trang in `/print/invoices/:id` (A4/A5), mục thông báo ở lần thuê | ✅ | |
| T47 cho 11 ràng buộc mới | ✅ | Thay `one_service_price_per_day` bằng hai partial unique (D-030) |

Kiểm tra (06/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 85 (shared 16, api 63, web 6) |
| `pnpm test:integration` | ✅ **236** (18 file; billing 17) |
| `pnpm test:e2e` | ✅ **28** (2 test dữ liệu dùng chung chỉ chạy desktop) |

## Phase 6 — Payment, Credit, công nợ, VietQR ✅

Nhánh `phase/6-payments`, merge vào `main` 06/10/2026.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Phiếu thu + allocation trong một transaction, không vượt `remaining`, Idempotency-Key | ✅ | T17, T18 (đồng thời), idempotency cùng/khác payload |
| Trạng thái thanh toán UNPAID/PARTIAL/PAID + cờ quá hạn | ✅ | Một hàm `InvoiceBalances` cho chi tiết, công nợ, sao kê (8.8) |
| Đảo phiếu thu toàn bộ (finance.reverse), nợ quay lại thông báo gốc, không đảo hai lần | ✅ | T37 phần payment; hook `REVERSAL_OBSERVERS` cho settlement_events (Phase 7) |
| Thông báo đã có thu không hủy được | ✅ | T19 |
| Credit: cấn trừ (mặc định đến hạn sớm nhất trước), hoàn khi thực chi (không dùng sổ cọc), đảo | ✅ | T29, T37 phần credit |
| Công nợ theo lần thuê (gồm đã kết thúc), sao kê với số dư = còn nợ − credit | ✅ | |
| Tài khoản nhận tiền (một active), VietQR EMVCo/NAPAS + CRC16, nội dung ≤ 25 ký tự không dấu | ✅ | T57 (unit + integration); **tài khoản DEMO** Vietcombank 0011223344 |
| QR không đổi trạng thái tiền | ✅ | T58 |
| Link xem thông báo: token 32 byte, DB lưu hash, 60 ngày, thu hồi, cùng lỗi cho sai/hết hạn/thu hồi, giới hạn theo IP, `no-store` + `noindex`, không lộ dữ liệu cá nhân | ✅ | T59 |
| Quyền mới: `payment_accounts.manage`, `invoices.share`, `meter_prices.manage`, `reminders.view/manage` | ✅ | STAFF: ghi thu, xem QR, tạo link trong tòa được giao |
| UI: mục Thanh toán ở chi tiết thông báo (QR, ghi nhận thu, link, đảo), chứng từ credit (cấn trừ/hoàn), `/payments` (công nợ, phiếu thu), sao kê ở lần thuê, `/settings/payment-account`, in phiếu thu `/print/payments/:id`, QR trên trang in, trang công khai `/p/<token>` | ✅ | QR vẽ trên trình duyệt bằng `qrcode` (không gọi dịch vụ ngoài) |
| T47 cho 10 ràng buộc mới | ✅ | |

Kiểm tra (06/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 89 (shared 16, api 67, web 6) |
| `pnpm test:integration` | ✅ **260** (19 file) |
| `pnpm test:e2e` | ✅ **30** (2 test dữ liệu dùng chung chỉ chạy desktop) |

**Chưa kiểm chứng:** quét QR bằng app ngân hàng thật với tài khoản thật của chủ trọ (T57 yêu cầu kiểm tay một lần) — đang dùng tài khoản demo.

## Phase 7 — Trả phòng và quyết toán ✅

Nhánh `phase/7-move-out`, merge vào `main` 06/10/2026.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Báo trả / hủy báo trả (lưu lịch sử), báo lùi ngày cần quyền + lý do, cảnh báo báo trước thiếu ngày | ✅ | T21, T22 |
| Giữ phòng khi khách cũ báo trả: chỉ từ sau ngày dự kiến trả; hủy báo trả → “xung đột lịch”, không tự hủy | ✅ | T55 phần báo trả |
| Wizard trả phòng: ngày cuối, chỉ số FINAL (hoặc lý do miễn), kiểm kê, khoản phí, cọc áp | ✅ | |
| Đối soát cuối kỳ mốc FINAL: bù mọi khoản chưa phát hành, credit phần thu trước dư (P − E ở cấp tháng) | ✅ | Ba ví dụ mục 9.4 khớp từng đồng (T23, T24, T53, T27) |
| Liệt kê công nợ cũ riêng, nháp đang mở bị hủy khi hoàn tất | ✅ | |
| Duyệt chốt snapshot + `input_hash`; dữ liệu đổi sau duyệt → 409 STALE | ✅ | T28 |
| Hợp đồng ký chưa bắt đầu chặn duyệt đến khi hủy có lý do; trả trước hạn chỉ cảnh báo, không tự tịch thu cọc | ✅ | T44, T20 |
| Hoàn tất trong một transaction: FINAL/CREDIT_ADJUSTMENT, cấn trừ credit, áp cọc (deposit_allocations), ENDED, hợp đồng `terminated_on`, thành viên rời, báo trả FULFILLED, trạng thái phòng | ✅ | T26/T33 (lặp key), T32 (lỗi DB → rollback) |
| Thu nợ / hoàn tiền dư / hoàn cọc theo quyết toán khi thực nhận/chi; tình trạng BALANCED/RECEIVABLE/REFUND_PAYABLE tính lại từ sổ | ✅ | T25 (không REFUND giả) |
| Đảo áp cọc, đảo phiếu thu sau COMPLETED → `settlement_events`, nợ quay lại chứng từ gốc, snapshot không đổi | ✅ | T51, T52, T37 phần cọc |
| Phòng bảo trì sau trả chặn nhận khách; khách mới không nhận nợ/cọc/credit/tiêu thụ cũ; nhận-trả cùng ngày tính 1 ngày | ✅ | T30, T31, T11 |
| UI: nút Báo trả/Hủy/Trả phòng ở lần thuê, wizard `/tenancies/:id/move-out`, chi tiết `/settlements/:id` (lúc chốt vs hiện tại, sự kiện, thu/hoàn), `/move-outs`, biên bản `/print/settlements/:id` | ✅ | |
| T47 cho 7 ràng buộc mới | ✅ | |

Kiểm tra (06/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 89 |
| `pnpm test:integration` | ✅ **282** (20 file) |
| `pnpm test:e2e` | ✅ **32** (2 test dữ liệu dùng chung chỉ chạy desktop) |

## Phase 8A — Dashboard và báo cáo MVP ✅ (full E2E chờ chạy lại)

Nhánh `phase/8a-reports`, merge vào `main` 06/10/2026.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Tổng quan: phòng theo trạng thái (loại trừ lẫn nhau, lấp đầy = OCCUPIED/tổng chưa lưu trữ), chỉ số phụ (báo trả, thuê theo tháng, hợp đồng sắp hết hạn) | ✅ | T38: “sắp trả” không đếm hai lần |
| Tiền: còn phải thu (gồm lần thuê đã kết thúc), quá hạn, cọc đang giữ, phải hoàn cọc/tiền dư, giữ chỗ chưa xử lý, phát sinh và thực thu trong tháng | ✅ | Chỉ hiện với quyền xem thông báo |
| Việc cần xử lý: thiếu chỉ số, nháp, quá hạn, hợp đồng sắp hết hạn, giữ chỗ chưa xử lý, phải hoàn, còn nợ sau trả phòng, chưa đăng ký tạm trú, (8B) tin nhắc lỗi | ✅ | Hook `DASHBOARD_TODO` cho 8B |
| Báo cáo doanh thu theo tháng: phát sinh, giảm trừ, thuần, đã thu (tiền/cọc/credit), còn nợ, thực thu trong tháng | ✅ | T65: khớp fixture, Phát sinh = Đã thu + Còn nợ, cọc không vào doanh thu, đúng phạm vi tòa, CSV khớp màn hình |
| Báo cáo công nợ, cọc, thu tiền (trừ cọc/cấn trừ trình bày riêng) | ✅ | |
| Xuất CSV (UTF-8 BOM, chặn công thức Excel) cùng bộ lọc và phạm vi | ✅ | T34 (export, dashboard theo tòa) |
| UI: trang Tổng quan mới, `/reports` (4 tab), phòng lọc theo trạng thái từ Tổng quan | ✅ | |

**Lỗi tìm thấy và đã sửa nhờ test:** điều kiện tòa trong phạm vi bị ghi đè khi thêm điều kiện “tòa chưa lưu trữ” ở Tổng quan
(nhân viên thấy phòng tòa khác) — đã đổi sang `AND`, và rà soát toàn bộ chỗ dùng `roomWhere` (không còn chỗ nào ghi đè).

Kiểm tra (06/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 89 |
| `pnpm test:integration` | ✅ **286** (21 file) |
| `playwright test specs/reports.spec.ts` | ✅ 3 đạt, 1 bỏ qua (tải CSV chỉ kiểm trên desktop) |
| `pnpm test:e2e` (toàn bộ) | ⏳ Chờ chủ dự án chạy lại |

**Sự cố E2E 06/10/2026:** một lượt full E2E treo hơn 2 giờ 40 phút và chủ dự án đã dừng. Nguyên nhân: Docker Desktop tắt
(PostgreSQL không còn chạy), không phải do test. Đã thêm: `globalTimeout` 20 phút cho cả lượt chạy, timeout cho `expect`,
timeout kết nối PostgreSQL trong global setup (báo lỗi “Docker Desktop và container postgres có đang chạy không?”),
timeout cho migrate/seed. Trước khi chạy E2E: `docker info` và `pnpm db:up`.

## Phase 8B — Nhắc đóng tiền qua Zalo/SMS ✅ (⚠️ CHƯA kiểm chứng gửi tin thật — chờ N-1…N-5)

Nhánh `phase/8b-reminders`. Quyết định: D-034.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Schema `reminder_settings`, `reminder_messages` (unique invoice+mốc), `reminder_attempts`; CHECK thủ công | ✅ | T47 thêm 2 ràng buộc |
| Hàm thuần: mốc, giờ gửi giờ VN, giờ yên lặng, chuẩn hóa/che số, giãn cách thử lại, nội dung tin | ✅ | 6 unit test |
| `MessageChannel`, `LogOnlyChannel` (mặc định), khung `ZaloZnsChannel`/`SmsChannel` đọc khóa từ env | ✅ | **Chưa gọi API nhà cung cấp, chưa gửi tin thật** |
| Lập lịch (advisory lock, skipDuplicates, cửa sổ 24 giờ, giờ yên lặng), kiểm tra lại trước khi gửi, kênh dự phòng, thử lại 3 lượt, FAILED | ✅ | T62–T64 |
| Job 15 phút trong API (`REMINDER_JOB_ENABLED`), nút “Chạy nhắc ngay” | ✅ | |
| API: GET/PUT `/settings/reminders`, GET `/reminders`, POST `/reminders/run`, POST `/reminders/:id/resend`, PUT `/tenants/:id/reminder-consent` | ✅ | Có OpenAPI, quyền `reminders.view`/`reminders.manage` |
| “Việc cần xử lý” đếm tin FAILED trong phạm vi tòa | ✅ | Thay provider tạm `DASHBOARD_TODO` |
| UI: `/reminders` (nhật ký, lần thử, gửi lại), `/settings/reminders`, đồng ý nhận tin ở trang người thuê | ✅ | Banner “chưa gửi tin thật” |

**Còn chặn:** adapter thật cần chủ dự án chốt nhà cung cấp, tự đăng ký tài khoản, đặt khóa vào env server, duyệt mẫu tin,
rồi tự gửi thử tới số của mình (MASTER_PLAN 2.3 N-1…N-5).

Kiểm tra (07/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm build` | ✅ |
| `pnpm test` | ✅ 95 (shared 16, api 73, web 6) |
| `pnpm test:integration` | ✅ **294** (22 file; gồm T62–T64 và T47 cho 2 ràng buộc mới) |
| `pnpm test:e2e specs/reminders.spec.ts` | ✅ 4 (desktop + mobile) |
| `pnpm test:e2e` (toàn bộ) | ⏳ Chờ chủ dự án chạy (theo yêu cầu không tự chạy full E2E) |
## Phase 9 — MVP release readiness ⬜
## Phase 10–14 — V1.1 ⬜
