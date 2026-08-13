import { SolveJobStatus, SolverStatus } from "@prisma/client";
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "./audit.service";

const JOB_TRANSITIONS: Record<SolveJobStatus, SolveJobStatus[]> = {
  QUEUED: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["SUCCEEDED", "INFEASIBLE", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  INFEASIBLE: [],
  FAILED: [],
  CANCELLED: [],
};

export function assertJobTransition(from: SolveJobStatus, to: SolveJobStatus): void {
  if (!JOB_TRANSITIONS[from].includes(to)) {
    throw new SeatingError(
      `Invalid solve job status transition: ${from} -> ${to}`,
      "INVALID_JOB_STATUS_TRANSITION",
    );
  }
}

export async function getJob(id: string) {
  const job = await prisma.solveJob.findUnique({ where: { id } });
  if (!job) throw new SeatingError("SolveJob not found", "JOB_NOT_FOUND");
  return job;
}

export interface RequestSolveInput {
  examId: string;
  requestedBy?: string;
  timeLimitSeconds?: number;
}

export async function requestSolve(input: RequestSolveInput) {
  const existing = await prisma.solveJob.findFirst({
    where: {
      examId: input.examId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { job: existing, created: false };
  }

  const candidateCount = await prisma.examCandidate.count({
    where: { examId: input.examId, validationStatus: "VALIDATED" },
  });

  const halls = await prisma.hall.findMany({
    where: { isActive: true },
    select: {
      id: true,
      seats: { where: { isActive: true }, select: { id: true } },
    },
  });
  const hallCount = halls.filter((h) => h.seats.length > 0).length;

  const job = await prisma.solveJob.create({
    data: {
      examId: input.examId,
      status: "QUEUED",
      requestedBy: input.requestedBy ?? null,
      timeLimitSeconds: input.timeLimitSeconds ?? null,
      candidateCount,
      hallCount,
    },
  });
  await logAudit({
    action: "SOLVE_REQUESTED",
    entityType: "SolveJob",
    entityId: job.id,
    actorId: input.requestedBy,
  });
  return { job, created: true };
}

export async function startSolve(jobId: string, actorId?: string) {
  const job = await getJob(jobId);
  assertJobTransition(job.status, "RUNNING");
  const now = new Date();
  const updated = await prisma.solveJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: now, heartbeatAt: now },
  });
  await logAudit({
    action: "SOLVE_STARTED",
    entityType: "SolveJob",
    entityId: jobId,
    actorId,
  });
  return updated;
}

export async function heartbeat(jobId: string) {
  const job = await getJob(jobId);
  if (job.status !== "RUNNING") {
    throw new SeatingError(
      "Only a RUNNING solve job can send a heartbeat",
      "JOB_NOT_RUNNING",
    );
  }
  return prisma.solveJob.update({ where: { id: jobId }, data: { heartbeatAt: new Date() } });
}

export interface CompleteSolveInput {
  solverStatus: SolverStatus;
  assignedCount: number;
  unassignedCount: number;
  solverDurationMs?: number;
}

export async function completeSolve(jobId: string, input: CompleteSolveInput, actorId?: string) {
  const job = await getJob(jobId);
  assertJobTransition(job.status, "SUCCEEDED");
  if (input.solverStatus !== "OPTIMAL" && input.solverStatus !== "FEASIBLE") {
    throw new SeatingError(
      "A SUCCEEDED job must carry an OPTIMAL or FEASIBLE solver status",
      "INVALID_SOLVER_STATUS",
    );
  }
  const updated = await prisma.solveJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      solverStatus: input.solverStatus,
      assignedCount: input.assignedCount,
      unassignedCount: input.unassignedCount,
      solverDurationMs: input.solverDurationMs ?? null,
      completedAt: new Date(),
    },
  });
  await logAudit({
    action: "SOLVE_COMPLETED",
    entityType: "SolveJob",
    entityId: jobId,
    actorId,
    metadata: { solverStatus: input.solverStatus },
  });
  return updated;
}

export interface InfeasibleSolveInput {
  infeasibilityReason: string;
  assignedCount?: number;
  unassignedCount?: number;
}

export async function markInfeasible(jobId: string, input: InfeasibleSolveInput, actorId?: string) {
  const job = await getJob(jobId);
  assertJobTransition(job.status, "INFEASIBLE");
  const updated = await prisma.solveJob.update({
    where: { id: jobId },
    data: {
      status: "INFEASIBLE",
      solverStatus: "INFEASIBLE",
      infeasibilityReason: input.infeasibilityReason,
      assignedCount: input.assignedCount ?? 0,
      unassignedCount: input.unassignedCount ?? 0,
      completedAt: new Date(),
    },
  });
  await logAudit({
    action: "SOLVE_COMPLETED",
    entityType: "SolveJob",
    entityId: jobId,
    actorId,
    metadata: { result: "INFEASIBLE" },
  });
  return updated;
}

export interface FailSolveInput {
  errorCode: string;
  errorMessage: string;
}

export async function failSolve(jobId: string, input: FailSolveInput, actorId?: string) {
  const job = await getJob(jobId);
  assertJobTransition(job.status, "FAILED");
  const updated = await prisma.solveJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      completedAt: new Date(),
    },
  });
  await logAudit({
    action: "SOLVE_FAILED",
    entityType: "SolveJob",
    entityId: jobId,
    actorId,
    metadata: { errorCode: input.errorCode },
  });
  return updated;
}

export async function cancelSolve(jobId: string, actorId?: string) {
  const job = await getJob(jobId);
  assertJobTransition(job.status, "CANCELLED");
  const updated = await prisma.solveJob.update({
    where: { id: jobId },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
  await logAudit({
    action: "SOLVE_FAILED",
    entityType: "SolveJob",
    entityId: jobId,
    actorId,
    metadata: { reason: "cancelled" },
  });
  return updated;
}

export async function reapStaleJobs(now: Date = new Date(), maxAgeMs = 60_000) {
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const stale = await prisma.solveJob.findMany({
    where: {
      status: "RUNNING",
      OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null }],
    },
  });
  const reapedIds: string[] = [];
  for (const job of stale) {
    await prisma.solveJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: "WORKER_TIMEOUT",
        errorMessage: "Worker heartbeat exceeded the configured timeout",
        completedAt: now,
      },
    });
    await logAudit({
      action: "SOLVE_FAILED",
      entityType: "SolveJob",
      entityId: job.id,
      metadata: { errorCode: "WORKER_TIMEOUT" },
    });
    reapedIds.push(job.id);
  }
  return reapedIds;
}