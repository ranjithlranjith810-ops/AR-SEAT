/**
 * Phase 18 — Bench management services.
 *
 * A Bench is a management/grouping layer above HallSeat. It is invisible to
 * the solver: buildSolverInput and the entire Phase 4 pipeline select seats
 * from HallSeat only. Capacity is never stored — it is derived from active
 * HallSeat rows at read time.
 */
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "./audit.service";

export interface CreateBenchInput {
  hallId: string;
  benchNumber: string;
  isActive?: boolean;
}

export async function createBench(input: CreateBenchInput, actorId?: string | null) {
  const hall = await prisma.hall.findUnique({ where: { id: input.hallId } });
  if (!hall) throw new SeatingError("Hall not found", "HALL_NOT_FOUND");

  const bench = await prisma.bench.create({
    data: {
      hallId: input.hallId,
      benchNumber: input.benchNumber,
      isActive: input.isActive ?? true,
    },
  });
  await logAudit({
    actorId,
    action: "BENCH_CREATED",
    entityType: "Bench",
    entityId: bench.id,
    metadata: { hallId: bench.hallId, benchNumber: bench.benchNumber },
  });
  return bench;
}

export async function getBench(id: string) {
  const bench = await prisma.bench.findUnique({ where: { id } });
  if (!bench) throw new SeatingError("Bench not found", "BENCH_NOT_FOUND");
  return bench;
}

export async function getBenchDetail(id: string) {
  const bench = await prisma.bench.findUnique({
    where: { id },
    include: {
      hall: { select: { id: true, hallNumber: true, name: true, building: true } },
      seats: {
        orderBy: [{ row: "asc" }, { column: "asc" }],
      },
    },
  });
  if (!bench) throw new SeatingError("Bench not found", "BENCH_NOT_FOUND");
  return bench;
}

export async function listBenches(hallId: string) {
  const hall = await prisma.hall.findUnique({ where: { id: hallId } });
  if (!hall) throw new SeatingError("Hall not found", "HALL_NOT_FOUND");
  return prisma.bench.findMany({
    where: { hallId },
    orderBy: { benchNumber: "asc" },
    include: {
      seats: {
        orderBy: [{ row: "asc" }, { column: "asc" }],
      },
    },
  });
}

export async function updateBench(
  id: string,
  patch: { benchNumber?: string; isActive?: boolean },
  actorId?: string | null,
) {
  const bench = await getBench(id);
  if (Object.keys(patch).length === 0) {
    throw new SeatingError("at least one field must be provided", "INVALID_INPUT");
  }
  const updated = await prisma.bench.update({
    where: { id },
    data: {
      benchNumber: patch.benchNumber,
      isActive: patch.isActive,
    },
  });
  await logAudit({
    actorId,
    action: "BENCH_UPDATED",
    entityType: "Bench",
    entityId: id,
    metadata: {
      hallId: bench.hallId,
      previous: { benchNumber: bench.benchNumber, isActive: bench.isActive },
      next: { benchNumber: updated.benchNumber, isActive: updated.isActive },
    },
  });
  return updated;
}

/**
 * Atomic decommission: bench + all member seats flip isActive in one
 * transaction. Deactivation cascades to seats so the operational meaning is
 * reflected in solver capacity; reactivation never touches seats (a seat may
 * have been deactivated individually for other reasons).
 */
export async function setBenchActive(id: string, isActive: boolean, actorId?: string | null) {
  const bench = await getBench(id);
  await prisma.$transaction(async (tx) => {
    await tx.bench.update({ where: { id }, data: { isActive } });
    if (!isActive) {
      await tx.hallSeat.updateMany({
        where: { benchId: id, isActive: true },
        data: { isActive: false },
      });
    }
  });
  await logAudit({
    actorId,
    action: "BENCH_STATUS_CHANGED",
    entityType: "Bench",
    entityId: id,
    metadata: { hallId: bench.hallId, isActive },
  });
  return getBench(id);
}

/** Capacity is derived strictly from active HallSeat rows — never stored. */
export async function deriveBenchCapacity(benchId: string): Promise<number> {
  await getBench(benchId);
  return prisma.hallSeat.count({ where: { benchId, isActive: true } });
}

/**
 * Assign a seat to a bench. The cross-hall guard is explicit: the DB relation
 * alone cannot prevent a seat from another hall being attached to this bench,
 * so the service rejects any hall mismatch.
 */
export async function assignSeatToBench(
  benchId: string,
  hallSeatId: string,
  actorId?: string | null,
) {
  const bench = await getBench(benchId);
  const seat = await prisma.hallSeat.findUnique({ where: { id: hallSeatId } });
  if (!seat) throw new SeatingError("HallSeat not found", "HALL_SEAT_NOT_FOUND");
  if (seat.hallId !== bench.hallId) {
    throw new SeatingError(
      "HallSeat does not belong to the same hall as the bench",
      "BENCH_SEAT_HALL_MISMATCH",
    );
  }
  const updated = await prisma.hallSeat.update({
    where: { id: hallSeatId },
    data: { benchId },
  });
  await logAudit({
    actorId,
    action: "BENCH_SEAT_ASSIGNED",
    entityType: "Bench",
    entityId: benchId,
    metadata: { hallId: bench.hallId, hallSeatId, seatPosition: updated.seatPosition },
  });
  return updated;
}

export async function removeSeatFromBench(
  benchId: string,
  hallSeatId: string,
  actorId?: string | null,
) {
  const bench = await getBench(benchId);
  const seat = await prisma.hallSeat.findUnique({ where: { id: hallSeatId } });
  if (!seat) throw new SeatingError("HallSeat not found", "HALL_SEAT_NOT_FOUND");
  if (seat.hallId !== bench.hallId) {
    throw new SeatingError(
      "HallSeat does not belong to the same hall as the bench",
      "BENCH_SEAT_HALL_MISMATCH",
    );
  }
  if (seat.benchId !== benchId) {
    throw new SeatingError(
      "HallSeat is not assigned to this bench",
      "BENCH_SEAT_NOT_ASSIGNED",
    );
  }
  const updated = await prisma.hallSeat.update({
    where: { id: hallSeatId },
    data: { benchId: null },
  });
  await logAudit({
    actorId,
    action: "BENCH_SEAT_REMOVED",
    entityType: "Bench",
    entityId: benchId,
    metadata: { hallId: bench.hallId, hallSeatId, seatPosition: updated.seatPosition },
  });
  return updated;
}