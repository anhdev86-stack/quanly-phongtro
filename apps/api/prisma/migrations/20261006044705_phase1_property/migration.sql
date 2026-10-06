-- CreateEnum
CREATE TYPE "RoomOperationalStatus" AS ENUM ('READY', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "buildings" ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "floors" INTEGER,
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "floor" INTEGER,
    "area_m2" DECIMAL(7,2),
    "default_rent_vnd" BIGINT NOT NULL,
    "max_occupants" INTEGER NOT NULL,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "operational_status" "RoomOperationalStatus" NOT NULL DEFAULT 'READY',
    "maintenance_note" TEXT,
    "note" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "hold_from" DATE NOT NULL,
    "expected_move_in" DATE NOT NULL,
    "hold_until" DATE NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "note" TEXT,
    "converted_tenancy_id" UUID,
    "cancelled_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_workspace_id_idx" ON "rooms"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_building_id_code_key" ON "rooms"("building_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_id_workspace_id_key" ON "rooms"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "reservations_room_id_status_idx" ON "reservations"("room_id", "status");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_building_id_workspace_id_fkey" FOREIGN KEY ("building_id", "workspace_id") REFERENCES "buildings"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_room_id_workspace_id_fkey" FOREIGN KEY ("room_id", "workspace_id") REFERENCES "rooms"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================== SQL THỦ CÔNG — Phase 1 (xem prisma/MANUAL_SQL.md) =====================

-- Tiền thuê mặc định không âm; sức chứa hợp lệ.
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_default_rent_nonneg_chk" CHECK ("default_rent_vnd" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_max_occupants_chk" CHECK ("max_occupants" BETWEEN 1 AND 50);

-- Ba mốc ngày giữ phòng đúng thứ tự (MASTER_PLAN 5.6).
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_dates_order_chk"
  CHECK ("hold_from" <= "expected_move_in" AND "expected_move_in" <= "hold_until");

-- Reservation ACTIVE của cùng phòng không chồng lịch (MASTER_PLAN 6.8).
ALTER TABLE "reservations" ADD CONSTRAINT "no_overlapping_active_reservations"
  EXCLUDE USING gist (
    "room_id" WITH =,
    daterange("hold_from", "hold_until" + 1, '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');
