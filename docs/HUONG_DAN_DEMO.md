# Hướng dẫn tự thử toàn bộ chức năng trên bản demo

Bản demo chạy trên database riêng `ql_tro_demo`, không đụng dữ liệu dev (`ql_tro`). Mọi thao tác ở đây có thể làm lại từ đầu.

## Chuẩn bị

| Việc | Cách làm |
|---|---|
| Mở bản demo | http://127.0.0.1:3200 (dùng 127.0.0.1 để phiên đăng nhập không lẫn với bản dev ở localhost:3000) |
| Tài khoản chủ trọ | `owner@example.test`, mật khẩu: biến `SEED_OWNER_PASSWORD` trong `.env` |
| Tài khoản quản lý | `manager.a@example.test` (tòa A), `manager.bc@example.test` (tòa B, C), mật khẩu: biến `SEED_STAFF_PASSWORD` |
| Chạy server demo | Trong Claude Code: `api-demo` (:4200) và `web-demo` (:3200) ở `.claude/launch.json` |
| Đưa demo về ban đầu | `node apps/api/prisma/tools/demo-utilities.mjs reset` (cần `api-demo` đang chạy; đăng nhập lại sau đó) |

Dữ liệu ban đầu:

- Tòa A, B, C: mỗi tòa 15 phòng trống, có giá điện nước mẫu. Tài khoản nhận tiền mẫu (không chuyển tiền thật).
- **Tòa Demo**: điện 3.500 đ/kWh, nước 15.000 đ/m³. A101 (thuê 3.000.000) và A102 (thuê 2.500.000) có khách từ 01/09/2026,
  thông báo tháng 9 đã phát hành, chưa thu tiền. Chỉ số lúc nhận phòng: A101 điện 1000 / nước 50; A102 điện 2000 / nước 80.
- Nhắc đóng tiền chỉ ghi nhật ký, **không gửi tin thật**. QR chỉ là mã mẫu.

## Bảng kiểm theo chức năng

Đánh dấu khi thử xong. Thứ tự gợi ý đi theo vòng đời một lần thuê.

### 1. Đăng nhập và phân quyền

- [ ] Mở trang bất kỳ khi chưa đăng nhập → bị chuyển về **Đăng nhập**. Sai mật khẩu → báo lỗi tiếng Việt.
- [ ] Chủ trọ thấy cả 4 tòa; đăng nhập `manager.a` chỉ thấy tòa A (không thấy Báo cáo, Chi phí chỉ xem).
- [ ] **Cấu hình → Người dùng**: thêm tài khoản (chỉ chọn Chủ trọ hoặc Quản lý); nút **Quyền** để cấp/thu hồi quyền riêng.
- [ ] **Nhật ký**: xem ai làm gì, lúc nào (chủ trọ thấy tất cả; quản lý chỉ thấy nhật ký vận hành).

### 2. Tòa/khu & Phòng

- [ ] Tab **Tòa/khu** → **Thêm tòa**: nhập mã, tên, **giá điện / giá nước** (không bắt buộc).
- [ ] Bút chì **Sửa tòa**: đổi giá → chọn **Áp dụng từ** (kỳ M = điện nước tháng M−1) và **Lý do đổi giá**. Cột “Giá điện · nước” hiện giá đang áp dụng.
- [ ] Bấm mã tòa → trang tòa: mục **Giá điện nước** có lịch sử giá; **Xem phòng của tòa**.
- [ ] Tab **Phòng** → **Thêm phòng**: giá thuê mặc định, sức chứa, **chỉ số điện/nước ban đầu** (nhập một lần).
- [ ] Trang phòng: **Chuyển bảo trì** (có lý do), **Lưu trữ**.

### 3. Giữ phòng

- [ ] Trang phòng trống → **Giữ phòng** (người giữ chỗ, ngày dự kiến nhận) → trạng thái “Đã giữ”.
- [ ] **Tiền giữ chỗ**: ghi khoản khách đặt trước. **Hủy giữ phòng** bắt buộc lý do.
- [ ] **Nhận phòng từ lượt giữ này**: tiền giữ chỗ tự chuyển thành tiền cọc.

### 4. Nhận phòng, người thuê, cọc

- [ ] Trang phòng trống → **Nhận phòng** (trình từng bước): khách mới hoặc có sẵn, ngày nhận, giá thuê, cọc yêu cầu, dịch vụ,
      chỉ số điện nước (điền sẵn từ đồng hồ), hợp đồng (không bắt buộc) → **Tiếp** … → hoàn tất. Phòng chuyển “Đang thuê”.
- [ ] Lần thuê → **Ghi giao dịch cọc** (thu cọc, đã có tiền giữ chỗ thì hiển thị chuyển sang cọc).
- [ ] **Người thuê**: thêm/sửa, thêm người ở cùng, theo dõi đăng ký tạm trú.

### 5. Hợp đồng

