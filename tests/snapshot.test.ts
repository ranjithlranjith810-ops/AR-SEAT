import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectRejected } from "./helpers";
import {
  createTestCandidate,
  createTestExam,
  createTestStudent,
  seededClass,
  seededHall,
} from "./fixtures";
import { SeatingError } from "../src/errors";
import { updateCandidateSnapshot } from "../src/services/candidate.service";
import { assignCandidateSeat } from "../src/services/seatAssignment.service";
import { approvePlan, createPlan, publishPlan } from "../src/services/seatingPlan.service";

async function buildPublishedCandidate() {
  const cls = await seededClass();
  const student = await createTestStudent(cls.id, "SNAP");
  const exam = await createTestExam();
  const candidate = await createTestCandidate(exam.id, student.id);

  const hall = await seededHall();
  const seats = await prisma.hallSeat.findMany({
    where: { hallId: hall.id },
    orderBy: { seatPosition: "asc" },
  });
  const plan = await createPlan(exam.id, "test-actor");
  await assignCandidateSeat({
    seatingPlanId: plan.id,
    examCandidateId: candidate.id,
    hallId: hall.id,
    hallSeatId: seats[0]!.id,
  });
  await approvePlan(plan.id, "test-actor");
  await publishPlan(plan.id, "test-actor");

  return { student, exam, candidate, hall, plan };
}

describe("Snapshot immutability", () => {
  it("does not change the candidate snapshot when student master data changes", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "MASTER");
    const exam = await createTestExam();
    const candidate = await createTestCandidate(exam.id, student.id);

    const before = {
      studentNameSnapshot: candidate.studentNameSnapshot,
      registerNumberSnapshot: candidate.registerNumberSnapshot,
      departmentSnapshot: candidate.departmentSnapshot,
      classSnapshot: candidate.classSnapshot,
      genderSnapshot: candidate.genderSnapshot,
    };

    await prisma.student.update({
      where: { id: student.id },
      data: {
        name: "EDITED MASTER NAME",
        registerNumber: "MASTER-EDITED-001",
        gender: "OTHER",
      },
    });

    const after = await prisma.examCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(after.studentNameSnapshot).toBe(before.studentNameSnapshot);
    expect(after.registerNumberSnapshot).toBe(before.registerNumberSnapshot);
    expect(after.departmentSnapshot).toBe(before.departmentSnapshot);
    expect(after.classSnapshot).toBe(before.classSnapshot);
    expect(after.genderSnapshot).toBe(before.genderSnapshot);
  });

  it("rejects snapshot edits for a candidate in a PUBLISHED plan (application layer)", async () => {
    const { candidate } = await buildPublishedCandidate();
    await expectRejected(
      updateCandidateSnapshot(candidate.id, { studentNameSnapshot: "REWRITTEN" }),
    );
    try {
      await updateCandidateSnapshot(candidate.id, { studentNameSnapshot: "REWRITTEN" });
      throw new Error("expected SNAPSHOT_LOCKED to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SeatingError);
      if (error instanceof SeatingError) expect(error.code).toBe("SNAPSHOT_LOCKED");
    }
    const persisted = await prisma.examCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(persisted.studentNameSnapshot).not.toBe("REWRITTEN");
  });

  it("rejects snapshot edits for a candidate in a PUBLISHED plan (database trigger)", async () => {
    const { candidate } = await buildPublishedCandidate();
    await expectRejected(
      prisma.examCandidate.update({
        where: { id: candidate.id },
        data: { registerNumberSnapshot: "HACKED-REG" },
      }),
    );
  });

  it("still allows snapshot edits while the plan is only a DRAFT", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "DRAFT");
    const exam = await createTestExam();
    const candidate = await createTestCandidate(exam.id, student.id);
    await createPlan(exam.id, "test-actor");

    const updated = await updateCandidateSnapshot(candidate.id, {
      studentNameSnapshot: "EDITED IN DRAFT",
    });
    expect(updated.studentNameSnapshot).toBe("EDITED IN DRAFT");
  });
});