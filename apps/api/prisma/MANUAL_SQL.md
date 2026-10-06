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
3. Thêm SQL thủ công vào chính file migration, áp dụng, rồi chạy `node prisma/tools/sync-manual-catalog.mjs <tên…>` để cập nhật khối JSON (định nghĩa lấy trực tiếp từ database dev) và thêm dòng vào bảng.
4. Áp dụng migration, chạy `pnpm test:integration`.

## Cách triển khai theo phiên bản Prisma đã pin (7.10.0)

| Loại ràng buộc | Prisma 7.10.0 | Cách làm trong dự án |
|---|---|---|
| Unique / index thường, FK, FK kép | Hỗ trợ ổn định | Khai báo trong `schema.prisma` |
| Partial unique index (`WHERE …`) | Chỉ ở dạng **preview** `partialIndexes` (từ 7.4.0) | **SQL thủ công** (chủ dự án chốt 06/10/2026). Đã kiểm chứng ở Phase 2: `migrate dev` **không** sinh DROP cho partial index viết tay. |
| CHECK | Không hỗ trợ | SQL thủ công. Đã kiểm chứng 06/10/2026: `migrate dev` **không** sinh DROP cho CHECK viết tay (migration kiểm tra rỗng). |
| EXCLUDE (btree_gist) | Không hỗ trợ | SQL thủ công. Đã kiểm chứng 06/10/2026: `migrate dev` **không** sinh DROP cho EXCLUDE viết tay. |
| Khóa dòng `FOR UPDATE` | Không có API | `src/infrastructure/locking/lock-rows.ts` |

## Danh mục

