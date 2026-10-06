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

## Phase 2 — Tenant, Tenancy, cọc, tiền giữ chỗ ⬜

- [ ] Người thuê, thành viên, tạm trú; nhận phòng (7.2 bước 1–7)
- [ ] Sổ cọc, sổ giữ chỗ, chuyển đổi và đảo cả cặp
- [ ] T01 (phần nhận phòng), T02, T03, T32, T43, T55 (phần nhận phòng), T56

## Phase 3 — Contract và Pricing (lõi) ⬜

- [ ] Nháp/ký, trạng thái suy ra, `rental_mode`, gia hạn, hủy hợp đồng chưa bắt đầu, đổi giá
- [ ] T04 (phần), T05–T08, T09 (phần), T50 (phần)

## Phase 4 — Utilities và Services ⬜

- [ ] Dịch vụ, `charge_timing`, subscription, đồng hồ, chỉ số, màn hình nhập trên điện thoại
- [ ] Giá điện nước theo tòa + nút “Thay đổi giá” + lịch sử; chỉ số trước tự lấy; tiền tạm tính (v2.4)
- [ ] T12 (phần), T13, T14 (phần), T60 (phần), T61 (phần)

## Phase 5 — Billing Engine ⬜ (bị chặn bởi B-1…B-4)

- [ ] Chốt B-1, B-2, B-3, B-4 với chủ dự án
- [ ] Domain tính phí, đối soát, generate/publish, trang in
- [ ] Chạy lại toàn bộ test Phase 0–4; T01, T04, T09, T10, T12, T14–T16, T19, T39–T42, T45–T47, T49, T50, T54, T60 (phần), T61 (phần)

## Phase 6 — Payment, Credit và công nợ ⬜

- [ ] Phiếu thu, công nợ, credit
- [ ] Tài khoản nhận tiền, VietQR, link xem thông báo, trang công khai (v2.4) — T57–T59

## Phase 7 — Trả phòng và quyết toán ⬜

## Phase 8A — Dashboard và báo cáo MVP ⬜

- [ ] Báo cáo doanh thu theo tháng (v2.4) — T65

## Phase 8B — Nhắc đóng tiền qua Zalo/SMS ⬜ (gửi thật chờ N-1…N-5)

- [ ] Lập lịch, nhật ký, `LogOnlyChannel`, đồng ý nhận tin — T62–T64
- [ ] Adapter Zalo ZNS / SMS khi chủ dự án đã chốt nhà cung cấp
## Phase 9 — MVP release readiness ⬜
## Phase 10–14 — V1.1 ⬜
