/**
 * Phase 19 — schedule conflict detection.
 *
 * A conflict exists when a student has a non-excluded candidate record
 * (validationStatus != REJECTED) in two or more distinct exams scheduled on the
 * same calendar day in the same session window. Detection runs entirely at the
 * application domain layer; the solver contract is untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import { createExam } from "../src/services/exam.service";
import { checkExamConflicts, type ExamConflictReport } from "../src/services/conflict.service";
import { excludeCandidate } from "../src/services/candidate.service";
import {
  createTestCandidate,
  createTestExam,
  createTestStudent,
  seededClass,
} from "./fixtures";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";

async function twoExams() {
  const exam1 = await createTestExam();
  const exam2 = await createTestExam();
  return { exam1, exam2 };
}

describe("checkExamConflicts (Phase 19)", () => {
  it("returns an empty report for an exam without candidates", async () => {
    const exam = await createTestExam();
    const report = await checkExamConflicts(exam.id);
    expect(report.examId).toBe(exam.id);
    expect(report.conflicts).toEqual([]);
  });

  it("flags a student scheduled in two exams on the same date and session", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "CF");
    const { exam1, exam2 } = await twoExams();
    await createTestCandidate(exam1.id, student.id, "CF-1");
    await createTestCandidate(exam2.id, student.id, "CF-2");

    const report = await checkExamConflicts(exam1.id);
    expect(report.conflicts).toHaveLength(1);
    const conflict = report.conflicts[0]!;
    expect(conflict.studentId).toBe(student.id);
    expect(conflict.registerNumber).toBe(student.registerNumber);
    expect(conflict.candidate.examId).toBe(exam1.id);
    expect(conflict.conflictingExams.map((e) => e.examId)).toEqual([exam2.id]);
    expect(conflict.conflictingExams[0]!.validationStatus).toBe("UNVERIFIED");
  });

  it("reports the conflict symmetrically from either exam", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "CS");
    const { exam1, exam2 } = await twoExams();
    await createTestCandidate(exam1.id, student.id, "CS-1");
    await createTestCandidate(exam2.id, student.id, "CS-2");

    const fromExam1 = await checkExamConflicts(exam1.id);
    const fromExam2 = await checkExamConflicts(exam2.id);
    expect(fromExam1.conflicts).toHaveLength(1);
    expect(fromExam2.conflicts).toHaveLength(1);
    expect(fromExam1.conflicts[0]!.conflictingExams[0]!.examId).toBe(exam2.id);
    expect(fromExam2.conflicts[0]!.conflictingExams[0]!.examId).toBe(exam1.id);
  });

  it("does not flag a student present in only one exam", async () => {
    const cls = await seededClass();
    const s1 = await createTestStudent(cls.id, "CG");
    const s2 = await createTestStudent(cls.id, "CH");
    const { exam1, exam2 } = await twoExams();
    await createTestCandidate(exam1.id, s1.id, "CG-1");
    await createTestCandidate(exam2.id, s1.id, "CG-2");
    await createTestCandidate(exam1.id, s2.id, "CH-1");

    const report = await checkExamConflicts(exam1.id);
    expect(report.conflicts.map((c) => c.studentId)).toEqual([s1.id]);
  });

  it("ignores candidates excluded (REJECTED) on either side", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "CI");
    const { exam1, exam2 } = await twoExams();
    const c1 = await createTestCandidate(exam1.id, student.id, "CI-1");
    const c2 = await createTestCandidate(exam2.id, student.id, "CI-2");

    await excludeCandidate(c2.id, "already seated elsewhere", "test-actor");
    expect((await checkExamConflicts(exam1.id)).conflicts).toEqual([]);

    await excludeCandidate(c1.id, "absent on exam day", "test-actor");
    expect((await checkExamConflicts(exam1.id)).conflicts).toEqual([]);
  });

  it("does not flag exams on a different day or session", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "CJ");
    const examFN = await createTestExam();
    const examAN = await createExam(
      { examDate: new Date("2026-05-20T09:30:00Z"), session: "AN" },
      "test-actor",
    );
    const examOtherDay = await createExam(
      { examDate: new Date("2026-05-21T09:30:00Z"), session: "FN" },
      "test-actor",
    );
    await createTestCandidate(examFN.id, student.id, "CJ-FN");
    await createTestCandidate(examAN.id, student.id, "CJ-AN");
    await createTestCandidate(examOtherDay.id, student.id, "CJ-OD");

    const report = await checkExamConflicts(examFN.id);
    expect(report.conflicts).toEqual([]);
  });

  it("treats same-day exams at different clock times as conflicting", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "CK");
    const examMorning = await createExam(
      { examDate: new Date("2026-06-10T09:30:00Z"), session: "FN" },
      "test-actor",
    );
    const examAfternoon = await createExam(
      { examDate: new Date("2026-06-10T14:00:00Z"), session: "FN" },
      "test-actor",
    );
    await createTestCandidate(examMorning.id, student.id, "CK-M");
    await createTestCandidate(examAfternoon.id, student.id, "CK-A");

    const report = await checkExamConflicts(examMorning.id);
    expect(report.conflicts.map((c) => c.studentId)).toEqual([student.id]);
  });

  it("groups conflicts by student and orders by register number", async () => {
    const cls = await seededClass();
    const sLow = await createTestStudent(cls.id, "LOW");
    const sHigh = await createTestStudent(cls.id, "HIG");
    const { exam1, exam2 } = await twoExams();
    await createTestCandidate(exam1.id, sLow.id, "LOW-1");
    await createTestCandidate(exam2.id, sLow.id, "LOW-2");
    await createTestCandidate(exam1.id, sHigh.id, "HIG-1");
    await createTestCandidate(exam2.id, sHigh.id, "HIG-2");

    const report = await checkExamConflicts(exam1.id);
    expect(report.conflicts).toHaveLength(2);
    const regs = report.conflicts.map((c) => c.registerNumber);
    expect([...regs].sort()).toEqual(regs);
  });
});

const ADMIN_USERNAME = "phase19-conflict-admin";
const ADMIN_PASSWORD = "phase19-conflict-admin-password-1";
const STAFF_USERNAME = "phase19-conflict-staff";
const STAFF_PASSWORD = "phase19-conflict-staff-password-1";

let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;

const dispatch = (async () => {
  throw new Error("solver dispatch must never run behind conflict tests");
}) as unknown as SolverDispatch;

async function authedGet(path: string, token: string | null): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { Cookie: `ar_seat_session=${token}` } : {},
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("GET /exam-seating/exams/:id/conflicts (Phase 19 API)", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    const staff = await createUser({ username: STAFF_USERNAME, password: STAFF_PASSWORD, role: "STAFF" });
    adminToken = (await createSession(admin.id)).token;
    staffToken = (await createSession(staff.id)).token;

    const registry = new Map<string, GenerationResult>();
    server = createPhase4Server({ registry, dispatch });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("unauthenticated -> 401 UNAUTHORIZED", async () => {
    const res = await authedGet("/exam-seating/exams/some-id/conflicts", null);
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("STAFF -> 403 FORBIDDEN", async () => {
    const res = await authedGet("/exam-seating/exams/some-id/conflicts", staffToken);
    expect(res.status).toBe(403);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("FORBIDDEN");
  });

  it("ADMIN -> 200 conflict report and EXAM_CONFLICT_CHECKED audit entry", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "CA");
    const { exam1, exam2 } = await twoExams();
    await createTestCandidate(exam1.id, student.id, "CA-1");
    await createTestCandidate(exam2.id, student.id, "CA-2");

    const res = await authedGet(`/exam-seating/exams/${exam1.id}/conflicts`, adminToken);
    expect(res.status).toBe(200);
    const body = await jsonBody<ExamConflictReport & { conflicts: unknown[] }>(res);
    expect(body.examId).toBe(exam1.id);
    expect(body.conflicts).toHaveLength(1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "EXAM_CONFLICT_CHECKED", entityId: exam1.id },
    });
    expect(audit).toBeDefined();
    expect(audit!.actorId).toBeDefined();
    expect((audit!.metadata as { conflictCount: number }).conflictCount).toBe(1);
  });

  it("ADMIN -> 404 EXAM_NOT_FOUND for an unknown exam", async () => {
    const res = await authedGet("/exam-seating/exams/does-not-exist/conflicts", adminToken);
    expect(res.status).toBe(404);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("EXAM_NOT_FOUND");
  });
});