- [ ] **Lần thuê & Hợp đồng** → hợp đồng: **Gia hạn** (giá thuê theo kỳ mới), **Hủy** kỳ chưa bắt đầu (có lý do).
- [ ] **Phụ lục** (đổi ngày kết thúc); **Đổi giá thuê** từ một ngày; cảnh báo hợp đồng sắp hết hạn (mốc 30/15/7 ngày).

### 6. Điện nước (dùng Tòa Demo)

- [ ] **Điện nước** → chọn **Tòa Demo**, **Tháng tiêu thụ 09/2026**: chỉ số cũ tự điền (1000/50, 2000/80).
- [ ] Nhập A101: 1100 và 55 → **425.000 ₫**; A102: 2080 và 84 → **340.000 ₫**. **Lưu phòng** / **Lưu tất cả**, tải lại vẫn giữ.
- [ ] Đổi sang tháng tiêu thụ 10/2026: chỉ số cũ là số vừa chốt tháng 9.
- [ ] Số mới nhỏ hơn số cũ → báo lỗi, không cho lưu. Sửa chỉ số cũ (bút chì) bắt buộc lý do.

### 7. Thông báo tiền phòng

- [ ] Từ Điện nước bấm **Lập thông báo tháng 10/2026** → **Xem trước** (không ghi gì) → **Tạo nháp**.
- [ ] Mở nháp: tiền phòng tháng 10 (thu trước) + điện nước tháng 9 (thu sau). **Tính lại**, **Hủy nháp**.
- [ ] **Phát hành** → có số chứng từ; **In** (trang in ghi “Chứng từ nội bộ, không phải hóa đơn GTGT”).
- [ ] **Kỳ phát hành**: đóng kỳ (chặn sửa chứng từ của kỳ), mở lại có lý do.

### 8. Thu tiền & công nợ

- [ ] Thông báo đã phát hành → mã **VietQR** có sẵn số tiền và nội dung chuyển khoản (tài khoản mẫu).
- [ ] **Ghi nhận thu**: số tiền (thu một phần được), cách thu, mã giao dịch → trạng thái “Thu một phần”/“Đã thu đủ”; có phiếu thu.
- [ ] **Sao chép link gửi khách**: mở link ở cửa sổ ẩn danh → khách xem thông báo + QR không cần đăng nhập.
- [ ] **Thu tiền & Công nợ**: danh sách còn nợ, quá hạn; đảo phiếu thu (có lý do).

### 9. Trả phòng, quyết toán, chuyển phòng

- [ ] Lần thuê → **Báo trả phòng** (ngày dự kiến) → “Đang báo trả”.
- [ ] **Trả phòng**: chỉ số cuối, kiểm kê/bồi thường → **Lưu & xem trước** → **Duyệt quyết toán** → **Hoàn tất trả phòng**.
- [ ] **Cọc & Trả phòng**: **Hoàn cọc** hoặc áp cọc vào nợ; số dư về “Đã cân bằng”. Phòng về “Trống”.
- [ ] Lần thuê đã trả → **Chuyển sang phòng khác**: chọn phòng trống, chỉ số ban đầu, cọc chuyển theo; hai lần thuê liên kết nhau.

### 10. Dịch vụ

- [ ] **Dịch vụ**: Internet, rác, gửi xe, nước theo người… đổi giá có ngày hiệu lực; bật/tắt dịch vụ cho từng lần thuê.

### 11. Nhắc đóng tiền (không gửi tin thật)

- [ ] **Người thuê** → **Ghi nhận đồng ý** nhận tin. **Cấu hình → Nhắc đóng tiền**: bật nhắc, chọn mốc trước/đúng/quá hạn.
- [ ] **Nhắc đóng tiền** → **Chạy nhắc ngay**: nhật ký ghi lượt nhắc (chỉ ghi log), gửi lại khi lỗi.

### 12. Chi phí, báo cáo, tổng quan

- [ ] **Chi phí** → **Ghi chi phí** (tòa, khoản, số tiền) → **Đảo** có lý do.
- [ ] **Báo cáo**: doanh thu theo tháng (đã phát hành / đã thu / còn nợ), dòng tiền, chi phí & thu nhập vận hành, lấp đầy, cọc; **Xuất CSV**.
- [ ] **Tổng quan**: phòng theo trạng thái, tiền phải thu/quá hạn, việc cần xử lý (chưa chốt chỉ số, nháp, quá hạn…).

### 13. Bảo trì và tệp

- [ ] **Bảo trì** → **Tạo yêu cầu** (tòa, phòng, nội dung, mức ưu tiên) → đính kèm ảnh → **Nhận xử lý** → **Đã sửa xong**.
- [ ] Ảnh/tệp riêng tư: mở qua link có kiểm tra quyền (đăng xuất thì không mở được).

## Kiểm tra tự động

Kết quả lần chạy gần nhất: xem `docs/IMPLEMENTATION_STATUS.md`, mục “Kiểm tra toàn bộ”.
Báo cáo E2E có từng bước kèm ảnh: `pnpm --filter @ql-tro/e2e exec playwright show-report`.
