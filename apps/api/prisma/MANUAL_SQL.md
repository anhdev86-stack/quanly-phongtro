# Ràng buộc SQL thủ công

Tài liệu này là **danh mục chính thức** của mọi ràng buộc không khai báo trong `schema.prisma` (MASTER_PLAN mục 3.6, 6.8).
Test `test/schema/manual-constraints.int.test.ts` (T47) đọc khối `json manual-constraints` bên dưới và kiểm tra:

1. **Định nghĩa:** `pg_get_constraintdef` / `pg_get_indexdef` khớp đúng chuỗi `definition`.
2. **Hành vi:** mỗi ràng buộc có ít nhất một case dữ liệu vi phạm bị từ chối và một case hợp lệ sát biên được chấp nhận.
   Test thất bại nếu ràng buộc nào trong danh mục chưa có test hành vi.

## Quy trình khi thêm hoặc đổi ràng buộc

1. Sửa `schema.prisma`, chạy `pnpm --filter @ql-tro/api exec prisma migrate dev --create-only --name <tên>`.
2. Rà **từng lệnh** trong file SQL sinh ra:
   - DROP nhắm vào ràng buộc thủ công mà migration này không định đổi → xóa lệnh đó.
   - Ràng buộc cần đổi định nghĩa → giữ DROP và tạo lại ngay trong cùng migration, cập nhật danh mục.
   - Ghi chú lý do trong file migration.
3. Thêm SQL thủ công vào chính file migration; cập nhật danh mục dưới đây (định nghĩa lấy từ `pg_get_constraintdef`).
4. Áp dụng migration, chạy `pnpm test:integration`.

## Cách triển khai theo phiên bản Prisma đã pin (7.10.0)

| Loại ràng buộc | Prisma 7.10.0 | Cách làm trong dự án |
|---|---|---|
| Unique / index thường, FK, FK kép | Hỗ trợ ổn định | Khai báo trong `schema.prisma` |
| Partial unique index (`WHERE …`) | Chỉ ở dạng **preview** `partialIndexes` (từ 7.4.0), cú pháp `@@unique([...], where: raw("..."))` | **SQL thủ công** cho tới khi chủ dự án chấp nhận dùng preview (xem DECISIONS D-007). Trước Phase 1 phải kiểm tra Prisma có sinh DROP cho partial index viết tay hay không. |
| CHECK | Không hỗ trợ | SQL thủ công. Đã kiểm chứng 06/10/2026: `migrate dev` **không** sinh DROP cho CHECK viết tay (migration kiểm tra rỗng). |
| EXCLUDE (btree_gist) | Không hỗ trợ | SQL thủ công |
| Khóa dòng `FOR UPDATE` | Không có API | `src/infrastructure/locking/lock-rows.ts` |

## Danh mục

| Tên | Bảng | Loại | Migration | Ý nghĩa |
|---|---|---|---|---|
| `btree_gist` | — | extension | `20261006033038_manual_constraints_phase0` | Cho exclusion constraint ở các phase sau |
| `users_email_lowercase_chk` | users | CHECK | `20261006033038_manual_constraints_phase0` | Email luôn chữ thường |
| `refresh_sessions_expiry_chk` | refresh_sessions | CHECK | `20261006033038_manual_constraints_phase0` | Hết hạn sau thời điểm tạo |
| `idempotency_requests_key_format_chk` | idempotency_requests | CHECK | `20261006033038_manual_constraints_phase0` | Định dạng Idempotency-Key |
| `idempotency_requests_done_has_status_chk` | idempotency_requests | CHECK | `20261006033038_manual_constraints_phase0` | Bản ghi DONE có HTTP status để trả lại |

```json manual-constraints
[
  {
    "name": "btree_gist",
    "kind": "extension",
    "table": null,
    "definition": "btree_gist"
  },
  {
    "name": "users_email_lowercase_chk",
    "kind": "check",
    "table": "users",
    "definition": "CHECK ((email = lower(email)))"
  },
  {
    "name": "refresh_sessions_expiry_chk",
    "kind": "check",
    "table": "refresh_sessions",
    "definition": "CHECK ((expires_at > created_at))"
  },
  {
    "name": "idempotency_requests_key_format_chk",
    "kind": "check",
    "table": "idempotency_requests",
    "definition": "CHECK ((key ~ '^[A-Za-z0-9_-]{8,128}$'::text))"
  },
  {
    "name": "idempotency_requests_done_has_status_chk",
    "kind": "check",
    "table": "idempotency_requests",
    "definition": "CHECK (((status <> 'DONE'::\"IdempotencyStatus\") OR (response_status IS NOT NULL)))"
  }
]
```
