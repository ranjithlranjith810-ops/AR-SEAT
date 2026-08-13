import { prisma } from "../../db.js";
import {
  CandidateValidationOutcome,
  NormalizedCandidate,
  ValidationIssue,
} from "./types";

export interface StudentReference {
  id: string;
  name: string;
  registerNumber: string;
  status: string;
}

export interface ValidateInput {
  rowIndex: number;
  pageNumber: number;
  registerNumber: string;
  name: string;
  student: StudentReference | null;
}

export function validateCandidate(input: ValidateInput): CandidateValidationOutcome {
  const issues: ValidationIssue[] = [];
  const registerNumber = input.registerNumber.trim();
  const name = input.name.trim();

  if (!registerNumber) issues.push({ code: "MISSING_REGISTER_NUMBER" });
  if (!name) issues.push({ code: "MISSING_NAME" });
  if (registerNumber && !/^[A-Za-z0-9-]+$/.test(registerNumber)) {
    issues.push({ code: "INVALID_REGISTER_NUMBER", detail: registerNumber });
  }

  const student = input.student;
  let studentId: string | undefined;
  if (!student) {
    issues.push({ code: "STUDENT_NOT_FOUND" });
  } else {
    studentId = student.id;
    if (student.registerNumber !== registerNumber) {
      issues.push({ code: "NAME_MISMATCH", detail: "register number differs from student master" });
    } else if (name && normalizeNameKey(student.name) !== normalizeNameKey(name)) {
      issues.push({ code: "NAME_MISMATCH", detail: `"${student.name}" <> "${name}"` });
    }
    if (student.status !== "ACTIVE") {
      issues.push({ code: "STUDENT_INACTIVE", detail: student.status });
    }
  }

  const blocking = hasBlockingIssue(issues);
  return {
    rowIndex: input.rowIndex,
    registerNumber,
    name,
    status: blocking ? "REJECTED" : "MATCHED",
    studentId,
    issues,
    blocking,
  };
}

export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return issues.some(
    (issue) =>
      issue.code === "MISSING_REGISTER_NUMBER" ||
      issue.code === "MISSING_NAME" ||
      issue.code === "INVALID_REGISTER_NUMBER" ||
      issue.code === "STUDENT_NOT_FOUND",
  );
}

export async function lookupStudents(
  registerNumbers: string[],
): Promise<Map<string, StudentReference>> {
  const unique = [...new Set(registerNumbers)];
  if (unique.length === 0) return new Map();
  const students = await prisma.student.findMany({
    where: { registerNumber: { in: unique } },
    select: { id: true, name: true, registerNumber: true, status: true },
  });
  return new Map(students.map((s) => [s.registerNumber, s]));
}

export function normalizeNameKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/\s+/g, "");
}

export function dedupeCandidates(
  candidates: CandidateValidationOutcome[],
): CandidateValidationOutcome[] {
  const byRegister = new Map<string, CandidateValidationOutcome>();
  const results: CandidateValidationOutcome[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.rowIndex - b.rowIndex)) {
    const existing = byRegister.get(candidate.registerNumber);
    if (!existing) {
      byRegister.set(candidate.registerNumber, candidate);
      results.push(candidate);
    } else {
      if (candidate.registerNumber) {
        existing.issues.push({
          code: "DUPLICATE_IN_DOCUMENT",
          detail: `duplicate register number at row ${candidate.rowIndex}`,
        });
      }
      existing.blocking = true;
      existing.status = "REJECTED";
    }
  }
  return results;
}

export function normalizeInput(
  rows: NormalizedCandidate[],
  studentLookup: Map<string, StudentReference>,
): CandidateValidationOutcome[] {
  const outcomes = rows.map((row) =>
    validateCandidate({
      rowIndex: row.rowIndex,
      pageNumber: row.pageNumber,
      registerNumber: row.registerNumber,
      name: row.name,
      student: studentLookup.get(row.registerNumber) ?? null,
    }),
  );
  return dedupeCandidates(outcomes);
}