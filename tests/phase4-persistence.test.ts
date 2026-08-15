import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { createTestExam, createTestStudent, seededClass, createValidatedCandidate } from "./fixtures";
import { requestSolve, startSolve } from "../src/services/solveJob.service";
import { buildSolverInput } from "../src/services/solverInput.service";
import { runGeneration } from "../src/phase4/generation.service";
import type { SolverDispatch, DomainSolveResult } from "../src/phase4/types";
import { solverInputToDomains } from "../src/phase4/integration";
import { persistValidatedGeneration } from "../src/phase4/persist";

function stubOptimalDispatch(): SolverDispatch {
  return {
    async solveDomain(payload): Promise<DomainSolveResult> {
      const hall = payload.halls[0]!;
      return {
        requestId: payload.requestId,
        domainId: payload.requestId.split(":")[1]!,
        status: "OPTIMAL",
        assignments: payload.candidates.map((c, i) => ({
          candidateId: c.id,
          hallId: hall.id,
          hallSeatId: hall.seats[i]!.id,
        })),
        solverDurationMs: 5,
        candidateCount: payload.candidateCount,
        assignedCount: payload.candidateCount,
        unassignedCount: 0,
        reportedObjective: 0,
        rawSolverObjective: 0,
        validatorObjective: 0,
        infeasibilityReason: null,
        errorCode: null,
        errorMessage: null,
      };
    },
  };
}

async function createValidatedCandidates(examId: string, count: number) {
  const cls = await seededClass("CSE-A");
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const student = await createTestStudent(cls.id, `P${i}`);
    candidates.push(
      await createValidatedCandidate(examId, student.id, student.registerNumber),
    );
  }
  return candidates;
}

