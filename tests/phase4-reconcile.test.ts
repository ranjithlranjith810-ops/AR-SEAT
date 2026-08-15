/**
 * Phase 4 — ingestion reconciliation gate (§6) + job idempotency (§13).
 *
 * The pipeline must never silently drop a candidate. A session with any
 * non-VALIDATED candidate, or with duplicate register numbers, STOPS with
 * ERR_CANDIDATE_RECONCILIATION and publishes nothing. A second active solve
 * job for the same exam is refused (idempotency key: exam/session + config).
 */
import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import {
  createTestExam,
  createTestStudent,
  createTestCandidate,
  createValidatedCandidate,
  seededClass,
} from "./fixtures";
import { requestSolve, startSolve } from "../src/services/solveJob.service";
import { runSeatingGeneration } from "../src/phase4/integration";
import { reconcileExamForGeneration, ERR_CANDIDATE_RECONCILIATION } from "../src/phase4/reconcile";

async function createExamWithCandidates(validated: number, unvalidated: number) {
  const exam = await createTestExam();
  const cls = await seededClass("CSE-A");
  const made: Array<{ id: string; registerNumber: string }> = [];
  for (let i = 0; i < validated; i++) {
    const student = await createTestStudent(cls.id, `RV${i}`);
    const candidate = await createValidatedCandidate(exam.id, student.id);
    made.push({ id: candidate.id, registerNumber: candidate.registerNumberSnapshot });
  }
  for (let i = 0; i < unvalidated; i++) {
    const student = await createTestStudent(cls.id, `RU${i}`);
    const candidate = await createTestCandidate(exam.id, student.id);
    made.push({ id: candidate.id, registerNumber: candidate.registerNumberSnapshot });
  }
  return { exam, made };
}

describe("phase4 reconciliation gate", () => {
  it("stops with ERR_CANDIDATE_RECONCILIATION when a candidate is not VALIDATED", async () => {
    const { exam, made } = await createExamWithCandidates(2, 1);

    const reconciled = await reconcileExamForGeneration(exam.id);
    expect(reconciled.ok).toBe(false);
    expect(reconciled.candidateCount).toBe(3);
    expect(reconciled.validatedCount).toBe(2);
    expect(reconciled.nonValidated).toHaveLength(1);
    const issue = reconciled.nonValidated[0]!;
    expect(issue.registerNumber).toBe(made[2]!.registerNumber);
    expect(issue.reason).toContain("UNVERIFIED");
    expect(issue.dbValue).toBe(made[2]!.registerNumber);

    const output = await runSeatingGeneration({ examId: exam.id, requestedBy: "test-actor" });
    expect(output.jobCreated).toBe(true);
    expect(output.result.state).toBe("FAILED_RECONCILIATION");
    expect(output.result.error?.code).toBe(ERR_CANDIDATE_RECONCILIATION);
    expect(output.result.error?.message).toContain("2/3 candidates validated");
    expect(output.result.plan).toBeNull();

    const savedJob = await prisma.solveJob.findUniqueOrThrow({ where: { id: output.jobId } });
    expect(savedJob.status).toBe("FAILED");
    expect(savedJob.errorCode).toBe(ERR_CANDIDATE_RECONCILIATION);

    // No solver dispatch happened, so nothing was persisted.
    const plans = await prisma.seatingPlan.findMany({ where: { examId: exam.id } });
    expect(plans).toHaveLength(0);
  });

  it("stops with ERR_CANDIDATE_RECONCILIATION when the parsed snapshot diverges from the student master", async () => {
    const exam = await createTestExam();
    const cls = await seededClass("CSE-A");
    const student = await createTestStudent(cls.id, "MISMATCH");
    await createValidatedCandidate(exam.id, student.id, "REG-PARSED-DIVERGED");

    const reconciled = await reconcileExamForGeneration(exam.id);
    expect(reconciled.ok).toBe(false);
    expect(reconciled.nonValidated).toHaveLength(1);
    const issue = reconciled.nonValidated[0]!;
    expect(issue.registerNumber).toBe("REG-PARSED-DIVERGED");
    expect(issue.dbValue).toBe(student.registerNumber);
    expect(issue.reason).toContain("student.registerNumber");

    const output = await runSeatingGeneration({ examId: exam.id, requestedBy: "test-actor" });
    expect(output.result.state).toBe("FAILED_RECONCILIATION");
    expect(output.result.error?.code).toBe(ERR_CANDIDATE_RECONCILIATION);
    expect(output.result.error?.message).toContain(student.registerNumber);
  });
});

describe("phase4 job idempotency", () => {
  it("refuses a second active job for the same exam", async () => {
    const exam = await createTestExam();
    await createExamWithCandidates(1, 0);

    const first = await requestSolve({ examId: exam.id, requestedBy: "test-actor" });
    expect(first.created).toBe(true);
    await startSolve(first.job.id, "test-actor");

    const second = await requestSolve({ examId: exam.id, requestedBy: "test-actor" });
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    const output = await runSeatingGeneration({ examId: exam.id, requestedBy: "test-actor" });
    expect(output.jobCreated).toBe(false);
    expect(output.result.error?.code).toBe("ERR_JOB_ALREADY_ACTIVE");
  });
});