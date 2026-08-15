/**
 * Phase 4 — ingestion reconciliation + session identity (§6, §7, §14).
 *
 * Before ANY solver dispatch the orchestration layer reconciles the parsed
 * candidates against the authoritative DB. The pipeline must NEVER silently
 * drop a candidate: if any candidate in the exam/session is not VALIDATED, or
 * two candidates share one register number, the generation STOPS with
 * ERR_CANDIDATE_RECONCILIATION and the evidence (register number, parsed
 * value, DB value, reason) is returned. One Exam row is one session boundary
 * (examDate + session), so a generation scoped to examId can never mix time
 * slots.
 */
import { prisma } from "../db";
import { SeatingError } from "../errors";
import type { GenerationSession } from "./types";

export const ERR_CANDIDATE_RECONCILIATION = "ERR_CANDIDATE_RECONCILIATION";

export interface ReconciliationIssue {
  candidateId: string;
  /** Register number as stored on the candidate (the parsed/snapshot value). */
  registerNumber: string;
  /** Authoritative student-master value (or null when no student matched). */
  dbValue: string | null;
  reason: string;
}

export interface ReconciliationResult {
  session: GenerationSession;
  candidateCount: number;
  validatedCount: number;
  nonValidated: ReconciliationIssue[];
  duplicateRegisterNumbers: string[];
  ok: boolean;
}

export async function reconcileExamForGeneration(
  examId: string,
): Promise<ReconciliationResult> {
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw new SeatingError("Exam not found", "EXAM_NOT_FOUND");

  const candidates = await prisma.examCandidate.findMany({
    where: { examId },
    orderBy: { registerNumberSnapshot: "asc" },
    select: {
      id: true,
      registerNumberSnapshot: true,
      validationStatus: true,
      studentId: true,
    },
  });

  const studentIds = candidates.map((c) => c.studentId);
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, registerNumber: true },
  });
  const studentRegisterByStudentId = new Map(
    students.map((s) => [s.id, s.registerNumber]),
  );

  const nonValidated: ReconciliationIssue[] = [];
  for (const candidate of candidates) {
    const dbValue = studentRegisterByStudentId.get(candidate.studentId) ?? null;
    if (candidate.validationStatus !== "VALIDATED") {
      nonValidated.push({
        candidateId: candidate.id,
        registerNumber: candidate.registerNumberSnapshot,
        dbValue,
        reason: `validationStatus=${candidate.validationStatus}`,
      });
    } else if (dbValue !== null && dbValue !== candidate.registerNumberSnapshot) {
      // Parsed (snapshot) value diverges from the authoritative student master.
      nonValidated.push({
        candidateId: candidate.id,
        registerNumber: candidate.registerNumberSnapshot,
        dbValue,
        reason: `registerNumberSnapshot=${candidate.registerNumberSnapshot} != student.registerNumber=${dbValue}`,
      });
    }
  }

  const seen = new Map<string, string>();
  const duplicateRegisterNumbers: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.registerNumberSnapshot;
    const existing = seen.get(key);
    if (existing !== undefined) {
      duplicateRegisterNumbers.push(key);
    } else {
      seen.set(key, candidate.id);
    }
  }

  return {
    session: {
      examId: exam.id,
      examDate: exam.examDate.toISOString(),
      timeSlot: exam.session,
    },
    candidateCount: candidates.length,
    validatedCount: candidates.length - nonValidated.length,
    nonValidated,
    duplicateRegisterNumbers: [...new Set(duplicateRegisterNumbers)],
    ok: nonValidated.length === 0 && duplicateRegisterNumbers.length === 0,
  };
}

export function describeReconciliation(
  result: ReconciliationResult,
): string {
  const parts: string[] = [];
  for (const issue of result.nonValidated) {
    parts.push(
      `${issue.registerNumber}: parsed/snapshot=${issue.registerNumber}, db=${issue.dbValue ?? "<none>"}, reason=${issue.reason}`,
    );
  }
  for (const reg of result.duplicateRegisterNumbers) {
    parts.push(`duplicate register number in session: ${reg}`);
  }
  return (
    `${result.validatedCount}/${result.candidateCount} candidates validated. ` +
    (parts.length ? parts.join("; ") : "")
  );
}