describe("phase4 persistence integration", () => {
  it("persists a fully validated generation as a DRAFT plan with assignments and a SUCCEEDED job", async () => {
    const exam = await createTestExam();
    const candidates = await createValidatedCandidates(exam.id, 10);

    const { job } = await requestSolve({ examId: exam.id, requestedBy: "test-actor" });
    expect(job.status).toBe("QUEUED");
    await startSolve(job.id, "test-actor");

    const input = await buildSolverInput(exam.id);
    expect(input.candidates).toHaveLength(10);
    const { candidates: domainCandidates, halls } = solverInputToDomains(input);

    const result = await runGeneration({
      generationId: `gen:${job.id}`,
      examId: exam.id,
      candidates: domainCandidates,
      halls,
      timeLimitSeconds: 10,
      maxParallelDomains: 1,
      solverConfig: { policyMode: "DEPARTMENT_ONLY" },
      dispatch: stubOptimalDispatch(),
      persist: async (pending) =>
        persistValidatedGeneration({
          jobId: job.id,
          examId: exam.id,
          result: pending,
          createdBy: "test-actor",
        }),
    });

    expect(result.state).toBe("COMPLETED");
    expect(result.plan?.seatingPlanId).toBeTruthy();

    const plan = await prisma.seatingPlan.findUniqueOrThrow({
      where: { id: result.plan!.seatingPlanId! },
      include: { assignments: true },
    });
    expect(plan.status).toBe("DRAFT");
    expect(plan.version).toBe(1);
    expect(plan.assignments).toHaveLength(10);

    const savedJob = await prisma.solveJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(savedJob.status).toBe("SUCCEEDED");
    expect(savedJob.solverStatus).toBe("OPTIMAL");
    expect(savedJob.assignedCount).toBe(10);
    expect(savedJob.unassignedCount).toBe(0);
    expect(candidates.length).toBe(10);
  });

  it("supersedes the previous plan when a new generation is persisted", async () => {
    const exam = await createTestExam();
    await createValidatedCandidates(exam.id, 5);

    const { job: job1 } = await requestSolve({ examId: exam.id, requestedBy: "test-actor" });
    await startSolve(job1.id, "test-actor");
    const input1 = await buildSolverInput(exam.id);
    const domains1 = solverInputToDomains(input1);
    const result1 = await runGeneration({
      generationId: `gen:${job1.id}`,
      examId: exam.id,
      candidates: domains1.candidates,
      halls: domains1.halls,
      timeLimitSeconds: 10,
      maxParallelDomains: 1,
      solverConfig: { policyMode: "DEPARTMENT_ONLY" },
      dispatch: stubOptimalDispatch(),
      persist: async (pending) =>
        persistValidatedGeneration({ jobId: job1.id, examId: exam.id, result: pending, createdBy: "test-actor" }),
    });
    expect(result1.state).toBe("COMPLETED");

    const { job: job2, created } = await requestSolve({ examId: exam.id, requestedBy: "test-actor" });
    expect(created).toBe(true);
    await startSolve(job2.id, "test-actor");
    const input2 = await buildSolverInput(exam.id);
    const domains2 = solverInputToDomains(input2);
    const result2 = await runGeneration({
      generationId: `gen:${job2.id}`,
      examId: exam.id,
      candidates: domains2.candidates,
      halls: domains2.halls,
      timeLimitSeconds: 10,
      maxParallelDomains: 1,
      solverConfig: { policyMode: "DEPARTMENT_ONLY" },
      dispatch: stubOptimalDispatch(),
      persist: async (pending) =>
        persistValidatedGeneration({ jobId: job2.id, examId: exam.id, result: pending, createdBy: "test-actor" }),
    });
    expect(result2.state).toBe("COMPLETED");

    const plans = await prisma.seatingPlan.findMany({
      where: { examId: exam.id },
      orderBy: { version: "asc" },
    });
    expect(plans.map((p) => p.version)).toEqual([1, 2]);
    expect(plans.map((p) => p.status)).toEqual(["SUPERSEDED", "DRAFT"]);
    expect(plans[1]!.supersedesPlanId).toBe(plans[0]!.id);
  });

  it("never publishes anything when a domain is infeasible", async () => {
    const exam = await createTestExam();
    await createValidatedCandidates(exam.id, 6);

    const { job } = await requestSolve({ examId: exam.id, requestedBy: "test-actor" });
    await startSolve(job.id, "test-actor");
    const input = await buildSolverInput(exam.id);
    const domains = solverInputToDomains(input);

    const infeasibleDispatch: SolverDispatch = {
      async solveDomain(payload) {
        return {
          requestId: payload.requestId,
          domainId: payload.requestId.split(":")[1]!,
          status: "INFEASIBLE",
          assignments: [],
          solverDurationMs: 5,
          candidateCount: payload.candidateCount,
          assignedCount: 0,
          unassignedCount: payload.candidateCount,
          reportedObjective: null,
          rawSolverObjective: null,
          validatorObjective: null,
          infeasibilityReason: "no feasible arrangement",
          errorCode: null,
          errorMessage: null,
        };
      },
    };

    const result = await runGeneration({
      generationId: `gen:${job.id}`,
      examId: exam.id,
      candidates: domains.candidates,
      halls: domains.halls,
      timeLimitSeconds: 10,
      maxParallelDomains: 1,
      solverConfig: { policyMode: "DEPARTMENT_ONLY" },
      dispatch: infeasibleDispatch,
      persist: async (pending) =>
        persistValidatedGeneration({ jobId: job.id, examId: exam.id, result: pending, createdBy: "test-actor" }),
    });

    expect(result.state).toBe("FAILED_DOMAIN");
    expect(result.plan).toBeNull();
    expect(result.merge).toBeNull();

    const planCount = await prisma.seatingPlan.count({ where: { examId: exam.id } });
    expect(planCount).toBe(0);
    const assignmentCount = await prisma.seatAssignment.count({
      where: { seatingPlan: { examId: exam.id } },
    });
    expect(assignmentCount).toBe(0);

    const savedJob = await prisma.solveJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(savedJob.status).toBe("RUNNING");
  });
});