# Dữ liệu demo và kịch bản

Mọi dữ liệu seed là hư cấu. Anchor date: `2026-10-01` (đổi bằng `SEED_ANCHOR_DATE`).

## Phase 0

Workspace **Nhà trọ Demo** (múi giờ Asia/Ho_Chi_Minh), 3 tòa:

| Mã | Tên |
|---|---|
| A | Tòa A — Hẻm 12 Đường Số 7 |
| B | Tòa B — Khu Phố Xanh |
| C | Tòa C — Ngõ Bình Yên |

Tài khoản (mật khẩu lấy từ `.env`: `SEED_OWNER_PASSWORD`, `SEED_STAFF_PASSWORD`):

| Email | Vai trò | Phạm vi |
|---|---|---|
| `owner@example.test` | OWNER | Mọi tòa |
| `staff.a@example.test` | STAFF | Tòa A |
| `staff.bc@example.test` | STAFF | Tòa B, C |

### Kịch bản kiểm tra tay

1. Mở http://localhost:3000 khi chưa đăng nhập: tự chuyển tới `/login`.
2. Đăng nhập sai mật khẩu: thông báo “Email hoặc mật khẩu không đúng.”
3. Đăng nhập `owner@example.test`: trang Tổng quan liệt kê 3 tòa, vai trò OWNER, 36 quyền.
4. Đăng xuất, đăng nhập `staff.a@example.test`: chỉ thấy Tòa A, 10 quyền.
5. Thu nhỏ cửa sổ (điện thoại): nút menu mở sidebar; các mục chưa triển khai hiện mờ kèm nhãn phase.
6. Swagger: http://localhost:4000/api/v1/docs (không bật ở production).

Phòng, người thuê, hợp đồng và các kịch bản ở MASTER_PLAN mục 15 được bổ sung từ Phase 1.
