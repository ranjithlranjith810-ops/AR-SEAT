/**
 * Phase 4 — DB-backed generation integration (§7, §13).
 *
 * Wires the frozen buildSolverInput + SolveJob lifecycle to the pure
 * orchestration pipeline and the persistence layer. This is the only place
 * that touches the database for generation; everything else in phase4 is
 * deterministic and testable without one.
 */
import { requestSolve, startSolve } from "../services/solveJob.service";
import { buildSolverInput } from "../services/solverInput.service";
import type { SolverHall, SolverInput } from "../services/solverInput.service";
import { logAudit } from "../services/audit.service";
import {
  ERR_CANDIDATE_RECONCILIATION,
  describeReconciliation,
  reconcileExamForGeneration,
} from "./reconcile";
import type {
  DomainCandidate,
  DomainHall,
  DomainSolvePayload,
  GenerationResult,
  GenerateOptions,
  SolverDispatch,
} from "./types";
import { runGeneration } from "./generation.service";
import { solveDomain } from "./solverClient";
import {
  failGenerationPersistence,
  markGenerationInfeasible,
  persistValidatedGeneration,
} from "./persist";

export interface RunSeatingGenerationOptions extends Omit<GenerateOptions, "dispatch"> {
  examId: string;
  requestedBy?: string;
  dispatch?: SolverDispatch;
}

export interface RunSeatingGenerationOutput {
  jobId: string;
  jobCreated: boolean;
  result: GenerationResult;
  persisted?: GenerationResult["plan"];
}

export async function runSeatingGeneration(
  options: RunSeatingGenerationOptions,
): Promise<RunSeatingGenerationOutput> {
  const { examId, requestedBy, dispatch, ...generate } = options;

  const { job, created } = await requestSolve({
    examId,
    requestedBy,
    timeLimitSeconds: generate.timeLimitSeconds ?? 60,
  });
  if (!created) {
    return {
      jobId: job.id,
      jobCreated: false,
      result: {
        generationId: job.id,
        examId,
        state: "FAILED_DOMAIN",
        session: null,
        sessionCandidateCount: job.candidateCount ?? 0,
        domainCount: 0,
        completedDomainCount: 0,
        failedDomainCount: 0,
        failedDomainIds: [],
        blockedDomainIds: [],
        domains: [],
        merge: null,
        timings: {
          partitionMs: 0,
          dispatchMs: 0,
          solveMs: 0,
          validationMs: 0,
          mergeMs: 0,
          persistMs: 0,
          wallClockMs: 0,
        },
        plan: null,
        error: {
          code: "ERR_JOB_ALREADY_ACTIVE",
          message: `an active solve job already exists for exam ${examId}`,
        },
      },
    };
  }
  const jobId = job.id;

  await startSolve(jobId, requestedBy);
  await logAudit({
    action: "SOLVE_STARTED",
    entityType: "SolveJob",
    entityId: jobId,
    actorId: requestedBy,
    metadata: { phase: "PHASE4_GENERATION", generationId: jobId },
  });

  // §6/§7 — reconciliation + session identity BEFORE any solver dispatch.
  // Never silently drop a candidate; one Exam row is one session boundary.
  const generationId = `gen:${jobId}`;
  const reconciled = await reconcileExamForGeneration(examId);
  if (!reconciled.ok) {
    const message = describeReconciliation(reconciled);
    await logAudit({
      action: "SOLVE_FAILED",
      entityType: "SolveJob",
      entityId: jobId,
      actorId: requestedBy,
      metadata: { phase: "PHASE4_RECONCILIATION", error: ERR_CANDIDATE_RECONCILIATION, detail: message },
    });
    await failGenerationPersistence({
      jobId,
      examId,
      result: {
        generationId,
        examId,
        state: "FAILED_RECONCILIATION",
        session: reconciled.session,
        sessionCandidateCount: reconciled.candidateCount,
        domainCount: 0,
        completedDomainCount: 0,
        failedDomainCount: 0,
        failedDomainIds: [],
        blockedDomainIds: [],
        domains: [],
        merge: null,
        timings: {
          partitionMs: 0,
          dispatchMs: 0,
          solveMs: 0,
          validationMs: 0,
          mergeMs: 0,
          persistMs: 0,
          wallClockMs: 0,
        },
        plan: null,
        error: { code: ERR_CANDIDATE_RECONCILIATION, message },
      },
      createdBy: requestedBy,
    });
    return {
      jobId,
      jobCreated: true,
      result: {
        generationId,
        examId,
        state: "FAILED_RECONCILIATION",
        session: reconciled.session,
        sessionCandidateCount: reconciled.candidateCount,
        domainCount: 0,
        completedDomainCount: 0,
        failedDomainCount: 0,
        failedDomainIds: [],
        blockedDomainIds: [],
        domains: [],
        merge: null,
        timings: {
          partitionMs: 0,
          dispatchMs: 0,
          solveMs: 0,
          validationMs: 0,
          mergeMs: 0,
          persistMs: 0,
          wallClockMs: 0,
        },
        plan: null,
        error: { code: ERR_CANDIDATE_RECONCILIATION, message },
      },
    };
  }

  const input = await buildSolverInput(examId);
  const { candidates, halls } = solverInputToDomains(input);

  const result = await runGeneration({
    generationId,
    examId,
    candidates,
    halls,
    ...generate,
    session: reconciled.session,
    dispatch: dispatch ?? { solveDomain },
    persist: async (pendingResult) => {
      const persisted = await persistValidatedGeneration({
        jobId,
        examId,
        result: pendingResult,
        createdBy: requestedBy,
      });
      return {
        seatingPlanId: persisted.seatingPlanId,
        version: persisted.version,
        solverStatus: persisted.solverStatus,
        assignedCount: persisted.assignedCount,
        unassignedCount: persisted.unassignedCount,
      };
    },
  });

  const failed = result.error;
  if (failed) {
    if (failed.code === "ERR_DOMAIN_INFEASIBLE") {
      await markGenerationInfeasible({ jobId, examId, result, createdBy: requestedBy });
    } else {
      await failGenerationPersistence({ jobId, examId, result, createdBy: requestedBy });
    }
  }

  return {
    jobId,
    jobCreated: true,
    result,
    persisted: result.plan ?? undefined,
  };
}

