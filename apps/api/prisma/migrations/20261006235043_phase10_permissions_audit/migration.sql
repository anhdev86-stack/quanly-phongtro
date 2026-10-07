-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "building_id" UUID;

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_overrides_user_id_permission_id_key" ON "user_permission_overrides"("user_id", "permission_id");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_building_id_occurred_at_idx" ON "audit_logs"("workspace_id", "building_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Điền building_id cho nhật ký đã có (cùng quy tắc với AuditService.buildingOf). entity_id là text: chỉ ép kiểu khi đúng dạng UUID.
UPDATE "audit_logs" a SET "building_id" = b."id" FROM "buildings" b
  WHERE a."entity_type" = 'building' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND b."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "rooms" r
  WHERE a."entity_type" = 'room' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND r."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "reservations" x JOIN "rooms" r ON r."id" = x."room_id"
  WHERE a."entity_type" = 'reservation' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND x."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "tenancies" t JOIN "rooms" r ON r."id" = t."room_id"
  WHERE a."entity_type" = 'tenancy' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND t."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "meters" m JOIN "rooms" r ON r."id" = m."room_id"
  WHERE a."entity_type" = 'meter' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND m."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "meter_readings" x JOIN "meters" m ON m."id" = x."meter_id" JOIN "rooms" r ON r."id" = m."room_id"
  WHERE a."entity_type" = 'meter_reading' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND x."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "contracts" x JOIN "tenancies" t ON t."id" = x."tenancy_id" JOIN "rooms" r ON r."id" = t."room_id"
  WHERE a."entity_type" = 'contract' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND x."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "invoices" x JOIN "tenancies" t ON t."id" = x."tenancy_id" JOIN "rooms" r ON r."id" = t."room_id"
  WHERE a."entity_type" = 'invoice' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND x."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "payments" x JOIN "tenancies" t ON t."id" = x."tenancy_id" JOIN "rooms" r ON r."id" = t."room_id"
  WHERE a."entity_type" = 'payment' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND x."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "move_out_settlements" x JOIN "tenancies" t ON t."id" = x."tenancy_id" JOIN "rooms" r ON r."id" = t."room_id"
  WHERE a."entity_type" = 'settlement' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND x."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "credit_refunds" x JOIN "tenancies" t ON t."id" = x."tenancy_id" JOIN "rooms" r ON r."id" = t."room_id"
  WHERE a."entity_type" = 'credit_refund' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND x."id" = a."entity_id"::uuid;
UPDATE "audit_logs" a SET "building_id" = r."building_id" FROM "credit_applications" x JOIN "tenancies" t ON t."id" = x."tenancy_id" JOIN "rooms" r ON r."id" = t."room_id"
  WHERE a."entity_type" = 'credit_application' AND a."entity_id" ~* '^[0-9a-f-]{36}$' AND x."id" = a."entity_id"::uuid;
