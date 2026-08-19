import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectRejected, expectUniqueViolation } from "./helpers";
import { createHall } from "../src/services/hall.service";
import {
  assignSeatToBench,
  createBench,
  deriveBenchCapacity,
  getBenchDetail,
  listBenches,
  removeSeatFromBench,
  setBenchActive,
} from "../src/services/bench.service";
import { buildSolverInput } from "../src/services/solverInput.service";
import {
  createTestCandidate,
  createTestExam,
  createTestStudent,
  seededClass,
} from "./fixtures";
import { assignCandidateSeat } from "../src/services/seatAssignment.service";
import { createPlan } from "../src/services/seatingPlan.service";

describe("Bench domain (Phase 18)", () => {
  it("creates a bench with a nullable seat membership and derived capacity", async () => {
    const hall = await createHall({
      hallNumber: "PB01",
      name: "Phase 18 Hall 01",
      rows: 2,
      columns: 3,
    });
    const bench = await createBench({ hallId: hall.id, benchNumber: "B1" });
    expect(bench).toMatchObject({ hallId: hall.id, benchNumber: "B1", isActive: true });

    const seats = await prisma.hallSeat.findMany({ where: { hallId: hall.id } });
    expect(seats.every((s) => s.benchId === null)).toBe(true);

    await assignSeatToBench(bench.id, seats[0]!.id);
    await assignSeatToBench(bench.id, seats[1]!.id);
    const capacity = await deriveBenchCapacity(bench.id);
    expect(capacity).toBe(2);

    const detail = await getBenchDetail(bench.id);
    expect(detail.seats.map((s) => s.seatPosition).sort()).toEqual(["A1", "A2"]);
    expect(detail.hall.hallNumber).toBe("PB01");
  });

  it("prevents duplicate bench numbers within one hall", async () => {
    const hall = await createHall({
      hallNumber: "PB02",
      name: "Phase 18 Hall 02",
      rows: 2,
      columns: 2,
    });
    await createBench({ hallId: hall.id, benchNumber: "B1" });
    await expectUniqueViolation(createBench({ hallId: hall.id, benchNumber: "B1" }));
  });

  it("allows the same bench number in a different hall", async () => {
    const h1 = await createHall({ hallNumber: "PB03", name: "H 03", rows: 1, columns: 2 });
    const h2 = await createHall({ hallNumber: "PB04", name: "H 04", rows: 1, columns: 2 });
    await createBench({ hallId: h1.id, benchNumber: "B1" });
    const bench2 = await createBench({ hallId: h2.id, benchNumber: "B1" });
    expect(bench2.hallId).toBe(h2.id);
  });

  it("rejects a seat-to-bench assignment across halls (cross-hall guard)", async () => {
    const h1 = await createHall({ hallNumber: "PB05", name: "H 05", rows: 1, columns: 2 });
    const h2 = await createHall({ hallNumber: "PB06", name: "H 06", rows: 1, columns: 2 });
    const bench = await createBench({ hallId: h1.id, benchNumber: "B1" });
    const foreignSeat = await prisma.hallSeat.findFirstOrThrow({ where: { hallId: h2.id } });

    await expect(assignSeatToBench(bench.id, foreignSeat.id)).rejects.toMatchObject({
      code: "BENCH_SEAT_HALL_MISMATCH",
    });
    const persisted = await prisma.hallSeat.findUniqueOrThrow({ where: { id: foreignSeat.id } });
    expect(persisted.benchId).toBeNull();
  });

  it("moves a seat between benches in the same hall and removes it again", async () => {
    const hall = await createHall({ hallNumber: "PB07", name: "H 07", rows: 1, columns: 4 });
    const b1 = await createBench({ hallId: hall.id, benchNumber: "B1" });
    const b2 = await createBench({ hallId: hall.id, benchNumber: "B2" });
    const seats = await prisma.hallSeat.findMany({ where: { hallId: hall.id } });

    await assignSeatToBench(b1.id, seats[0]!.id);
    await assignSeatToBench(b2.id, seats[0]!.id);
    let seat = await prisma.hallSeat.findUniqueOrThrow({ where: { id: seats[0]!.id } });
    expect(seat.benchId).toBe(b2.id);
    expect(seat.seatPosition).toBe("A1");

    await expect(removeSeatFromBench(b1.id, seats[0]!.id)).rejects.toMatchObject({
      code: "BENCH_SEAT_NOT_ASSIGNED",
    });
    await removeSeatFromBench(b2.id, seats[0]!.id);
    seat = await prisma.hallSeat.findUniqueOrThrow({ where: { id: seats[0]!.id } });
    expect(seat.benchId).toBeNull();
  });

  it("atomically decommissions a bench and its member seats", async () => {
    const hall = await createHall({ hallNumber: "PB08", name: "H 08", rows: 2, columns: 3 });
    const bench = await createBench({ hallId: hall.id, benchNumber: "B1" });
    const seats = await prisma.hallSeat.findMany({ where: { hallId: hall.id } });
    for (const seat of seats.slice(0, 3)) await assignSeatToBench(bench.id, seat.id);

    await setBenchActive(bench.id, false);

    const benchAfter = await prisma.bench.findUniqueOrThrow({ where: { id: bench.id } });
    expect(benchAfter.isActive).toBe(false);
    const memberSeats = await prisma.hallSeat.findMany({ where: { benchId: bench.id } });
    expect(memberSeats.length).toBe(3);
    expect(memberSeats.every((s) => s.isActive === false)).toBe(true);
    expect(await deriveBenchCapacity(bench.id)).toBe(0);

    const unassigned = await prisma.hallSeat.findMany({
      where: { hallId: hall.id, benchId: null },
    });
    expect(unassigned.every((s) => s.isActive === true)).toBe(true);
  });

  it("reactivating a bench does not reactivate decommissioned seats", async () => {
    const hall = await createHall({ hallNumber: "PB09", name: "H 09", rows: 1, columns: 3 });
    const bench = await createBench({ hallId: hall.id, benchNumber: "B1" });
    const seats = await prisma.hallSeat.findMany({ where: { hallId: hall.id } });
    await assignSeatToBench(bench.id, seats[0]!.id);

    await setBenchActive(bench.id, false);
    await setBenchActive(bench.id, true);

    const benchAfter = await prisma.bench.findUniqueOrThrow({ where: { id: bench.id } });
    expect(benchAfter.isActive).toBe(true);
    const seat = await prisma.hallSeat.findUniqueOrThrow({ where: { id: seats[0]!.id } });
    expect(seat.isActive).toBe(false);
  });

  it("rejects moving a seat to a bench in a different hall (cross-hall reassign)", async () => {
    const h1 = await createHall({ hallNumber: "PB14", name: "H 14", rows: 1, columns: 2 });
    const h2 = await createHall({ hallNumber: "PB15", name: "H 15", rows: 1, columns: 2 });
    const b1 = await createBench({ hallId: h1.id, benchNumber: "B1" });
    const b2 = await createBench({ hallId: h2.id, benchNumber: "B1" });
    const seat = await prisma.hallSeat.findFirstOrThrow({ where: { hallId: h1.id } });

    await assignSeatToBench(b1.id, seat.id);
    await expect(assignSeatToBench(b2.id, seat.id)).rejects.toMatchObject({
      code: "BENCH_SEAT_HALL_MISMATCH",
    });
    const persisted = await prisma.hallSeat.findUniqueOrThrow({ where: { id: seat.id } });
    expect(persisted.benchId).toBe(b1.id);
  });

  it("deactivating a bench leaves other benches' seats and unassigned seats untouched", async () => {
    const hall = await createHall({ hallNumber: "PB16", name: "H 16", rows: 2, columns: 3 });
    const b1 = await createBench({ hallId: hall.id, benchNumber: "B1" });
    const b2 = await createBench({ hallId: hall.id, benchNumber: "B2" });
    const seats = await prisma.hallSeat.findMany({ where: { hallId: hall.id } });

    await assignSeatToBench(b1.id, seats[0]!.id);
    await assignSeatToBench(b1.id, seats[1]!.id);
    await assignSeatToBench(b2.id, seats[2]!.id);
    await assignSeatToBench(b2.id, seats[3]!.id);

    await setBenchActive(b1.id, false);

    const b1Member = await prisma.hallSeat.findMany({ where: { benchId: b1.id } });
    expect(b1Member.every((s) => s.isActive === false)).toBe(true);

    const b2Member = await prisma.hallSeat.findMany({ where: { benchId: b2.id } });
    expect(b2Member.length).toBe(2);
    expect(b2Member.every((s) => s.isActive === true && s.benchId === b2.id)).toBe(true);

    const b2After = await prisma.bench.findUniqueOrThrow({ where: { id: b2.id } });
    expect(b2After.isActive).toBe(true);

    const unassigned = await prisma.hallSeat.findMany({
      where: { hallId: hall.id, benchId: null },
    });
    expect(unassigned.length).toBe(2);
    expect(unassigned.every((s) => s.isActive === true && s.benchId === null)).toBe(true);
  });

  it("decommissioning does not rewrite an independently inactive member seat, and reactivation never touches it", async () => {
    const hall = await createHall({ hallNumber: "PB17", name: "H 17", rows: 1, columns: 3 });
    const bench = await createBench({ hallId: hall.id, benchNumber: "B1" });
    const seats = await prisma.hallSeat.findMany({ where: { hallId: hall.id } });
    const independent = seats[0]!;
    const benchSeat = seats[1]!;
    await assignSeatToBench(bench.id, independent.id);
    await assignSeatToBench(bench.id, benchSeat.id);

    await prisma.hallSeat.update({
      where: { id: independent.id },
      data: { isActive: false },
    });

    await setBenchActive(bench.id, false);
    let afterDecommission = await prisma.hallSeat.findUniqueOrThrow({
      where: { id: independent.id },
    });
    expect(afterDecommission.isActive).toBe(false);

    await setBenchActive(bench.id, true);
    afterDecommission = await prisma.hallSeat.findUniqueOrThrow({
      where: { id: independent.id },
    });
    const afterReactivate = await prisma.hallSeat.findUniqueOrThrow({
      where: { id: benchSeat.id },
    });
    expect(await prisma.bench.findUniqueOrThrow({ where: { id: bench.id } })).toMatchObject({
      isActive: true,
    });
    expect(afterDecommission.isActive).toBe(false);
    expect(afterReactivate.isActive).toBe(false);
  });

  it("decommissioning a bench preserves historical SeatAssignment rows", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "BENCH");
    const exam = await createTestExam();
    const candidate = await createTestCandidate(exam.id, student.id);

    const hall = await createHall({ hallNumber: "PB10", name: "H 10", rows: 2, columns: 2 });
    const bench = await createBench({ hallId: hall.id, benchNumber: "B1" });
    const seats = await prisma.hallSeat.findMany({ where: { hallId: hall.id } });
    const seat = seats[0]!;
    await assignSeatToBench(bench.id, seat.id);

    const plan = await createPlan(exam.id, "test-actor");
    await assignCandidateSeat({
      seatingPlanId: plan.id,
      examCandidateId: candidate.id,
      hallId: hall.id,
      hallSeatId: seat.id,
    });
    await prisma.seatingPlan.update({
      where: { id: plan.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    await setBenchActive(bench.id, false);

    const assignment = await prisma.seatAssignment.findFirstOrThrow({
      where: { seatingPlanId: plan.id },
      include: { hallSeat: true },
    });
    expect(assignment.examCandidateId).toBe(candidate.id);
    expect(assignment.hallId).toBe(hall.id);
    expect(assignment.hallSeat.id).toBe(seat.id);
    expect(assignment.hallSeat.seatPosition).toBe(seat.seatPosition);
    expect(assignment.hallSeat.hallId).toBe(hall.id);
  });

  it("refuses to hard-delete a bench (no-delete trigger)", async () => {
    const hall = await createHall({ hallNumber: "PB11", name: "H 11", rows: 1, columns: 2 });
    const bench = await createBench({ hallId: hall.id, benchNumber: "B1" });
    await expectRejected(prisma.bench.delete({ where: { id: bench.id } }));
    expect(await prisma.bench.count({ where: { id: bench.id } })).toBe(1);
  });

  it("keeps the solver input oblivious to benches", async () => {
    const hall = await createHall({ hallNumber: "PB12", name: "H 12", rows: 2, columns: 3 });
    const bench = await createBench({ hallId: hall.id, benchNumber: "B1" });
    const seats = await prisma.hallSeat.findMany({ where: { hallId: hall.id } });
    for (const seat of seats.slice(0, 3)) await assignSeatToBench(bench.id, seat.id);
    await prisma.hallSeat.update({
      where: { id: seats[5]!.id },
      data: { isActive: false },
    });

    const exam = await createTestExam();
    const input = await buildSolverInput(exam.id);
    const hallRow = input.halls.find((h) => h.id === hall.id);
    expect(hallRow).toBeDefined();
    expect(hallRow!.capacity).toBe(5);
    expect(hallRow!.seats.map((s) => s.seatPosition).sort()).toEqual(
      ["A1", "A2", "A3", "B1", "B2"],
    );
    expect(Object.keys(hallRow!.seats[0]!).sort()).toEqual(["column", "id", "row", "seatPosition"]);
    expect(input.availableSeatCount).toBeGreaterThanOrEqual(5);
  });

  it("lists benches ordered by bench number with derived capacity", async () => {
    const hall = await createHall({ hallNumber: "PB13", name: "H 13", rows: 1, columns: 4 });
    await createBench({ hallId: hall.id, benchNumber: "B2" });
    await createBench({ hallId: hall.id, benchNumber: "B1" });
    const benches = await listBenches(hall.id);
    expect(benches.map((b) => b.benchNumber)).toEqual(["B1", "B2"]);
    const b1 = benches.find((b) => b.benchNumber === "B1")!;
    await assignSeatToBench(b1.id, (await prisma.hallSeat.findFirstOrThrow({ where: { hallId: hall.id } })).id);
    const detail = await getBenchDetail(b1.id);
    expect(detail.seats.length).toBe(1);
  });
});