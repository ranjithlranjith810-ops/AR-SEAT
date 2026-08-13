import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectRejected } from "./helpers";
import {
  createTestExam,
  createTestStudent,
  createValidatedCandidate,
  seededClass,
  seededHall,
} from "./fixtures";
import {
  cancelSolve,
  completeSolve,
  failSolve,
  heartbeat,
  markInfeasible,
  reapStaleJobs,
  requestSolve,
  startSolve,
} from "../src/services/solveJob.service";

async function createValidatedExam() {
  const cls = await seededClass();
  const exam = await createTestExam();
  const s1 = await createTestStudent(cls.id, "VS1");
  const s2 = await createTestStudent(cls.id, "VS2");
  await createValidatedCandidate(exam.id, s1.id);
  await createValidatedCandidate(exam.id, s2.id);
  const hall = await seededHall();
  const seats = await prisma.hallSeat.count({ where: { hallId: hall.id, isActive: true } });
  return { exam, seats };
}

describe("SolveJob", () => {
  it("can be queued", async () => {
    const { exam } = await createValidatedExam();
    const { job, created } = await requestSolve({ examId: exam.id, requestedBy: "admin" });
    expect(created).toBe(true);
    expect(job.status).toBe("QUEUED");
    expect(job.candidateCount).toBe(2);
  });

  it("transitions a queued job into RUNNING", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id });
    const running = await startSolve(job.id, "worker");
    expect(running.status).toBe("RUNNING");
    expect(running.startedAt).not.toBeNull();
    expect(running.heartbeatAt).not.toBeNull();
  });

  it("transitions a running job into SUCCEEDED with an OPTIMAL result", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id });
    await startSolve(job.id);
    const done = await completeSolve(job.id, {
      solverStatus: "OPTIMAL",
      assignedCount: 2,
      unassignedCount: 0,
      solverDurationMs: 120,
    });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.solverStatus).toBe("OPTIMAL");
    expect(done.assignedCount).toBe(2);
    expect(done.unassignedCount).toBe(0);
    expect(done.completedAt).not.toBeNull();
  });

  it("stores a FEASIBLE solver result when optimality is not proven", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id, timeLimitSeconds: 10 });
    await startSolve(job.id);
    const done = await completeSolve(job.id, {
      solverStatus: "FEASIBLE",
      assignedCount: 2,
      unassignedCount: 0,
      solverDurationMs: 5000,
    });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.solverStatus).toBe("FEASIBLE");
    expect(done.timeLimitSeconds).toBe(10);
  });

  it("records an INFEASIBLE result with a business reason instead of a server error", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id });
    await startSolve(job.id);
    const infeasible = await markInfeasible(job.id, {
      infeasibilityReason: "Candidates: 117, available seats: 100 -> insufficient available seating capacity.",
      assignedCount: 100,
      unassignedCount: 17,
    });
    expect(infeasible.status).toBe("INFEASIBLE");
    expect(infeasible.solverStatus).toBe("INFEASIBLE");
    expect(infeasible.infeasibilityReason).toContain("insufficient");
    expect(infeasible.unassignedCount).toBe(17);
  });

  it("stores an error code and message on FAILED", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id });
    await startSolve(job.id);
    const failed = await failSolve(job.id, {
      errorCode: "SOLVER_CRASH",
      errorMessage: "CP-SAT terminated unexpectedly",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("SOLVER_CRASH");
    expect(failed.errorMessage).toContain("CP-SAT");
  });

  it("rejects a duplicate active job for the same exam", async () => {
    const { exam } = await createValidatedExam();
    const first = await requestSolve({ examId: exam.id });
    const second = await requestSolve({ examId: exam.id });
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    const activeCount = await prisma.solveJob.count({
      where: { examId: exam.id, status: { in: ["QUEUED", "RUNNING"] } },
    });
    expect(activeCount).toBe(1);
  });

  it("allows independent jobs for different exams", async () => {
    const examA = await createTestExam();
    const examB = await createTestExam();
    const a = await requestSolve({ examId: examA.id });
    const b = await requestSolve({ examId: examB.id });
    expect(a.job.id).not.toBe(b.job.id);
    await startSolve(a.job.id);

    const examAActive = await prisma.solveJob.count({
      where: { examId: examA.id, status: { in: ["QUEUED", "RUNNING"] } },
    });
    const examBActive = await prisma.solveJob.count({
      where: { examId: examB.id, status: { in: ["QUEUED", "RUNNING"] } },
    });
    expect(examAActive).toBe(1);
    expect(examBActive).toBe(1);
  });

  it("refuses a heartbeat from a non-running job", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id });
    await expectRejected(heartbeat(job.id));
  });

  it("can be cancelled from QUEUED", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id });
    const cancelled = await cancelSolve(job.id, "admin");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("detects a stale heartbeat and reaps the job to FAILED with WORKER_TIMEOUT", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id });
    await startSolve(job.id);

    const oldTime = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.solveJob.update({ where: { id: job.id }, data: { heartbeatAt: oldTime } });

    const reaped = await reapStaleJobs(new Date(), 60_000);
    expect(reaped).toContain(job.id);

    const persisted = await prisma.solveJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(persisted.status).toBe("FAILED");
    expect(persisted.errorCode).toBe("WORKER_TIMEOUT");
  });

  it("does not reap a job with a fresh heartbeat", async () => {
    const { exam } = await createValidatedExam();
    const { job } = await requestSolve({ examId: exam.id });
    await startSolve(job.id);
    const fresh = await heartbeat(job.id);
    expect(fresh.heartbeatAt).not.toBeNull();
    const reaped = await reapStaleJobs(new Date(), 60_000);
    expect(reaped).not.toContain(job.id);
  });

  it("allows a new solve after the previous one reached a terminal state", async () => {
    const { exam } = await createValidatedExam();
    const first = await requestSolve({ examId: exam.id });
    await startSolve(first.job.id);
    await completeSolve(first.job.id, {
      solverStatus: "OPTIMAL",
      assignedCount: 2,
      unassignedCount: 0,
    });
    const second = await requestSolve({ examId: exam.id });
    expect(second.created).toBe(true);
    expect(second.job.id).not.toBe(first.job.id);
  });
});