import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectUniqueViolation } from "./helpers";
import {
  createTestCandidate,
  createTestExam,
  createTestStudent,
  seededClass,
  seededHall,
} from "./fixtures";
import { assignCandidateSeat, listAssignments } from "../src/services/seatAssignment.service";
import { createPlan } from "../src/services/seatingPlan.service";

async function buildAssignmentFixtures() {
  const cls = await seededClass();
  const s1 = await createTestStudent(cls.id, "SEAT1");
  const s2 = await createTestStudent(cls.id, "SEAT2");
  const exam = await createTestExam();
  const c1 = await createTestCandidate(exam.id, s1.id);
  const c2 = await createTestCandidate(exam.id, s2.id);
  const hall = await seededHall();
  const seats = await prisma.hallSeat.findMany({
    where: { hallId: hall.id },
    orderBy: { seatPosition: "asc" },
  });
  const plan = await createPlan(exam.id, "test-actor");
  return { exam, c1, c2, hall, seats, plan };
}

describe("SeatAssignment", () => {
  it("lets a candidate receive a seat inside a plan", async () => {
    const { c1, hall, seats, plan } = await buildAssignmentFixtures();
    await assignCandidateSeat({
      seatingPlanId: plan.id,
      examCandidateId: c1.id,
      hallId: hall.id,
      hallSeatId: seats[0]!.id,
    });
    const assignments = await listAssignments(plan.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.examCandidateId).toBe(c1.id);
    expect(assignments[0]!.hallSeatId).toBe(seats[0]!.id);
  });

  it("prevents the same candidate receiving two seats in the same plan", async () => {
    const { c1, hall, seats, plan } = await buildAssignmentFixtures();
    await assignCandidateSeat({
      seatingPlanId: plan.id,
      examCandidateId: c1.id,
      hallId: hall.id,
      hallSeatId: seats[0]!.id,
    });
    await expectUniqueViolation(
      assignCandidateSeat({
        seatingPlanId: plan.id,
        examCandidateId: c1.id,
        hallId: hall.id,
        hallSeatId: seats[1]!.id,
      }),
    );
  });

  it("prevents two candidates occupying the same seat in the same plan", async () => {
    const { c1, c2, hall, seats, plan } = await buildAssignmentFixtures();
    await assignCandidateSeat({
      seatingPlanId: plan.id,
      examCandidateId: c1.id,
      hallId: hall.id,
      hallSeatId: seats[0]!.id,
    });
    await expectUniqueViolation(
      assignCandidateSeat({
        seatingPlanId: plan.id,
        examCandidateId: c2.id,
        hallId: hall.id,
        hallSeatId: seats[0]!.id,
      }),
    );
  });

  it("rejects assigning a candidate from a different exam to the plan", async () => {
    const { c2, hall, seats, plan } = await buildAssignmentFixtures();
    const otherExam = await createTestExam();
    const cls = await seededClass();
    const otherStudent = await createTestStudent(cls.id, "OTHER");
    const otherCandidate = await createTestCandidate(otherExam.id, otherStudent.id);

    await expect(
      assignCandidateSeat({
        seatingPlanId: plan.id,
        examCandidateId: otherCandidate.id,
        hallId: hall.id,
        hallSeatId: seats[0]!.id,
      }),
    ).rejects.toThrow();

    void c2;
  });

  it("preserves exact historical seat placement after a plan is published", async () => {
    const { c1, hall, seats, plan } = await buildAssignmentFixtures();
    await assignCandidateSeat({
      seatingPlanId: plan.id,
      examCandidateId: c1.id,
      hallId: hall.id,
      hallSeatId: seats[0]!.id,
    });
    await prisma.seatingPlan.update({
      where: { id: plan.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    const assignment = await prisma.seatAssignment.findFirst({
      where: { seatingPlanId: plan.id },
      include: { hallSeat: true },
    });
    expect(assignment?.examCandidateId).toBe(c1.id);
    expect(assignment?.hallSeat.hallId).toBe(hall.id);
    expect(assignment?.hallSeat.seatPosition).toBe(seats[0]!.seatPosition);
  });
});