/**
 * Phase 4 — persistence integration (§13).
 *
 * Persists a fully validated generation using the EXISTING schema and service
 * conventions only: a new SeatingPlan version (DRAFT) + batched SeatAssignment
 * rows in one transaction, then the existing SolveJob completion lifecycle.
 * No new tables, no migrations, no unrelated schema changes.
 */
import { prisma } from "../db";
import type { Prisma } from "@prisma/client";
import { SeatingError } from "../errors";
import {
  completeSolve,
  failSolve,
  markInfeasible,
} from "../services/solveJob.service";
import { logAudit } from "../services/audit.service";
import type { DomainAssignment, GenerationResult, SolverStatus } from "./types";

export interface PersistGenerationInput {
  jobId: string;
  examId: string;
  result: GenerationResult;
  createdBy?: string;
}

export interface PersistedPlan {
  seatingPlanId: string;
  version: number;
  assignedCount: number;
  unassignedCount: number;
  solverStatus: SolverStatus;
}

/**
 * Transactionally create a new DRAFT SeatingPlan version and persist every
 * validated assignment. The job is only completed (SUCCEEDED) AFTER this
 * transaction commits — a failure here rolls back and never marks success.
 */
export async function persistValidatedGeneration(
  input: PersistGenerationInput,
): Promise<PersistedPlan> {
  const { examId, result, createdBy } = input;
  const assignments = collectAssignments(result);
  const assignedCount = assignments.length;
  const unassignedCount = result.sessionCandidateCount - assignedCount;
  const solverStatus: SolverStatus = result.domains.every(
    (d) => d.result?.status === "OPTIMAL",
  )
    ? "OPTIMAL"
    : "FEASIBLE";

  const plan = await prisma.$transaction(async (tx) => {
    const latest = await tx.seatingPlan.findFirst({
      where: { examId },
      orderBy: { version: "desc" },
    });
    if (latest && latest.status !== "SUPERSEDED") {
      await tx.seatingPlan.update({
        where: { id: latest.id },
        data: { status: "SUPERSEDED" },
      });
      await tx.auditLog.create({
        data: {
          action: "PLAN_SUPERSEDED",
          entityType: "SeatingPlan",
          entityId: latest.id,
          actorId: createdBy ?? null,
        },
      });
    }
    const version = latest ? latest.version + 1 : 1;
    const created = await tx.seatingPlan.create({
      data: {
        examId,
        version,
        status: "DRAFT",
        supersedesPlanId: latest?.id ?? null,
        createdBy: createdBy ?? null,
      },
    });
    if (assignments.length > 0) {
      await tx.seatAssignment.createMany({
        data: assignments.map((a) => ({
          seatingPlanId: created.id,
          examCandidateId: a.candidateId,
          hallId: a.hallId,
          hallSeatId: a.hallSeatId,
        })),
      });
    }
    return created;
  });

  await completeSolve(
    input.jobId,
    {
      solverStatus,
      assignedCount,
      unassignedCount,
      solverDurationMs: Math.round(result.timings.solveMs),
    },
    createdBy,
  );

  return {
    seatingPlanId: plan.id,
    version: plan.version,
    assignedCount,
    unassignedCount,
    solverStatus,
  };
}

/** Terminal failure path — the generation never publishes anything. */
export async function failGenerationPersistence(
  input: PersistGenerationInput,
): Promise<void> {
  await failSolve(
    input.jobId,
    {
      errorCode: input.result.error?.code ?? "ERR_GENERATION_FAILED",
      errorMessage: input.result.error?.message ?? "seating generation failed",
    },
    input.createdBy,
  );
}

export async function markGenerationInfeasible(
  input: PersistGenerationInput,
): Promise<void> {
  await markInfeasible(
    input.jobId,
    {
      infeasibilityReason:
        input.result.error?.message ?? "no feasible seating arrangement",
    },
    input.createdBy,
  );
}

export function collectAssignments(result: GenerationResult): DomainAssignment[] {
  const assignments: DomainAssignment[] = [];
  for (const record of result.domains) {
    if (record.state !== "COMPLETED" || !record.result) continue;
    assignments.push(...record.result.assignments);
  }
  return assignments;
}

const SEATING_PLAN_INCLUDE = {
  assignments: {
    include: {
      examCandidate: {
        select: {
          id: true,
          registerNumberSnapshot: true,
          studentNameSnapshot: true,
          departmentSnapshot: true,
          classSnapshot: true,
          subjectCode: true,
        },
      },
      hall: { select: { id: true, hallNumber: true, rows: true, columns: true } },
      hallSeat: { select: { id: true, seatPosition: true, row: true, column: true } },
    },
    orderBy: [
      { hall: { hallNumber: "asc" as const } },
      { hallSeat: { row: "asc" as const } },
      { hallSeat: { column: "asc" as const } },
    ],
  },
} satisfies Prisma.SeatingPlanInclude;

export async function getSeatingPlanForExam(examId: string) {
  const plan = await prisma.seatingPlan.findFirst({
    where: { examId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
    include: SEATING_PLAN_INCLUDE,
  });
  if (!plan) throw new SeatingError("No PUBLISHED seating plan for exam", "PLAN_NOT_FOUND");
  return plan;
}

export async function getSeatingPlanById(planId: string) {
  const plan = await prisma.seatingPlan.findUnique({
    where: { id: planId },
    include: SEATING_PLAN_INCLUDE,
  });
  if (!plan) throw new SeatingError("SeatingPlan not found", "PLAN_NOT_FOUND");
  return plan;
}