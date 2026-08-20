import { ExamSession, ExamStatus, ExamType } from "@prisma/client";
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "./audit.service";

const ALLOWED_TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["GENERATING", "CANCELLED"],
  GENERATING: ["GENERATED", "CANCELLED"],
  GENERATED: ["APPROVED", "CANCELLED"],
  APPROVED: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: [],
  CANCELLED: [],
};

export interface CreateExamInput {
  examDate: Date;
  session: ExamSession;
  examType?: ExamType;
}

export function assertExamTransition(from: ExamStatus, to: ExamStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new SeatingError(
      `Invalid exam status transition: ${from} -> ${to}`,
      "INVALID_EXAM_STATUS_TRANSITION",
    );
  }
}

export async function createExam(input: CreateExamInput, actorId?: string) {
  const exam = await prisma.exam.create({
    data: {
      examDate: input.examDate,
      session: input.session,
      examType: input.examType ?? "UNIVERSITY",
      status: "DRAFT",
    },
  });
  await logAudit({
    action: "EXAM_CREATED",
    entityType: "Exam",
    entityId: exam.id,
    actorId,
  });
  return exam;
}

export async function getExam(id: string) {
  const exam = await prisma.exam.findUnique({ where: { id } });
  if (!exam) throw new SeatingError("Exam not found", "EXAM_NOT_FOUND");
  return exam;
}

export async function listExams() {
  return prisma.exam.findMany({ orderBy: { examDate: "desc" } });
}

export async function transitionExamStatus(
  id: string,
  to: ExamStatus,
  actorId?: string,
) {
  const exam = await getExam(id);
  assertExamTransition(exam.status, to);
  return prisma.exam.update({ where: { id }, data: { status: to } });
}

export async function cancelExam(id: string, actorId?: string, reason?: string) {
  const exam = await getExam(id);
  assertExamTransition(exam.status, "CANCELLED");

  const activeJob = await prisma.solveJob.count({
    where: { examId: id, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (activeJob > 0) {
    throw new SeatingError(
      "Cannot cancel the exam while a seating generation is in progress",
      "EXAM_CANCELLATION_BLOCKED_ACTIVE_GENERATION",
    );
  }

  const updated = await prisma.exam.update({ where: { id }, data: { status: "CANCELLED" } });
  await logAudit({
    action: "EXAM_CANCELLED",
    entityType: "Exam",
    entityId: id,
    actorId,
    metadata: reason ? { reason } : undefined,
  });
  return updated;
}

export async function assertExamCandidatesMutable(examId: string) {
  const exam = await getExam(examId);
  if (
    exam.status === "GENERATING" ||
    exam.status === "APPROVED" ||
    exam.status === "PUBLISHED" ||
    exam.status === "CANCELLED"
  ) {
    throw new SeatingError(
      `Exam candidate roster is locked: the exam is ${exam.status}`,
      "EXAM_NOT_MUTABLE",
    );
  }
  return exam;
}