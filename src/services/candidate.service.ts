import { CandidateValidationStatus } from "@prisma/client";
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "./audit.service";

export interface CreateCandidateInput {
  examId: string;
  studentId: string;
  subjectCode: string;
  subjectName: string;
  sourceDocumentId?: string;
  registerNumberSnapshot?: string;
}

export const SNAPSHOT_FIELDS = [
  "registerNumberSnapshot",
  "studentNameSnapshot",
  "departmentSnapshot",
  "classSnapshot",
  "genderSnapshot",
] as const;

const VALIDATION_TRANSITIONS: Record<
  CandidateValidationStatus,
  CandidateValidationStatus[]
> = {
  UNVERIFIED: ["MATCHED", "REJECTED"],
  MATCHED: ["VALIDATED", "REJECTED"],
  VALIDATED: ["REJECTED"],
  REJECTED: [],
};

export function assertValidationTransition(
  from: CandidateValidationStatus,
  to: CandidateValidationStatus,
): void {
  if (!VALIDATION_TRANSITIONS[from].includes(to)) {
    throw new SeatingError(
      `Invalid validation status transition: ${from} -> ${to}`,
      "INVALID_VALIDATION_STATUS_TRANSITION",
    );
  }
}

export async function createCandidate(input: CreateCandidateInput, actorId?: string) {
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    include: { class: { include: { department: true } } },
  });
  if (!student) throw new SeatingError("Student not found", "STUDENT_NOT_FOUND");

  const candidate = await prisma.examCandidate.create({
    data: {
      examId: input.examId,
      studentId: input.studentId,
      sourceDocumentId: input.sourceDocumentId,
      registerNumberSnapshot: input.registerNumberSnapshot ?? student.registerNumber,
      studentNameSnapshot: student.name,
      departmentSnapshot: student.class.department.code,
      genderSnapshot: student.gender,
      classSnapshot: student.class.name,
      subjectCode: input.subjectCode,
      subjectName: input.subjectName,
      validationStatus: "UNVERIFIED",
    },
  });
  await logAudit({
    action: "CANDIDATE_MATCHED",
    entityType: "ExamCandidate",
    entityId: candidate.id,
    actorId,
    metadata: { registerNumberSnapshot: candidate.registerNumberSnapshot },
  });
  return candidate;
}

export async function getCandidate(id: string) {
  const candidate = await prisma.examCandidate.findUnique({ where: { id } });
  if (!candidate) throw new SeatingError("ExamCandidate not found", "CANDIDATE_NOT_FOUND");
  return candidate;
}

export async function transitionValidationStatus(
  id: string,
  to: CandidateValidationStatus,
  actorId?: string,
) {
  const candidate = await getCandidate(id);
  assertValidationTransition(candidate.validationStatus, to);
  const updated = await prisma.examCandidate.update({
    where: { id },
    data: { validationStatus: to },
  });
  await logAudit({
    action: "CANDIDATE_RESOLVED",
    entityType: "ExamCandidate",
    entityId: id,
    actorId,
    metadata: { validationStatus: to },
  });
  return updated;
}

export async function assertSnapshotMutable(candidateId: string): Promise<void> {
  const publishedAssignments = await prisma.seatAssignment.count({
    where: {
      examCandidateId: candidateId,
      seatingPlan: { status: "PUBLISHED" },
    },
  });
  if (publishedAssignments > 0) {
    throw new SeatingError(
      "Candidate snapshot is immutable: the candidate is part of a PUBLISHED seating plan. Create a new plan version instead of rewriting history.",
      "SNAPSHOT_LOCKED",
    );
  }
}

type CandidateSnapshotUpdate = {
  registerNumberSnapshot?: string;
  studentNameSnapshot?: string;
  departmentSnapshot?: string;
  classSnapshot?: string;
  genderSnapshot?: "MALE" | "FEMALE" | "OTHER";
};

export async function updateCandidateSnapshot(id: string, patch: CandidateSnapshotUpdate) {
  await getCandidate(id);
  const touchesSnapshot = SNAPSHOT_FIELDS.some((field) => patch[field] !== undefined);
  if (touchesSnapshot) {
    await assertSnapshotMutable(id);
  }
  return prisma.examCandidate.update({ where: { id }, data: patch });
}