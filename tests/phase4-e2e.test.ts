/**
 * Phase 4 — end-to-end production pipeline (spec §22).
 *
 * Real exam rows (two sessions: FN + AN), mixed departments, four halls,
 * 320 validated candidates total. Runs the full orchestration:
 * reconciliation -> session identity -> partition -> (stub dispatch) ->
 * authoritative validation -> merge -> transactional persistence -> Proforma 1
 * -> PDF round-trip. No candidate may be lost, no seat may be double-booked,
 * and the generated PDF must agree with the persisted plan.
 *
 * Candidates are bulk-created with createMany to keep the test fast against
 * the remote test database (per-row service writes over the pooler are too
 * slow for 320 candidates). A separate reconciliation-failure test covers the
 * UNVERIFIED/MATCHED gate.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./setup";
import { seededClass } from "./fixtures";
import { createHall } from "../src/services/hall.service";
import { createExam } from "../src/services/exam.service";
import { requestSolve, startSolve } from "../src/services/solveJob.service";
import { buildSolverInput } from "../src/services/solverInput.service";
import { solverInputToDomains } from "../src/phase4/integration";
import { runGeneration } from "../src/phase4/generation.service";
import { reconcileExamForGeneration } from "../src/phase4/reconcile";
import { persistValidatedGeneration } from "../src/phase4/persist";
import { buildProformaInputFromPlan, generateProforma1 } from "../src/phase4/proforma";
import { extractPdfText } from "../src/services/exam-document/pdf";
import type { DomainSolveResult, SolverDispatch } from "../src/phase4/types";

const DEPT_CLASSES = ["CSE-A", "ECE-A", "EEE-A", "MECH-A"] as const;
const PER_DEPT = 40; // 160 candidates per session, 320 across both sessions.
const E2E_DATE = new Date("2026-11-10T00:00:00Z");
const NONCE = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
        solverDurationMs: 8,
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

async function cleanUpE2EMarkers(): Promise<void> {
  const exams = await prisma.exam.findMany({
    where: { examDate: { gte: E2E_DATE, lt: new Date(E2E_DATE.getTime() + 86400000) } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  if (examIds.length > 0) {
    await prisma.seatAssignment.deleteMany({ where: { seatingPlan: { examId: { in: examIds } } } });
    await prisma.seatingPlan.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.solveJob.deleteMany({ where: { examId: { in: examIds } } });
    const candidates = await prisma.examCandidate.findMany({
      where: { examId: { in: examIds } },
      select: { studentId: true },
    });
    await prisma.examCandidate.deleteMany({ where: { examId: { in: examIds } } });
    const studentIds = [...new Set(candidates.map((c) => c.studentId))];
    if (studentIds.length > 0) {
      await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    }
    // Exam rows are soft-delete protected by a DB trigger — leave them.
  }
  const halls = await prisma.hall.findMany({
    where: { hallNumber: { startsWith: "LH-E2E-" } },
    select: { id: true },
  });
  const hallIds = halls.map((h) => h.id);
  if (hallIds.length > 0) {
    await prisma.hallSeat.deleteMany({ where: { hallId: { in: hallIds } } });
    await prisma.hall.deleteMany({ where: { id: { in: hallIds } } });
  }
}

async function createMixedCandidates(examId: string, tagPrefix: string): Promise<void> {
  const rows: Array<{ cls: Awaited<ReturnType<typeof seededClass>>; register: string; name: string }> = [];
  let i = 0;
  for (const className of DEPT_CLASSES) {
    const cls = await seededClass(className);
    for (let k = 0; k < PER_DEPT; k++) {
      i += 1;
      rows.push({
        cls,
        register: `REG-${NONCE}-${tagPrefix}-${i}`,
        name: `Student ${tagPrefix} ${i}`,
      });
    }
  }
  await prisma.student.createMany({
    data: rows.map((r) => ({
      name: r.name,
      rollNumber: `R-${NONCE}-${tagPrefix}-${i}`,
      registerNumber: r.register,
      gender: "MALE",
      classId: r.cls.id,
      status: "ACTIVE",
    })),
  });
  const students = await prisma.student.findMany({
    where: { registerNumber: { in: rows.map((r) => r.register) } },
    select: { id: true, registerNumber: true },
  });
  const studentByReg = new Map(students.map((s) => [s.registerNumber, s.id]));
  await prisma.examCandidate.createMany({
    data: rows.map((r) => ({
      examId,
      studentId: studentByReg.get(r.register)!,
      registerNumberSnapshot: r.register,
      studentNameSnapshot: r.name,
      departmentSnapshot: r.cls.department.code,
      classSnapshot: r.cls.name,
      genderSnapshot: "MALE",
      subjectCode: "CS8501",
      subjectName: "Theory of Computation",
      validationStatus: "VALIDATED",
    })),
  });
}

function extractRegisterNumbers(text: string): string[] {
  const tokens = text.split(/\s+/);
  return [...new Set(tokens.filter((t) => t.startsWith("REG-")))].sort();
}

describe("phase4 end-to-end production pipeline", () => {
  beforeEach(async () => {
    await cleanUpE2EMarkers();
  });

  it("seats two sessions end-to-end without losing candidates and round-trips Proforma 1", async () => {
    const halls = [];
    for (let i = 0; i < 4; i++) {
      halls.push(
        await createHall({
          hallNumber: `LH-E2E-${NONCE}-${i}`,
          name: `E2E Hall ${i}`,
          rows: 10,
          columns: 10,
        }),
      );
    }
    expect(halls).toHaveLength(4);

    const examFN = await createExam({ examDate: new Date("2026-11-10T09:30:00Z"), session: "FN" }, "test-actor");
    const examAN = await createExam({ examDate: new Date("2026-11-10T14:00:00Z"), session: "AN" }, "test-actor");

    await createMixedCandidates(examFN.id, "FN");
    await createMixedCandidates(examAN.id, "AN");

    const runSession = async (
      exam: { id: string; examDate: Date; session: "FN" | "AN" },
      expectedCount: number,
    ) => {
      // §6/§7 — reconciliation + session identity.
      const reconciled = await reconcileExamForGeneration(exam.id);
      expect(reconciled.ok).toBe(true);
      expect(reconciled.candidateCount).toBe(expectedCount);
      expect(reconciled.validatedCount).toBe(expectedCount);
      expect(reconciled.session.examId).toBe(exam.id);
      expect(reconciled.session.timeSlot).toBe(exam.session);
      expect(reconciled.session.examDate).toBe(exam.examDate.toISOString());

      const input = await buildSolverInput(exam.id);
      expect(input.candidates).toHaveLength(expectedCount);
      const { candidates, halls: domainHalls } = solverInputToDomains(input);

      const { job } = await requestSolve({ examId: exam.id, requestedBy: "test-actor" });
      expect(job.status).toBe("QUEUED");
      await startSolve(job.id, "test-actor");

      const result = await runGeneration({
        generationId: `gen:${job.id}`,
        examId: exam.id,
        candidates,
        halls: domainHalls,
        timeLimitSeconds: 30,
        maxParallelDomains: 4,
        solverConfig: { policyMode: "DEPARTMENT_ONLY" },
        session: reconciled.session,
        dispatch: stubOptimalDispatch(),
        persist: async (pending) =>
          persistValidatedGeneration({ jobId: job.id, examId: exam.id, result: pending, createdBy: "test-actor" }),
      });

      // §12/§15 — full completion, nothing partial.
      expect(result.state).toBe("COMPLETED");
      expect(result.session?.timeSlot).toBe(exam.session);
      expect(result.sessionCandidateCount).toBe(expectedCount);
      expect(result.merge?.valid).toBe(true);
      expect(result.merge?.assignedCandidateCount).toBe(expectedCount);
      expect(result.plan?.assignedCount).toBe(expectedCount);
      expect(result.plan?.unassignedCount).toBe(0);
      expect(result.plan?.seatingPlanId).toBeTruthy();

      // §13 — transactional persistence: DRAFT plan + one assignment per candidate.
      const plan = await prisma.seatingPlan.findUniqueOrThrow({
        where: { id: result.plan!.seatingPlanId! },
        include: {
          assignments: {
            include: { examCandidate: true, hall: true, hallSeat: true },
          },
        },
      });
      expect(plan.status).toBe("DRAFT");
      expect(plan.version).toBe(1);
      expect(plan.assignments).toHaveLength(expectedCount);

      const seatIds = plan.assignments.map((a) => a.hallSeatId);
      expect(new Set(seatIds).size).toBe(expectedCount);

      const savedJob = await prisma.solveJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(savedJob.status).toBe("SUCCEEDED");
      expect(savedJob.assignedCount).toBe(expectedCount);
      expect(savedJob.unassignedCount).toBe(0);

      // §18/§19 — Proforma 1 from the persisted plan, then PDF round-trip.
      const proformaInput = buildProformaInputFromPlan(exam, plan);
      const output = await generateProforma1(proformaInput);
      expect(output.pageCount).toBeGreaterThanOrEqual(1);

      const pages = await extractPdfText(output.pdf);
      const allText = pages.map((p) => p.text).join("\n");
      expect(allText).toContain("PROFORMA - 1");
      expect(allText).toContain("GRAND TOTAL");

      const pdfRegisters = extractRegisterNumbers(allText);
      const persistedRegisters = plan.assignments
        .map((a) => a.examCandidate.registerNumberSnapshot)
        .sort();
      expect(pdfRegisters).toEqual(persistedRegisters);

      return { result, job, plan };
    };

    const fn = await runSession(examFN, DEPT_CLASSES.length * PER_DEPT);
    const an = await runSession(examAN, DEPT_CLASSES.length * PER_DEPT);

    // §7 — session isolation: the two sessions never share candidates.
    const fnRegisters = new Set(fn.plan.assignments.map((a) => a.examCandidate.registerNumberSnapshot));
    const anRegisters = new Set(an.plan.assignments.map((a) => a.examCandidate.registerNumberSnapshot));
    for (const reg of fnRegisters) expect(anRegisters.has(reg)).toBe(false);

    for (const [exam, run] of [
      [examFN, fn],
      [examAN, an],
    ] as const) {
      for (const assignment of run.plan.assignments) {
        expect(assignment.examCandidate.examId).toBe(exam.id);
      }
    }
  }, 240000);
});