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
| Unique index **không** partial (VD `NULLS NOT DISTINCT`) | Không hỗ trợ | **Không dùng**: Phase 5 phát hiện `migrate dev` sinh DROP cho loại này ở mọi migration. Dùng hai partial unique index thay thế. |
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
| `service_price_nonneg_chk` | service_price_history | CHECK | `20261006142231_phase4_utilities` | Đơn giá không âm |
| `services_substitutes_chk` | services | CHECK | `20261006142231_phase4_utilities` | Chỉ dịch vụ không đồng hồ mới thay đồng hồ |
| `statement_periods_month_start_chk` | statement_periods | CHECK | `20261006142231_phase4_utilities` | Kỳ phát hành là ngày 1 |
| `meter_readings_period_chk` | meter_readings | CHECK | `20261006142231_phase4_utilities` | PERIODIC ⇔ có kỳ phát hành |
| `one_periodic_reading_per_period` | meter_readings | PARTIAL UNIQUE | `20261006142231_phase4_utilities` | Một chỉ số chốt mỗi đồng hồ mỗi kỳ |
| `meters_retired_after_installed_chk` | meters | CHECK | `20261006142231_phase4_utilities` | Ngưng không trước ngày lắp |
| `one_building_service_price_per_day` | service_price_history | PARTIAL UNIQUE | `20261006145403_phase5_billing` | Một giá riêng tòa mỗi (dịch vụ, tòa, ngày). Thay `one_service_price_per_day` (NULLS NOT DISTINCT bị Prisma sinh DROP) |
| `one_general_service_price_per_day` | service_price_history | PARTIAL UNIQUE | `20261006145403_phase5_billing` | Một giá chung mỗi (dịch vụ, ngày) |
| `one_monthly_invoice_per_period` | invoices | PARTIAL UNIQUE | `20261006145403_phase5_billing` | Một thông báo tháng mỗi tenancy mỗi kỳ (T16) |
| `one_draft_invoice_per_tenancy` | invoices | PARTIAL UNIQUE | `20261006145403_phase5_billing` | Tối đa một nháp mỗi tenancy (T49, D-023) |
| `one_final_invoice_per_tenancy` | invoices | PARTIAL UNIQUE | `20261006145403_phase5_billing` | Một thông báo cuối kỳ mỗi tenancy |
| `invoices_amounts_chk` | invoices | CHECK | `20261006150205_phase5_draft_totals` | Chứng từ không phải nháp có tổng không âm; discount = 0 (D-022) |
| `invoices_published_chk` | invoices | CHECK | `20261006145403_phase5_billing` | Đã phát hành thì có số chứng từ |
| `invoices_monthly_period_chk` | invoices | CHECK | `20261006145403_phase5_billing` | Thông báo tháng gắn kỳ phát hành |
| `invoices_adjustment_chk` | invoices | CHECK | `20261006145403_phase5_billing` | Chứng từ điều chỉnh không ở nháp, luôn trỏ chứng từ gốc |
| `invoice_items_amount_chk` | invoice_items | CHECK | `20261006145403_phase5_billing` | Số tiền dòng không âm (dấu ở direction) |
| `invoice_items_period_chk` | invoice_items | CHECK | `20261006145403_phase5_billing` | Khoảng phí hợp lệ |
| `payments_amount_positive_chk` | payments | CHECK | `20261006152550_phase6_payments` | Số tiền phiếu thu > 0 |
| `payment_allocations_amount_positive_chk` | payment_allocations | CHECK | `20261006152550_phase6_payments` | Phân bổ > 0 |
| `credit_applications_amount_positive_chk` | credit_applications | CHECK | `20261006152550_phase6_payments` | Cấn trừ credit > 0 |
| `credit_refunds_amount_positive_chk` | credit_refunds | CHECK | `20261006152550_phase6_payments` | Hoàn credit > 0 |
| `deposit_allocations_amount_positive_chk` | deposit_allocations | CHECK | `20261006152550_phase6_payments` | Cọc áp vào thông báo > 0 |
| `payments_reversal_chk` | payments | CHECK | `20261006152550_phase6_payments` | REVERSED ⇔ có thời điểm và lý do đảo |
| `credit_applications_reversal_chk` | credit_applications | CHECK | `20261006152550_phase6_payments` | REVERSED ⇔ có thời điểm và lý do đảo |
| `credit_refunds_reversal_chk` | credit_refunds | CHECK | `20261006152550_phase6_payments` | REVERSED ⇔ có thời điểm và lý do đảo |
| `one_active_payment_account` | payment_accounts | PARTIAL UNIQUE | `20261006152550_phase6_payments` | Một tài khoản nhận tiền active mỗi workspace |
| `credit_applications_distinct_chk` | credit_applications | CHECK | `20261006152550_phase6_payments` | Không cấn credit vào chính nó |
| `one_active_notice_per_tenancy` | move_out_notices | PARTIAL UNIQUE | `20261006155140_phase7_move_out` | Một báo trả ACTIVE mỗi lần thuê |
| `one_live_settlement_per_tenancy` | move_out_settlements | PARTIAL UNIQUE | `20261006155140_phase7_move_out` | Một quyết toán chưa hủy mỗi lần thuê |
| `move_out_notices_dates_chk` | move_out_notices | CHECK | `20261006155140_phase7_move_out` | Ngày dự kiến trả ≥ ngày báo |
| `move_out_settlements_dates_chk` | move_out_settlements | CHECK | `20261006155140_phase7_move_out` | charge_end_exclusive = ngày cuối tính tiền + 1 |
| `move_out_settlements_workflow_chk` | move_out_settlements | CHECK | `20261006155140_phase7_move_out` | Duyệt/hoàn tất có người duyệt và input_hash; COMPLETED ⇔ có completed_at |
| `move_out_settlements_deposit_chk` | move_out_settlements | CHECK | `20261006155140_phase7_move_out` | Cọc đề xuất áp không âm |
| `settlement_items_amount_chk` | settlement_items | CHECK | `20261006155140_phase7_move_out` | Khoản phí trả phòng > 0; dòng số dư ≥ 0 |
| `reminder_settings_hours_chk` | reminder_settings | CHECK | `20261006164950_phase8b_reminders` | Giờ gửi/giờ yên lặng 0–23 |
| `reminder_messages_state_chk` | reminder_messages | CHECK | `20261006164950_phase8b_reminders` | SENT ⇔ có thời điểm + kênh; SKIPPED có lý do |
| `statement_periods_closed_chk` | statement_periods | CHECK | `20261007002334_phase11_contracts_periods` | Kỳ CLOSED ⇔ có thời điểm đóng |
| `contract_revisions_no_chk` | contract_revisions | CHECK | `20261007002334_phase11_contracts_periods` | Số phụ lục ≥ 1 |
| `contract_alerts_milestone_chk` | contract_alerts | CHECK | `20261007002334_phase11_contracts_periods` | Mốc cảnh báo > 0 ngày |
| `expenses_amount_chk` | expenses | CHECK | `20261007004652_phase12_expenses` | Số tiền chi > 0 |
| `expenses_state_chk` | expenses | CHECK | `20261007004652_phase12_expenses` | REVERSED ⇔ có thời điểm và lý do đảo |
| `expenses_room_building_chk` | expenses | CHECK | `20261007004652_phase12_expenses` | Chi cho phòng thì có tòa |

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
  },
  {
    "name": "service_price_nonneg_chk",
    "kind": "check",
    "table": "service_price_history",
    "definition": "CHECK ((unit_price >= (0)::numeric))"
  },
  {
    "name": "services_substitutes_chk",
    "kind": "check",
    "table": "services",
    "definition": "CHECK (((substitutes_meter IS NULL) OR (type <> 'METER'::\"ServiceType\")))"
  },
  {
    "name": "statement_periods_month_start_chk",
    "kind": "check",
    "table": "statement_periods",
    "definition": "CHECK ((EXTRACT(day FROM month_start) = (1)::numeric))"
  },
  {
    "name": "meter_readings_period_chk",
    "kind": "check",
    "table": "meter_readings",
    "definition": "CHECK (((kind = 'PERIODIC'::\"ReadingKind\") = (statement_period_id IS NOT NULL)))"
  },
  {
    "name": "one_periodic_reading_per_period",
    "kind": "index",
    "table": "meter_readings",
    "definition": "CREATE UNIQUE INDEX one_periodic_reading_per_period ON public.meter_readings USING btree (meter_id, statement_period_id) WHERE (kind = 'PERIODIC'::\"ReadingKind\")"
  },
  {
    "name": "meters_retired_after_installed_chk",
    "kind": "check",
    "table": "meters",
    "definition": "CHECK (((retired_on IS NULL) OR (retired_on >= installed_on)))"
  },
  {
    "name": "one_building_service_price_per_day",
    "kind": "index",
    "table": "service_price_history",
    "definition": "CREATE UNIQUE INDEX one_building_service_price_per_day ON public.service_price_history USING btree (service_id, building_id, effective_from) WHERE (building_id IS NOT NULL)"
  },
  {
    "name": "one_general_service_price_per_day",
    "kind": "index",
    "table": "service_price_history",
    "definition": "CREATE UNIQUE INDEX one_general_service_price_per_day ON public.service_price_history USING btree (service_id, effective_from) WHERE (building_id IS NULL)"
  },
  {
    "name": "one_monthly_invoice_per_period",
    "kind": "index",
    "table": "invoices",
    "definition": "CREATE UNIQUE INDEX one_monthly_invoice_per_period ON public.invoices USING btree (tenancy_id, statement_period_id) WHERE ((type = 'MONTHLY'::\"InvoiceType\") AND (lifecycle <> 'CANCELLED'::\"InvoiceLifecycle\"))"
  },
  {
    "name": "one_draft_invoice_per_tenancy",
    "kind": "index",
    "table": "invoices",
    "definition": "CREATE UNIQUE INDEX one_draft_invoice_per_tenancy ON public.invoices USING btree (tenancy_id) WHERE (lifecycle = 'DRAFT'::\"InvoiceLifecycle\")"
  },
  {
    "name": "one_final_invoice_per_tenancy",
    "kind": "index",
    "table": "invoices",
    "definition": "CREATE UNIQUE INDEX one_final_invoice_per_tenancy ON public.invoices USING btree (tenancy_id) WHERE ((type = 'FINAL'::\"InvoiceType\") AND (lifecycle <> 'CANCELLED'::\"InvoiceLifecycle\"))"
  },
  {
    "name": "invoices_amounts_chk",
    "kind": "check",
    "table": "invoices",
    "definition": "CHECK ((((lifecycle = 'DRAFT'::\"InvoiceLifecycle\") OR ((subtotal_vnd >= 0) AND (total_vnd >= 0))) AND (discount_vnd = 0) AND (total_vnd = (subtotal_vnd - discount_vnd))))"
  },
  {
    "name": "invoices_published_chk",
    "kind": "check",
    "table": "invoices",
    "definition": "CHECK (((lifecycle = 'DRAFT'::\"InvoiceLifecycle\") OR (number IS NOT NULL) OR ((lifecycle = 'CANCELLED'::\"InvoiceLifecycle\") AND (published_at IS NULL))))"
  },
  {
    "name": "invoices_monthly_period_chk",
    "kind": "check",
    "table": "invoices",
    "definition": "CHECK (((type <> 'MONTHLY'::\"InvoiceType\") OR (statement_period_id IS NOT NULL)))"
  },
  {
    "name": "invoices_adjustment_chk",
    "kind": "check",
    "table": "invoices",
    "definition": "CHECK (((type <> ALL (ARRAY['DEBIT_ADJUSTMENT'::\"InvoiceType\", 'CREDIT_ADJUSTMENT'::\"InvoiceType\"])) OR ((lifecycle <> 'DRAFT'::\"InvoiceLifecycle\") AND (source_invoice_id IS NOT NULL))))"
  },
  {
    "name": "invoice_items_amount_chk",
    "kind": "check",
    "table": "invoice_items",
    "definition": "CHECK ((amount_vnd >= 0))"
  },
  {
    "name": "invoice_items_period_chk",
    "kind": "check",
    "table": "invoice_items",
    "definition": "CHECK (((charge_end_exclusive IS NULL) OR (charge_start IS NULL) OR (charge_end_exclusive > charge_start)))"
  },
  {
    "name": "payments_amount_positive_chk",
    "kind": "check",
    "table": "payments",
    "definition": "CHECK ((amount_vnd > 0))"
  },
  {
    "name": "payment_allocations_amount_positive_chk",
    "kind": "check",
    "table": "payment_allocations",
    "definition": "CHECK ((amount_vnd > 0))"
  },
  {
    "name": "credit_applications_amount_positive_chk",
    "kind": "check",
    "table": "credit_applications",
    "definition": "CHECK ((amount_vnd > 0))"
  },
  {
    "name": "credit_refunds_amount_positive_chk",
    "kind": "check",
    "table": "credit_refunds",
    "definition": "CHECK ((amount_vnd > 0))"
  },
  {
    "name": "deposit_allocations_amount_positive_chk",
    "kind": "check",
    "table": "deposit_allocations",
    "definition": "CHECK ((amount_vnd > 0))"
  },
  {
    "name": "payments_reversal_chk",
    "kind": "check",
    "table": "payments",
    "definition": "CHECK (((status = 'REVERSED'::\"PostingStatus\") = ((reversed_at IS NOT NULL) AND (reversal_reason IS NOT NULL))))"
  },
  {
    "name": "credit_applications_reversal_chk",
    "kind": "check",
    "table": "credit_applications",
    "definition": "CHECK (((status = 'REVERSED'::\"CreditApplicationStatus\") = ((reversed_at IS NOT NULL) AND (reversal_reason IS NOT NULL))))"
  },
  {
    "name": "credit_refunds_reversal_chk",
    "kind": "check",
    "table": "credit_refunds",
    "definition": "CHECK (((status = 'REVERSED'::\"PostingStatus\") = ((reversed_at IS NOT NULL) AND (reversal_reason IS NOT NULL))))"
  },
  {
    "name": "one_active_payment_account",
    "kind": "index",
    "table": "payment_accounts",
    "definition": "CREATE UNIQUE INDEX one_active_payment_account ON public.payment_accounts USING btree (workspace_id) WHERE is_active"
  },
  {
    "name": "credit_applications_distinct_chk",
    "kind": "check",
    "table": "credit_applications",
    "definition": "CHECK ((credit_invoice_id <> target_invoice_id))"
  },
  {
    "name": "one_active_notice_per_tenancy",
    "kind": "index",
    "table": "move_out_notices",
    "definition": "CREATE UNIQUE INDEX one_active_notice_per_tenancy ON public.move_out_notices USING btree (tenancy_id) WHERE (status = 'ACTIVE'::\"NoticeStatus\")"
  },
  {
    "name": "one_live_settlement_per_tenancy",
    "kind": "index",
    "table": "move_out_settlements",
    "definition": "CREATE UNIQUE INDEX one_live_settlement_per_tenancy ON public.move_out_settlements USING btree (tenancy_id) WHERE (status <> 'CANCELLED'::\"SettlementStatus\")"
  },
  {
    "name": "move_out_notices_dates_chk",
    "kind": "check",
    "table": "move_out_notices",
    "definition": "CHECK ((planned_last_charge_date >= notice_date))"
  },
  {
    "name": "move_out_settlements_dates_chk",
    "kind": "check",
    "table": "move_out_settlements",
    "definition": "CHECK ((charge_end_exclusive = (last_charge_date + 1)))"
  },
  {
    "name": "move_out_settlements_workflow_chk",
    "kind": "check",
    "table": "move_out_settlements",
    "definition": "CHECK ((((status <> ALL (ARRAY['APPROVED'::\"SettlementStatus\", 'COMPLETED'::\"SettlementStatus\"])) OR ((approved_by IS NOT NULL) AND (input_hash IS NOT NULL))) AND ((status = 'COMPLETED'::\"SettlementStatus\") = (completed_at IS NOT NULL))))"
  },
  {
    "name": "move_out_settlements_deposit_chk",
    "kind": "check",
    "table": "move_out_settlements",
    "definition": "CHECK (((deposit_to_apply_vnd IS NULL) OR (deposit_to_apply_vnd >= 0)))"
  },
  {
    "name": "settlement_items_amount_chk",
    "kind": "check",
    "table": "settlement_items",
    "definition": "CHECK (((amount_vnd >= 0) AND ((kind = ANY (ARRAY['INVOICE_BALANCE'::\"SettlementItemKind\", 'CREDIT_BALANCE'::\"SettlementItemKind\"])) OR (amount_vnd > 0))))"
  },
  {
    "name": "reminder_settings_hours_chk",
    "kind": "check",
    "table": "reminder_settings",
    "definition": "CHECK ((((send_hour >= 0) AND (send_hour <= 23)) AND ((quiet_start >= 0) AND (quiet_start <= 23)) AND ((quiet_end >= 0) AND (quiet_end <= 23))))"
  },
  {
    "name": "reminder_messages_state_chk",
    "kind": "check",
    "table": "reminder_messages",
    "definition": "CHECK ((((status = 'SENT'::\"ReminderStatus\") = ((sent_at IS NOT NULL) AND (channel_used IS NOT NULL))) AND ((status <> 'SKIPPED'::\"ReminderStatus\") OR (skip_reason IS NOT NULL)) AND (attempt_count >= 0)))"
  },
  {
    "name": "statement_periods_closed_chk",
    "kind": "check",
    "table": "statement_periods",
    "definition": "CHECK (((status = 'CLOSED'::\"StatementPeriodStatus\") = (closed_at IS NOT NULL)))"
  },
  {
    "name": "contract_revisions_no_chk",
    "kind": "check",
    "table": "contract_revisions",
    "definition": "CHECK ((revision_no >= 1))"
  },
  {
    "name": "contract_alerts_milestone_chk",
    "kind": "check",
    "table": "contract_alerts",
    "definition": "CHECK ((milestone_days > 0))"
  },
  {
    "name": "expenses_amount_chk",
    "kind": "check",
    "table": "expenses",
    "definition": "CHECK ((amount_vnd > 0))"
  },
  {
    "name": "expenses_state_chk",
    "kind": "check",
    "table": "expenses",
    "definition": "CHECK (((status = 'REVERSED'::\"PostingStatus\") = ((reversed_at IS NOT NULL) AND (reverse_reason IS NOT NULL))))"
  },
  {
    "name": "expenses_room_building_chk",
    "kind": "check",
    "table": "expenses",
    "definition": "CHECK (((room_id IS NULL) OR (building_id IS NOT NULL)))"
  }
]
```
