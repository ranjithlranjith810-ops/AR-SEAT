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
import { assignCandidateSeat } from "../src/services/seatAssignment.service";
import { createPlan } from "../src/services/seatingPlan.service";

async function buildOperationalRow() {
  const cls = await seededClass();
  const student = await createTestStudent(cls.id, "OP");
  const exam = await createTestExam();
  const candidate = await createTestCandidate(exam.id, student.id);
  const hall = await seededHall();
  const seats = await prisma.hallSeat.findMany({
    where: { hallId: hall.id },
    orderBy: { seatPosition: "asc" },
  });
  const plan = await createPlan(exam.id, "test-actor");
  const assignment = await assignCandidateSeat({
    seatingPlanId: plan.id,
    examCandidateId: candidate.id,
    hallId: hall.id,
    hallSeatId: seats[0]!.id,
  });
  return { student, exam, candidate, plan, assignment };
}

describe("No hard delete policy", () => {
  it("refuses to hard-delete an operational exam", async () => {
    const { exam } = await buildOperationalRow();
    await expectRejected(prisma.exam.delete({ where: { id: exam.id } }));
    expect(await prisma.exam.count({ where: { id: exam.id } })).toBe(1);
  });

  it("refuses to hard-delete an operational candidate", async () => {
    const { candidate } = await buildOperationalRow();
    await expectRejected(prisma.examCandidate.delete({ where: { id: candidate.id } }));
    expect(await prisma.examCandidate.count({ where: { id: candidate.id } })).toBe(1);
  });

  it("refuses to hard-delete a seating plan", async () => {
    const { plan } = await buildOperationalRow();
    await expectRejected(prisma.seatingPlan.delete({ where: { id: plan.id } }));
    expect(await prisma.seatingPlan.count({ where: { id: plan.id } })).toBe(1);
  });

  it("refuses to hard-delete a seat assignment", async () => {
    const { assignment } = await buildOperationalRow();
    await expectRejected(prisma.seatAssignment.delete({ where: { id: assignment.id } }));
    expect(await prisma.seatAssignment.count({ where: { id: assignment.id } })).toBe(1);
  });

  it("refuses to hard-delete an uploaded operational document", async () => {
    const { exam } = await buildOperationalRow();
    const doc = await prisma.uploadedExamDocument.create({
      data: {
        examId: exam.id,
        fileName: "may2026.pdf",
        storagePath: "private/exams/may2026.pdf",
        mimeType: "application/pdf",
        fileSize: 2048,
        fileHash: "abc123",
        parseStatus: "PARSED",
      },
    });
    await expectRejected(prisma.uploadedExamDocument.delete({ where: { id: doc.id } }));
    expect(await prisma.uploadedExamDocument.count({ where: { id: doc.id } })).toBe(1);
  });

  it("preserves a student record once examination history exists", async () => {
    const { student } = await buildOperationalRow();
    await expectRejected(prisma.student.delete({ where: { id: student.id } }));
    const persisted = await prisma.student.findUnique({ where: { id: student.id } });
    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe("ACTIVE");
  });

  it("still allows deleting a student with no examination history", async () => {
    const cls = await seededClass();
    const student = await prisma.student.create({
      data: {
        name: "FRESH STUDENT",
        rollNumber: "FRSH-1",
        registerNumber: "FRESH-REG-1",
        gender: "MALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    await prisma.student.delete({ where: { id: student.id } });
    expect(await prisma.student.count({ where: { id: student.id } })).toBe(0);
  });

  it("uses lifecycle status instead of deletion for exams", async () => {
    const exam = await createTestExam();
    await prisma.exam.update({ where: { id: exam.id }, data: { status: "CANCELLED" } });
    const persisted = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(persisted.status).toBe("CANCELLED");
  });
});