| Tên | Bảng | Loại | Migration | Ý nghĩa |
|---|---|---|---|---|
| `btree_gist` | — | extension | `20261006033038_manual_constraints_phase0` | Cho exclusion constraint ở các phase sau |
| `users_email_lowercase_chk` | users | CHECK | `20261006033038_manual_constraints_phase0` | Email luôn chữ thường |
| `refresh_sessions_expiry_chk` | refresh_sessions | CHECK | `20261006033038_manual_constraints_phase0` | Hết hạn sau thời điểm tạo |
| `idempotency_requests_key_format_chk` | idempotency_requests | CHECK | `20261006033038_manual_constraints_phase0` | Định dạng Idempotency-Key |
| `idempotency_requests_done_has_status_chk` | idempotency_requests | CHECK | `20261006033038_manual_constraints_phase0` | Bản ghi DONE có HTTP status để trả lại |
| `rooms_default_rent_nonneg_chk` | rooms | CHECK | `20261006044705_phase1_property` | Giá thuê mặc định không âm |
| `rooms_max_occupants_chk` | rooms | CHECK | `20261006044705_phase1_property` | Sức chứa 1–50 |
| `reservations_dates_order_chk` | reservations | CHECK | `20261006044705_phase1_property` | hold_from ≤ expected_move_in ≤ hold_until |
| `no_overlapping_active_reservations` | reservations | EXCLUDE | `20261006044705_phase1_property` | Giữ phòng ACTIVE không chồng lịch |
| `one_open_tenancy_per_room` | tenancies | PARTIAL UNIQUE | `20261006051548_phase2_tenancy` | Một tenancy chưa ENDED mỗi phòng |
| `tenancies_charge_end_chk` | tenancies | CHECK | `20261006051548_phase2_tenancy` | charge_end_exclusive > start_date |
| `tenancies_billing_due_day_chk` | tenancies | CHECK | `20261006051548_phase2_tenancy` | Ngày đến hạn 1–31 |
| `tenancies_deposit_required_chk` | tenancies | CHECK | `20261006051548_phase2_tenancy` | Mức cọc yêu cầu không âm |
| `one_current_primary` | tenancy_tenants | PARTIAL UNIQUE | `20261006051548_phase2_tenancy` | Một PRIMARY đang ở |
| `tenancy_tenants_dates_chk` | tenancy_tenants | CHECK | `20261006051548_phase2_tenancy` | left_on_exclusive > joined_on |
| `no_overlapping_membership` | tenancy_tenants | EXCLUDE | `20261006051548_phase2_tenancy` | Một người không ở chồng hai khoảng trong cùng tenancy |
| `one_active_rent_price_per_day` | rent_price_history | PARTIAL UNIQUE | `20261006051548_phase2_tenancy` | Một giá ACTIVE mỗi ngày hiệu lực |
| `rent_price_nonneg_chk` | rent_price_history | CHECK | `20261006051548_phase2_tenancy` | Giá thuê không âm |
| `no_overlapping_tenancy_services` | tenancy_services | EXCLUDE | `20261006051548_phase2_tenancy` | Subscription cùng dịch vụ không chồng ngày (D-024) |
| `tenancy_services_dates_qty_chk` | tenancy_services | CHECK | `20261006051548_phase2_tenancy` | Số lượng ≥ 0, ngày kết thúc sau ngày bắt đầu |
| `services_meter_chk` | services | CHECK | `20261006051548_phase2_tenancy` | METER có loại đồng hồ và thu sau |
| `one_active_meter_per_type` | meters | PARTIAL UNIQUE | `20261006051548_phase2_tenancy` | Một đồng hồ hoạt động mỗi loại mỗi phòng |
| `meters_initial_reading_chk` | meters | CHECK | `20261006051548_phase2_tenancy` | Chỉ số ban đầu ≥ 0 |
| `meter_readings_value_chk` | meter_readings | CHECK | `20261006051548_phase2_tenancy` | Chỉ số ≥ 0 |
| `deposit_amount_positive_chk` | deposit_transactions | CHECK | `20261006051548_phase2_tenancy` | Số tiền > 0 |
| `deposit_reversal_ref_chk` | deposit_transactions | CHECK | `20261006051548_phase2_tenancy` | REVERSAL ⇔ có giao dịch gốc |
| `holding_amount_positive_chk` | holding_transactions | CHECK | `20261006051548_phase2_tenancy` | Số tiền > 0 |
| `holding_reversal_ref_chk` | holding_transactions | CHECK | `20261006051548_phase2_tenancy` | REVERSAL ⇔ có giao dịch gốc |
| `contracts_term_chk` | contracts | CHECK | `20261006080717_phase3_contracts` | term_end ≥ term_start |
| `contracts_signed_at_chk` | contracts | CHECK | `20261006080717_phase3_contracts` | SIGNED phải có ngày ký |
| `no_overlapping_signed_contracts` | contracts | EXCLUDE | `20261006080717_phase3_contracts` | Kỳ SIGNED không chồng ngày |
| `contract_effective_status` | — | FUNCTION | `20261006080717_phase3_contracts` | Trạng thái hợp đồng theo ngày (khớp domain, T05) |

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
  },
  {
    "name": "rooms_default_rent_nonneg_chk",
    "kind": "check",
    "table": "rooms",
    "definition": "CHECK ((default_rent_vnd >= 0))"
  },
  {
    "name": "rooms_max_occupants_chk",
    "kind": "check",
    "table": "rooms",
    "definition": "CHECK (((max_occupants >= 1) AND (max_occupants <= 50)))"
  },
  {
    "name": "reservations_dates_order_chk",
    "kind": "check",
    "table": "reservations",
    "definition": "CHECK (((hold_from <= expected_move_in) AND (expected_move_in <= hold_until)))"
  },
  {
    "name": "no_overlapping_active_reservations",
    "kind": "exclude",
    "table": "reservations",
    "definition": "EXCLUDE USING gist (room_id WITH =, daterange(hold_from, (hold_until + 1), '[)'::text) WITH &&) WHERE ((status = 'ACTIVE'::\"ReservationStatus\"))"
  },
  {
    "name": "one_open_tenancy_per_room",
    "kind": "index",
    "table": "tenancies",
    "definition": "CREATE UNIQUE INDEX one_open_tenancy_per_room ON public.tenancies USING btree (room_id) WHERE (status = ANY (ARRAY['ACTIVE'::\"TenancyStatus\", 'NOTICE_GIVEN'::\"TenancyStatus\", 'MOVE_OUT_PROCESSING'::\"TenancyStatus\"]))"
  },
  {
    "name": "tenancies_charge_end_chk",
    "kind": "check",
    "table": "tenancies",
    "definition": "CHECK (((charge_end_exclusive IS NULL) OR (charge_end_exclusive > start_date)))"
  },
  {
    "name": "tenancies_billing_due_day_chk",
    "kind": "check",
    "table": "tenancies",
    "definition": "CHECK (((billing_due_day >= 1) AND (billing_due_day <= 31)))"
  },
  {
    "name": "tenancies_deposit_required_chk",
    "kind": "check",
    "table": "tenancies",
    "definition": "CHECK ((initial_deposit_required_vnd >= 0))"
  },
  {
    "name": "one_current_primary",
    "kind": "index",
    "table": "tenancy_tenants",
    "definition": "CREATE UNIQUE INDEX one_current_primary ON public.tenancy_tenants USING btree (tenancy_id) WHERE ((role = 'PRIMARY'::\"MemberRole\") AND (left_on_exclusive IS NULL))"
  },
  {
    "name": "tenancy_tenants_dates_chk",
    "kind": "check",
    "table": "tenancy_tenants",
    "definition": "CHECK (((left_on_exclusive IS NULL) OR (left_on_exclusive > joined_on)))"
  },
  {
    "name": "no_overlapping_membership",
    "kind": "exclude",
    "table": "tenancy_tenants",
    "definition": "EXCLUDE USING gist (tenancy_id WITH =, tenant_id WITH =, daterange(joined_on, left_on_exclusive, '[)'::text) WITH &&)"
  },
  {
    "name": "one_active_rent_price_per_day",
    "kind": "index",
    "table": "rent_price_history",
    "definition": "CREATE UNIQUE INDEX one_active_rent_price_per_day ON public.rent_price_history USING btree (tenancy_id, effective_from) WHERE (status = 'ACTIVE'::\"VersionStatus\")"
  },
  {
    "name": "rent_price_nonneg_chk",
    "kind": "check",
    "table": "rent_price_history",
    "definition": "CHECK ((monthly_rent_vnd >= 0))"
  },
  {
    "name": "no_overlapping_tenancy_services",
    "kind": "exclude",
    "table": "tenancy_services",
    "definition": "EXCLUDE USING gist (tenancy_id WITH =, service_id WITH =, daterange(effective_from, end_exclusive, '[)'::text) WITH &&) WHERE ((status = 'ACTIVE'::\"VersionStatus\"))"
  },
  {
    "name": "tenancy_services_dates_qty_chk",
    "kind": "check",
    "table": "tenancy_services",
    "definition": "CHECK (((quantity >= (0)::numeric) AND ((end_exclusive IS NULL) OR (end_exclusive > effective_from))))"
  },
  {
    "name": "services_meter_chk",
    "kind": "check",
    "table": "services",
    "definition": "CHECK ((((type = 'METER'::\"ServiceType\") = (meter_type IS NOT NULL)) AND ((type <> 'METER'::\"ServiceType\") OR (charge_timing = 'ARREARS'::\"ChargeTiming\"))))"
  },
  {
    "name": "one_active_meter_per_type",
    "kind": "index",
    "table": "meters",
    "definition": "CREATE UNIQUE INDEX one_active_meter_per_type ON public.meters USING btree (room_id, type) WHERE (retired_on IS NULL)"
  },
  {
    "name": "meters_initial_reading_chk",
    "kind": "check",
    "table": "meters",
    "definition": "CHECK ((initial_reading >= (0)::numeric))"
  },
  {
    "name": "meter_readings_value_chk",
    "kind": "check",
    "table": "meter_readings",
    "definition": "CHECK ((value >= (0)::numeric))"
  },
  {
    "name": "deposit_amount_positive_chk",
    "kind": "check",
    "table": "deposit_transactions",
    "definition": "CHECK ((amount_vnd > 0))"
  },
  {
    "name": "deposit_reversal_ref_chk",
    "kind": "check",
    "table": "deposit_transactions",
    "definition": "CHECK (((type = 'REVERSAL'::\"DepositTxType\") = (reverses_transaction_id IS NOT NULL)))"
  },
  {
    "name": "holding_amount_positive_chk",
    "kind": "check",
    "table": "holding_transactions",
    "definition": "CHECK ((amount_vnd > 0))"
  },
  {
    "name": "holding_reversal_ref_chk",
    "kind": "check",
    "table": "holding_transactions",
    "definition": "CHECK (((type = 'REVERSAL'::\"HoldingTxType\") = (reverses_transaction_id IS NOT NULL)))"
  },
  {
    "name": "contracts_term_chk",
    "kind": "check",
    "table": "contracts",
    "definition": "CHECK ((term_end >= term_start))"
  },
  {
    "name": "contracts_signed_at_chk",
    "kind": "check",
    "table": "contracts",
    "definition": "CHECK (((lifecycle <> 'SIGNED'::\"ContractLifecycle\") OR (signed_at IS NOT NULL)))"
  },
  {
    "name": "no_overlapping_signed_contracts",
    "kind": "exclude",
    "table": "contracts",
    "definition": "EXCLUDE USING gist (tenancy_id WITH =, daterange(term_start, (term_end + 1), '[)'::text) WITH &&) WHERE ((lifecycle = 'SIGNED'::\"ContractLifecycle\"))"
  },
  {
    "name": "contract_effective_status",
    "kind": "function",
    "table": null,
    "definition": "contract_effective_status(\"ContractLifecycle\",date,date,date,date)"
  }
]
```
