import { prisma } from "../db";
import { getExam } from "./exam.service";

export interface ExamConflictCandidateRef {
  candidateId: string;
  examId: string;
  status: string;
  subjectCode: string;
  subjectName: string;
  validationStatus: string;
}

export interface ExamConflict {
  studentId: string;
  registerNumber: string;
  studentName: string;
  candidate: ExamConflictCandidateRef;
  conflictingExams: ExamConflictCandidateRef[];
}

export interface ExamConflictReport {
  examId: string;
  examDate: Date;
  session: string;
  conflicts: ExamConflict[];
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

/**
 * Pre-flight schedule collision detector.
 *
 * A conflict exists when a student has a non-excluded candidate record
 * (validationStatus != REJECTED) in two or more distinct exams scheduled on the
 * same calendar day in the same session window. Runs entirely at the application
 * domain layer; the solver contract is untouched.
 */
export async function checkExamConflicts(examId: string): Promise<ExamConflictReport> {
  const exam = await getExam(examId);

  const candidates = await prisma.examCandidate.findMany({
    where: {
      studentId: {
        in: await rosterStudentIds(examId),
      },
      validationStatus: { not: "REJECTED" },
      exam: {
        examDate: { gte: startOfUtcDay(exam.examDate), lte: endOfUtcDay(exam.examDate) },
        session: exam.session,
      },
    },
    select: {
      id: true,
      studentId: true,
      registerNumberSnapshot: true,
      subjectCode: true,
      subjectName: true,
      validationStatus: true,
      student: { select: { id: true, name: true, registerNumber: true } },
      exam: { select: { id: true, status: true } },
    },
    orderBy: { registerNumberSnapshot: "asc" },
  });

  const ownByStudent = new Map<string, (typeof candidates)[number]>();
  const peersByStudent = new Map<string, (typeof candidates)[number][]>();
  for (const candidate of candidates) {
    if (candidate.exam.id === examId) {
      ownByStudent.set(candidate.studentId, candidate);
    } else {
      const list = peersByStudent.get(candidate.studentId) ?? [];
      list.push(candidate);
      peersByStudent.set(candidate.studentId, list);
    }
  }

  const conflicts: ExamConflict[] = [];
  for (const [studentId, peers] of peersByStudent) {
    const own = ownByStudent.get(studentId);
    if (!own) continue;
    const toRef = (c: (typeof candidates)[number]): ExamConflictCandidateRef => ({
      candidateId: c.id,
      examId: c.exam.id,
      status: c.exam.status,
      subjectCode: c.subjectCode,
      subjectName: c.subjectName,
      validationStatus: c.validationStatus,
    });
    conflicts.push({
      studentId,
      registerNumber: own.student.registerNumber,
      studentName: own.student.name,
      candidate: toRef(own),
      conflictingExams: peers.map(toRef),
    });
  }

  conflicts.sort((a, b) => a.registerNumber.localeCompare(b.registerNumber));
  return { examId, examDate: exam.examDate, session: exam.session, conflicts };
}

async function rosterStudentIds(examId: string): Promise<string[]> {
  const rows = await prisma.examCandidate.findMany({
    where: { examId, validationStatus: { not: "REJECTED" } },
    select: { studentId: true },
  });
  return [...new Set(rows.map((row) => row.studentId))];
}