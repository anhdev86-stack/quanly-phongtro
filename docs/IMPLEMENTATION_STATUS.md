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
## Phase 9 — MVP release readiness ✅ (full E2E chờ chủ dự án chạy)

Nhánh `phase/9-release`. Quyết định: D-035. Hướng dẫn vận hành: [RUNBOOK.md](RUNBOOK.md).

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Dockerfile (target migrate/api/web), `.dockerignore` | ✅ | Cài sạch từ lockfile trong container (`pnpm install --frozen-lockfile`) và build được |
| Caddyfile: một tên miền, `/api/*` → api, HTTPS tự động, chặn docs/health từ ngoài, log che token | ✅ | `caddy validate` đạt |
| docker compose profile `full` (postgres, migrate, api, web, caddy) | ✅ | Migration chỉ chạy ở service `migrate`, không chạy lúc app khởi động |
| `db:bootstrap`: đồng bộ quyền mỗi lần triển khai, tạo chủ trọ đầu tiên, không dữ liệu demo | ✅ | 2 integration test |
| Sao lưu / khôi phục / diễn tập (`db:backup`, `db:restore`, `db:restore:drill`) | ✅ | Diễn tập đạt trên DB dev và trên stack full; DB khôi phục `prisma migrate status` = up to date |
| Rà soát bảo mật | ✅ | Xem D-035: env production, token không vào log (pino + Caddy), header web, PostgreSQL chỉ 127.0.0.1, cookie Secure/HttpOnly qua HTTPS, CSRF |
| Health liveness/readiness, healthcheck container | ✅ | Có từ Phase 0; thêm HEALTHCHECK cho image api/web |
| Test concurrency và rollback | ✅ | Đã có từ các phase trước (lock-rows, idempotency, audit rollback, T32, T62) |
| RUNBOOK: triển khai lần đầu, nâng cấp, rollback, khôi phục sự cố, lịch sao lưu | ✅ | |
| E2E đầy đủ (mục 14) | ⏳ | Theo yêu cầu, không tự chạy full E2E; đã chạy lại các spec bị ảnh hưởng |

**Lỗi tìm thấy nhờ smoke test stack full và đã sửa:**
1. Compose truyền chuỗi rỗng cho khóa Zalo/SMS tùy chọn → api không khởi động. Env schema coi chuỗi rỗng là “chưa đặt” (+ unit test).
2. Caddy: `respond` ở cấp site chạy sau `handle`, nên `/api/v1/health` vẫn lộ ra ngoài → chuyển vào trong khối `/api/*`.
3. Log api vẫn chứa token link xem thông báo trong `params.splat` → bỏ `params` khỏi log request.