export function solverInputToDomains(input: SolverInput): {
  candidates: DomainCandidate[];
  halls: DomainHall[];
} {
  const candidates: DomainCandidate[] = input.candidates.map((c) => ({
    id: c.id,
    registerNumber: c.registerNumberSnapshot,
    studentName: c.studentNameSnapshot,
    department: c.departmentSnapshot,
    class: c.classSnapshot,
    gender: c.genderSnapshot,
    subjectCode: c.subjectCode,
    subjectName: c.subjectName,
  }));

  const halls: DomainHall[] = input.halls.map((h: SolverHall) => ({
    id: h.id,
    hallNumber: h.hallNumber,
    name: h.name,
    building: h.building,
    rows: h.rows,
    columns: h.columns,
    capacity: h.capacity,
    seats: h.seats.map((s) => ({
      id: s.id,
      seatPosition: s.seatPosition,
      row: s.row,
      column: s.column,
    })),
  }));

  return { candidates, halls };
}

export function domainPayloadToSolverInput(payload: DomainSolvePayload): SolverInput {
  return {
    candidates: payload.candidates.map((c) => ({
      id: c.id,
      registerNumberSnapshot: c.registerNumber,
      studentNameSnapshot: c.studentName,
      departmentSnapshot: c.department,
      classSnapshot: c.class,
      genderSnapshot: c.gender,
      subjectCode: c.subjectCode,
      subjectName: c.subjectName,
    })),
    halls: payload.halls.map((hall) => ({
      id: hall.id,
      hallNumber: hall.hallNumber,
      name: hall.name,
      building: hall.building,
      rows: hall.rows,
      columns: hall.columns,
      capacity: hall.capacity,
      seats: hall.seats.map((s) => ({
        id: s.id,
        seatPosition: s.seatPosition,
        row: s.row,
        column: s.column,
      })),
    })),
    candidateCount: payload.candidateCount,
    availableSeatCount: payload.availableSeatCount,
  };
}