-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'HALL_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'HALL_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'HALL_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'BENCH_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'BENCH_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'BENCH_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'BENCH_SEAT_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'BENCH_SEAT_REMOVED';

-- AlterTable
ALTER TABLE "hall_seats" ADD COLUMN     "bench_id" TEXT;

-- CreateTable
CREATE TABLE "benches" (
    "id" TEXT NOT NULL,
    "hall_id" TEXT NOT NULL,
    "bench_number" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "benches_hall_id_idx" ON "benches"("hall_id");

-- CreateIndex
CREATE UNIQUE INDEX "benches_hall_id_bench_number_key" ON "benches"("hall_id", "bench_number");

-- CreateIndex
CREATE INDEX "hall_seats_bench_id_idx" ON "hall_seats"("bench_id");

-- AddForeignKey
ALTER TABLE "hall_seats" ADD CONSTRAINT "hall_seats_bench_id_fkey" FOREIGN KEY ("bench_id") REFERENCES "benches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benches" ADD CONSTRAINT "benches_hall_id_fkey" FOREIGN KEY ("hall_id") REFERENCES "halls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No-hard-delete policy for benches (soft decommission via is_active = false),
-- consistent with the operational tables in the init migration.
CREATE TRIGGER trg_es_benches_no_delete
    BEFORE DELETE ON "benches"
    FOR EACH ROW EXECUTE FUNCTION es_protect_hard_delete();