**Smoke test stack full** (project riêng `ql-tro-trial`, database riêng, https://localhost:8443 qua Caddy, chứng chỉ nội bộ) — 19/19 đạt:
web `/login` 200; http → https 308; health/docs từ ngoài 404; API chưa đăng nhập 401; X-Frame-Options, HSTS, không X-Powered-By,
`/p/*` no-referrer; đăng nhập chủ trọ do `db:bootstrap` tạo; cookie Secure + HttpOnly; không có tòa/tài khoản ngân hàng demo;
POST thiếu CSRF 403; tạo tòa 201; dashboard 200; nhắc đóng tiền `real_sending: false`; link công khai sai 404.
Chạy lại `migrate` lần 2: chỉ đồng bộ quyền, không tạo thêm chủ trọ. Log api/Caddy không chứa token.

Kiểm tra (07/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm build` | ✅ |
| `pnpm test` | ✅ 99 (shared 16, api 77, web 6) |
| `pnpm test:integration` | ✅ **296** (23 file) |
| `pnpm test:e2e specs/auth.spec.ts specs/payments.spec.ts` | ✅ 14 (header web và trang công khai `/p/*` đổi) |
| `docker compose --profile full build` + `up` (project thử) | ✅ migrate Exited (0), api/web healthy |
| Smoke test qua Caddy | ✅ 19/19 |
| `pnpm db:restore:drill` (dev) / `--env-file .env.trial` (stack full) | ✅ / ✅ — 48 bảng, 525 ràng buộc, 135 index khớp |
| `pnpm test:e2e` (toàn bộ) | ⏳ Chờ chủ dự án chạy |

**Sự cố môi trường 07/10/2026:** build image làm ổ C: hết chỗ (dữ liệu Docker Desktop nằm trên C:), Docker không khởi động lại được.
Chủ dự án đã dời Disk image location sang `D:\DockerData\DockerDesktopWSL`. Đã xóa `apps/web/.next`, `.next-e2e` (bản build, tự tạo lại).
Không mất dữ liệu dev.

## Phase 10 — Quyền mở rộng và audit UI ✅

Nhánh `phase/10-permissions-audit`. Quyết định: D-036.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Vai trò MANAGER, ACCOUNTANT (preset theo bảng 11.2), đồng bộ bởi seed/`db:bootstrap` | ✅ | Seed dev thêm `manager.a@`, `accountant.b@` |
| Quyền theo người dùng: bảng `user_permission_overrides`, `PUT /users/:id/permission-overrides`, `PUT /users/:id/roles`, `GET /roles` | ✅ | Chống tự nâng quyền |
| Nhật ký: `audit_logs.building_id` + backfill, `GET /audit-logs` theo nhóm và tòa | ✅ | |
| UI: hộp thoại “Quyền” ở Người dùng, trang `/audit` (lọc nhóm/tòa/thao tác/ngày, xem trước–sau) | ✅ | Nav “Nhật ký” theo quyền |
| Ma trận quyền 11.2 có test; T34 cho vai trò mới (đối tượng tòa khác 404, danh sách, dashboard, CSV) | ✅ | `test/access/roles-v11.int.test.ts` |

**Lỗi tìm thấy khi test mobile và đã sửa:** trang có bảng bị rộng hơn màn hình điện thoại (tiêu đề `sr-only` thoát khung cuộn) —
sửa chung ở `Table`; thân hộp thoại thiếu `min-h-0`; dòng quyền dài làm tràn ngang hộp thoại.

Kiểm tra (07/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | ✅ |
| `pnpm test` | ✅ 100 (shared 16, api 78, web 6) |
| `pnpm test:integration` | ✅ **300** (24 file; test Phase 1 “ACCOUNTANT chưa kích hoạt” đổi thành “đã kích hoạt”) |
| `pnpm test:e2e specs/permissions.spec.ts specs/reminders.spec.ts` | ✅ 10 |
| `pnpm test:e2e` (toàn bộ) | ⏳ Chờ chủ dự án chạy |

## Phase 11 — Hợp đồng nâng cao và kỳ phát hành ✅

Nhánh `phase/11-contracts-periods`. Quyết định: D-037.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Phụ lục hợp đồng: `POST/GET /contracts/:id/revisions`; giá/kỳ hạn/cọc/báo trước/ghi chú, có lịch sử trước–sau | ✅ | Giá mới có `source_contract_id`; cọc áp từ ngày hiệu lực |
| Đóng/mở tháng phát hành: `POST /statement-periods/:id/close`, `/reopen` (quyền, lý do, audit) | ✅ | T36 |
| Chặn thao tác trên kỳ đã đóng: tạo/tính lại/phát hành/hủy chứng từ, nhận phòng lùi ngày, nhập/sửa chỉ số, điều chỉnh/quyết toán trong tháng đóng | ✅ | Thu tiền vào nợ cũ vẫn được |
| Cảnh báo hết hạn 30/15/7 ngày, không tạo trùng cùng mốc, xác nhận đã xử lý | ✅ | `GET /contract-alerts`, `POST /contract-alerts/:id/ack` |
| Ràng buộc SQL: `statement_periods_closed_chk`, `contract_revisions_no_chk`, `contract_alerts_milestone_chk` | ✅ | T47 |
| UI: nút “Phụ lục” và danh sách phụ lục ở trang lần thuê; trang “Kỳ phát hành”; thẻ cảnh báo ở Hợp đồng và Tổng quan | ✅ | |

**Lỗi tìm thấy nhờ test và đã sửa:** sau khi xác nhận cảnh báo mốc 15 ngày, cảnh báo mốc 30 cũ hiện lại — mốc mới nhất nay tính trên mọi
cảnh báo kể cả đã xác nhận.

Kiểm tra (07/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | ✅ |
| `pnpm test` | ✅ 100 |
| `pnpm test:integration` | ✅ **310** (25 file; T47: 143) |
| `pnpm test:e2e specs/contracts-v11.spec.ts specs/contracts.spec.ts specs/billing.spec.ts specs/reports.spec.ts` | ✅ (contracts.spec sửa selector do thẻ cảnh báo mới) |
| `pnpm test:e2e` (toàn bộ) | ⏳ Chờ chủ dự án chạy |

## Phase 12 — Tài chính mở rộng ✅ (báo cáo thuế chờ mẫu)

Nhánh `phase/12-finance`. Quyết định: D-038.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Chi phí: `GET/POST /expenses`, `POST /expenses/:id/reverse`; quyền `expenses.view`/`expenses.record`; CHECK thủ công | ✅ | Đảo cần `finance.reverse` + lý do |
| Doanh thu theo khoản thu / tòa / phòng (`/reports/revenue-breakdown`) | ✅ | Tổng khớp doanh thu thuần theo tháng |
| Dòng tiền (`/reports/cash-flow`), lấp đầy theo ngày-phòng (`/reports/occupancy`), chi phí & thu nhập vận hành (`/reports/operating`) | ✅ | Xuất CSV cả 4 |
| T38 đầy đủ: doanh thu, thực thu, cọc, hoàn tiền, chi phí không trộn; tiền giữ chỗ bị giữ lại là thu nhập khác | ✅ | `test/reports/finance.int.test.ts` |
| UI: trang Chi phí (ghi, đảo, lọc), 4 tab báo cáo mới | ✅ | |
| Báo cáo phục vụ kê khai thuế | ⛔ Chờ chủ dự án | Cần mẫu báo cáo (MASTER_PLAN 2.3 mục 2) |

Kiểm tra (07/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | ✅ |
| `pnpm test` | ✅ 100 |
| `pnpm test:integration` | ✅ **318** (26 file; T47: 149) |
| `pnpm test:e2e specs/finance.spec.ts specs/reports.spec.ts` | ✅ (mỗi spec 1 bỏ qua có chủ đích trên mobile) |
| `pnpm test:e2e` (toàn bộ) | ⏳ Chờ chủ dự án chạy |

## Phase 13 — Vận hành ✅

Nhánh `phase/13-operations`. Quyết định: D-039.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Kho tệp riêng tư (`StorageAdapter` thư mục riêng; volume `files` ở Docker), readiness kiểm tra kho | ✅ | S3/R2 chưa cần |
| `POST/GET /files`, `GET /files/:id/content`, `POST /files/:id/archive`; quyền theo đối tượng, ảnh CCCD cần `files.identity.view` | ✅ | T34 cho tệp |
| Yêu cầu bảo trì `GET/POST /maintenance-requests`, `PATCH /maintenance-requests/:id`; việc cần xử lý | ✅ | |
| Sao lưu/khôi phục/diễn tập gồm tệp, đối chiếu sha256 với bảng `files` | ✅ | Diễn tập đạt; diễn tập phát hiện đúng tệp bị sửa |
| UI: khối “Tệp đính kèm” ở người thuê, lần thuê, yêu cầu bảo trì; trang Bảo trì | ✅ | |
| Ràng buộc SQL `files_size_chk`, `files_archive_chk`, `maintenance_resolved_chk` | ✅ | T47 |

**Lỗi tìm thấy khi test và đã sửa:** tên tệp tiếng Việt bị hỏng mã hóa (multer đọc latin1); `tar` của Git Bash không hiểu đường dẫn Windows.

**Sự cố môi trường 07/10/2026:** máy bị tắt đột ngột lúc 8:10 → Docker Desktop mất khóa `CustomWslDistroDir` và sau đó tạo ổ tạm trống trên C. Đã khôi phục 9:20–9:30: sao lưu `docker_data.vhdx` sang `E:\DockerBackup\docker-data-D-20261007` (cùng kích thước, SHA-256 `A8768D1A…4A0CC3E2`), thử khóa trên bản sao ổ tạm, rồi trỏ lại `D:\DockerData\DockerDesktopWSL`. QL_TRO và cskh_hct đủ dữ liệu, cấu hình giữ sau khi tắt/mở. Test Phase 13 chạy trên ổ tạm (database test dựng lại từ đầu nên kết quả vẫn hợp lệ).

Kiểm tra (07/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | ✅ |
| `pnpm test` | ✅ 102 (api 80 — thêm test nhận diện tệp) |
| `pnpm test:integration` | ✅ **326** (27 file; T47: 155) |
| `pnpm test:e2e specs/maintenance.spec.ts` | ✅ (1 bỏ qua có chủ đích trên mobile) |
| `node scripts/db-restore.mjs --drill` (database tạm, có tệp) | ✅ ĐẠT; sửa nội dung tệp → báo “sai sha256” |
| Build lại image Docker | ⏳ Chưa build (ổ Docker tạm nằm trên C:); thay đổi Dockerfile: tạo `/data/files` thuộc user node |
| `pnpm test:e2e` (toàn bộ) | ⏳ Chờ chủ dự án chạy |

## Điều chỉnh: luồng điện nước theo thực tế (D-042) ✅

Thiết lập phòng có chỉ số ban đầu (một lần, không cần số seri) → nhận phòng điền sẵn → màn hình “Chốt chỉ số điện nước” theo tòa + tháng tiêu thụ
(ghi rõ vào thông báo tháng sau), lưu từng phòng/lưu tất cả, tiến độ theo phòng, phòng thiếu chỉ số nền thiết lập ngay → thông báo tháng sau gồm
tiền phòng tháng sau + điện nước tháng tiêu thụ. MASTER_PLAN v2.6 (8.5, 2.2, 11.2, 12).
Kiểm tra: lint, typecheck, build ✅; `pnpm test` 102 ✅; `pnpm test:integration` **336** ✅ (thêm `test/utilities/monthly-readings.int.test.ts`:
trọn luồng đến thông báo tháng 11 = 3.000.000 + 480.000 + 240.000); E2E utilities, tenancy, reports, billing ✅. Kiểm tra trên dev: phòng A102
(nhận 07/10) không hiện ở tháng tiêu thụ 09, hiện “Cần thiết lập” ở tháng 10.

**Demo cho chủ dự án (07/10/2026), database riêng `ql_tro_demo`:** `node apps/api/prisma/tools/demo-utilities.mjs reset` (Tòa Demo, A101/A102 nhận
01/09); server `api-demo` :4200 + `web-demo` http://127.0.0.1:3200 (`.claude/launch.json`; host khác localhost nên cookie không lẫn với dev).
Chạy trên giao diện: chọn Tòa Demo → chỉ số cũ tự điền → A101 350.000 + 75.000 = 425.000, A102 280.000 + 60.000 = 340.000 → lưu, tải lại vẫn giữ →
tạo nháp tháng 10: A101 3.425.000, A102 2.840.000. Không phát hành, không thu tiền, không gửi tin (payments/reminder_messages = 0).
Bổ sung sau demo: thẻ phòng có dòng tổng “điện + nước = tổng” riêng từng phòng; khung giải thích (chọn tòa = lọc, đơn giá theo tòa dùng chung,
không chia từ công tơ tổng); nhãn dòng điện nước trên thông báo ghi tháng tiêu thụ (“Điện tháng 09/2026 (01/09–07/10/2026): …”); liên kết
Điện nước ↔ Thông báo giữ tòa và đúng tháng; form đăng nhập `method="post"` (khi JS chưa chạy không đưa mật khẩu lên URL).
Kiểm tra: lint, typecheck ✅; `pnpm test` 102 ✅; integration billing/settlements/utilities 39 ✅; E2E utilities 4 ✅ (2 bỏ qua có chủ đích), billing, auth ✅.
Lối vào giá điện nước (chủ dự án không tìm thấy trong hộp “Sửa tòa”): danh sách tòa có cột “Giá điện · nước” (bấm tới mục giá), hộp “Sửa tòa” có
dòng hướng dẫn + liên kết, trang tòa có neo `#gia-dien-nuoc` tự cuộn tới mục giá; màn hình chốt chỉ số liên kết thẳng tới mục này.
Kiểm tra: lint, typecheck ✅; E2E property + utilities 8 ✅ (2 bỏ qua có chủ đích).

## Điều chỉnh: giá điện nước trong form tạo/sửa tòa (D-043) ✅

Tạo tòa có ô giá điện/nước (không bắt buộc); “Sửa tòa” hiện giá hiện tại, đổi giá thì chọn kỳ áp dụng + lý do (phiên bản giá mới, cùng transaction);
cùng kỳ chưa dùng trên thông báo đã phát hành thì ghi đè. MASTER_PLAN v2.7 (8.5).
Kiểm tra: lint, typecheck ✅; `pnpm test` 102 ✅; integration property/utilities/openapi/access/billing 67 ✅ (thêm
`test/property/building-meter-prices.int.test.ts` 2; T60 cập nhật: cùng kỳ chưa dùng → ghi đè); E2E property 6 ✅ (thêm test D-043, desktop + mobile),
utilities ✅. Thử trên demo: Sửa tòa DEMO đổi điện 3.800 từ kỳ 11/2026, tạo tòa THU kèm giá điện 4.000 (sau đó dựng lại demo).

## Điều chỉnh sau Phase 14 — chỉ hai vai trò (D-041) ✅

Chủ dự án chốt: chỉ Chủ trọ + Quản lý. API/giao diện chỉ gán hai vai trò; Quản lý thêm quyền ghi nhận thu; Nhân viên/Kế toán là vai trò cũ.
Database dev: `db:bootstrap` (chỉ đồng bộ quyền) + chuyển 3 tài khoản sang Quản lý qua API; không seed lại.
Kiểm tra: lint, typecheck, build ✅; `pnpm test` 102 ✅; `pnpm test:integration` **333** ✅; E2E auth, property, maintenance, finance,
contracts-v11, reminders, reports, permissions ✅ (sửa phụ thuộc giữa `permissions.spec` và `reports.spec`: cấp quyền riêng cho Quản lý Tòa B, C).

## Phase 14 — Chuyển phòng ✅ (ẩn danh dữ liệu chờ yêu cầu pháp lý)

Nhánh `phase/14-transfers`. Quyết định: D-040.

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| `POST /tenancies/:id/transfer`: nhận phòng mới + chuyển cọc bằng cặp TRANSFER_OUT/IN + `room_transfers`, một transaction | ✅ | T48 |
| Liên kết hai chiều trên chi tiết lần thuê (`transferred_to` / `transferred_from`) | ✅ | |
| Đảo cặp chuyển cọc: đảo cả cặp, chặn khi cọc phía nhận đã dùng; sửa thứ tự khóa | ✅ | |
| Ràng buộc `room_transfers_deposit_chk`, `room_transfers_distinct_chk` | ✅ | T47 |
| UI: khối “Chuyển sang phòng khác” ở lần thuê đã trả phòng; liên kết phòng cũ/mới | ✅ | |
| Chính sách lưu trữ và ẩn danh dữ liệu cá nhân | ⛔ Chờ chủ dự án | Cần yêu cầu pháp lý, thời hạn lưu |

**Áp migration vào database dev (07/10/2026 9:25):** xác nhận cổng 55432 thuộc `ql-tro-postgres-1` (tạo 06/10) chạy trên ổ dữ liệu D; sao lưu
riêng trước: `backups/ql_tro-20261007-022510.dump` (+ `.sha256`, `pg_restore --list` 54 bảng). Rà SQL: chỉ tạo bảng `room_transfers`
(1 bảng, 5 index, 4 FK, 2 CHECK), không DROP/DELETE/UPDATE/INSERT. Áp bằng `prisma migrate deploy`; dữ liệu dev không đổi (5 user, 48 phòng,
79 dòng nhật ký). Không reset, không seed lại; không tác động cskh_hct.

Kiểm tra (07/10/2026):

| Lệnh | Kết quả |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | ✅ |
| `pnpm test` | ✅ 102 |
| `pnpm test:integration` | ✅ **333** (28 file; T47: 159; T48: 3) |
| `pnpm test:e2e specs/transfer.spec.ts specs/move-out.spec.ts specs/tenancy.spec.ts` | ✅ 7 (1 bỏ qua có chủ đích trên mobile) |
| `pnpm test:e2e` (toàn bộ) | ⏳ Chờ chủ dự án chạy |

## Kiểm tra toàn bộ + demo có ảnh (09–10/10/2026) ✅

| Lệnh | Kết quả |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | ✅ |
| `pnpm test` | ✅ 102 |
| `pnpm test:integration` | ✅ **338** (30 file) |
| `pnpm test:e2e --trace on` (toàn bộ, chủ dự án yêu cầu) | ✅ **59 đạt**, 7 bỏ qua có chủ đích (mobile), 6,4 phút |

Hai lượt đầu lỗi do dữ liệu test dùng chung (không phải lỗi chức năng), đã sửa: `utilities.spec` dùng A301/B301 (trùng A104/B104 với
`contracts-v11`), `property.spec` lưu trữ tòa thử, các lệnh bấm menu dùng `exact` (Tổng quan có liên kết “Bảo trì 0”).

**Vòng demo có ảnh** (`e2e/demo/walkthrough.spec.ts`, chạy trên bản demo, ảnh ở `e2e/demo/screenshots/`, không commit): 24 bước — chốt điện
nước, tạo nháp, phát hành, QR, thu một phần, đảo phiếu thu, thu đủ, link gửi khách, người ở cùng, tạm trú, dịch vụ, đóng/mở lại kỳ, trả phòng
có quyết toán, chi phí, báo cáo, bảo trì, nhật ký ✅.

Lỗi tìm thấy và đã sửa: **sao kê công nợ** xếp các dòng cùng ngày bằng phép so sánh không nhất quán → dòng “Đảo phiếu thu” có thể đứng trước
phiếu thu gốc, số dư nhảy lên con số chưa từng có (số dư cuối vẫn đúng). Nay cùng ngày xếp theo thời điểm ghi nhận; thêm test hồi quy
(`payments.int.test.ts`, T37). Integration payments/settlements/tenancy/billing/contracts 71 ✅.

Điều chỉnh hiển thị theo góp ý chủ dự án:
- Tổng quan: ô “Bảo trì” → “Ngừng cho thuê (bảo trì)” (đếm phòng tạm ngừng cho thuê, khác yêu cầu sửa chữa ở Việc cần xử lý);
  “Phát sinh tháng” → “Tổng tiền thông báo tháng …”; “Thực thu trong tháng (phiếu thu)” → “Tiền nhận trong tháng”.
- Báo cáo doanh thu theo tháng: mặc định 4 cột Tổng tiền thông báo / Đã thu / Còn nợ / Tiền nhận trong tháng (tổng chia thành Đã thu và Còn nợ);
  Giảm trừ, Doanh thu thuần, cách thu (tiền mặt/CK, trừ cọc, cấn trừ tiền dư) ở “Xem chi tiết”, có nhắc khi khác 0. CSV đổi tên cột theo màn
  hình, số liệu không đổi. Kiểm tra: lint, typecheck ✅; integration reports 6 ✅; E2E reports, finance, maintenance 9 ✅.

Ghi nhận, chờ chủ dự án quyết (chưa đổi): chốt điện nước và trả phòng **cùng ngày** bị chặn chỉ số cuối (một chỉ số/đồng hồ/ngày); thông báo
lập sau ngày đến hạn (ngày 5) hiện “Quá hạn” ngay khi phát hành; tùy chọn tính đủ tháng khi nhận/trả phòng giữa tháng.

## Điều chỉnh: ân hạn 7 ngày khi lập thông báo muộn (D-044) ✅ · đổi tên cột báo cáo

- Thông báo tháng lập/tính lại/phát hành khi hạn theo lịch đã qua → hạn = ngày đó + 7 ngày (`domain/billing/due-date.ts`); còn trong hạn giữ
  nguyên. Thông báo trả phòng và điều chỉnh không đổi. MASTER_PLAN v2.8.
- Báo cáo doanh thu: “Tiền phải thu” → **“Tổng tiền thông báo”** (chia thành Đã thu + Còn nợ) để không nhầm với “còn phải thu”; Tổng quan
  “Tổng tiền thông báo tháng …”; CSV cùng tên.
- Kiểm tra: lint, typecheck ✅; unit api 83 ✅ (thêm `due-date.test.ts` 3); `pnpm test:integration` toàn bộ **338** ✅ trước khi thêm test,
  thêm test D-044 trong `monthly-readings.int.test.ts` (4/4 ✅: lập 09/11 → hạn 16/11, phát hành 12/11 → 19/11 chưa quá hạn; phát hành 01/12 →
  05/12; nhận phòng phát hành cùng ngày → hạn ngày nhận); E2E reports, billing, payments, reminders 12 ✅.
