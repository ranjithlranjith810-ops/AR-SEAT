/**
 * Phase 19 — manual candidate roster management and exam cancellation.
 *
 * Manual candidate add/exclude/reinstate operate only on the Student Master
 * (add), carry an explicit audit reason (exclude), and are blocked once the
 * exam leaves the mutable window (APPROVED / PUBLISHED / CANCELLED). Exam
 * cancellation is guarded against active generations and preserves published
 * history.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import {
  addCandidateFromMaster,
  excludeCandidate,
  reinstateCandidate,
  transitionValidationStatus,
} from "../src/services/candidate.service";
import { cancelExam } from "../src/services/exam.service";
import { buildSolverCandidateList } from "../src/services/solverInput.service";
import {
  createTestCandidate,
  createTestExam,
  createTestStudent,
  createValidatedCandidate,
  seededClass,
} from "./fixtures";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";

async function setExamStatus(examId: string, status: string) {
  await prisma.exam.update({ where: { id: examId }, data: { status: status as never } });
}

describe("addCandidateFromMaster (Phase 19)", () => {
  it("creates a MATCHED candidate with master-sourced snapshots and an audit entry", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "ADD");
    const exam = await createTestExam();

    const candidate = await addCandidateFromMaster(
      { examId: exam.id, studentId: student.id, reason: "Missing from timetable PDF" },
      "test-actor",
    );

    expect(candidate).toMatchObject({
      examId: exam.id,
      studentId: student.id,
      sourceDocumentId: null,
      registerNumberSnapshot: student.registerNumber,
      studentNameSnapshot: student.name,
      departmentSnapshot: cls.department.code,
      genderSnapshot: student.gender,
      classSnapshot: cls.name,
      validationStatus: "MATCHED",
    });
    expect(candidate.subjectCode).toBe("MANUAL");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "EXAM_CANDIDATE_ADDED", entityId: candidate.id },
    });
    expect(audit).toBeDefined();
    const meta = audit!.metadata as { reason: string; studentId: string };
    expect(meta.reason).toBe("Missing from timetable PDF");
    expect(meta.studentId).toBe(student.id);
  });

  it("rejects the same student twice within one exam", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "ADD2");
    const exam = await createTestExam();
    await addCandidateFromMaster({ examId: exam.id, studentId: student.id }, "test-actor");
    await expect(
      addCandidateFromMaster({ examId: exam.id, studentId: student.id }, "test-actor"),
    ).rejects.toMatchObject({ code: "STUDENT_ALREADY_CANDIDATE" });
  });

  it("rejects an unknown student id", async () => {
    const exam = await createTestExam();
    await expect(
      addCandidateFromMaster({ examId: exam.id, studentId: "nope" }, "test-actor"),
    ).rejects.toMatchObject({ code: "STUDENT_NOT_FOUND" });
  });

  it("blocks roster changes once the exam is APPROVED", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "ADD3");
    const exam = await createTestExam();
    await setExamStatus(exam.id, "APPROVED");
    await expect(
      addCandidateFromMaster({ examId: exam.id, studentId: student.id }, "test-actor"),
    ).rejects.toMatchObject({ code: "EXAM_NOT_MUTABLE" });
  });

  it("blocks roster changes on a CANCELLED exam", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "ADD4");
    const exam = await createTestExam();
    await setExamStatus(exam.id, "CANCELLED");
    await expect(
      addCandidateFromMaster({ examId: exam.id, studentId: student.id }, "test-actor"),
    ).rejects.toMatchObject({ code: "EXAM_NOT_MUTABLE" });
  });

  it("only reaches the solver input once the added candidate is validated", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "ADD5");
    const exam = await createTestExam();
    const candidate = await addCandidateFromMaster(
      { examId: exam.id, studentId: student.id },
      "test-actor",
    );

    expect(
      (await buildSolverCandidateList(exam.id)).some((c) => c.id === candidate.id),
    ).toBe(false);

    const validated = await transitionValidationStatus(candidate.id, "VALIDATED", "test-actor");
    expect(validated.validationStatus).toBe("VALIDATED");
    expect(
      (await buildSolverCandidateList(exam.id)).some((c) => c.id === candidate.id),
    ).toBe(true);
  });
});

describe("excludeCandidate / reinstateCandidate (Phase 19)", () => {
  it("excludes a validated candidate with an audit reason and previous status", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "EXC");
    const exam = await createTestExam();
    const candidate = await createValidatedCandidate(exam.id, student.id, "EXC-1");

    const excluded = await excludeCandidate(candidate.id, "sitting a conflicting exam", "test-actor");
    expect(excluded.validationStatus).toBe("REJECTED");
    expect(
      (await buildSolverCandidateList(exam.id)).some((c) => c.id === candidate.id),
    ).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "EXAM_CANDIDATE_EXCLUDED", entityId: candidate.id },
    });
    expect(audit).toBeDefined();
    const meta = audit!.metadata as { reason: string; previousStatus: string };
    expect(meta.reason).toBe("sitting a conflicting exam");
    expect(meta.previousStatus).toBe("VALIDATED");
  });

  it("requires a non-empty audit reason to exclude", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "EXC2");
    const exam = await createTestExam();
    const candidate = await createValidatedCandidate(exam.id, student.id, "EXC-2");
    await expect(excludeCandidate(candidate.id, "", "test-actor")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("blocks exclusion once the exam is APPROVED", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "EXC3");
    const exam = await createTestExam();
    const candidate = await createValidatedCandidate(exam.id, student.id, "EXC-3");
    await setExamStatus(exam.id, "APPROVED");
    await expect(
      excludeCandidate(candidate.id, "nope", "test-actor"),
    ).rejects.toMatchObject({ code: "EXAM_NOT_MUTABLE" });
  });

  it("rejects excluding an already-excluded candidate", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "EXC4");
    const exam = await createTestExam();
    const candidate = await createValidatedCandidate(exam.id, student.id, "EXC-4");
    await excludeCandidate(candidate.id, "first", "test-actor");
    await expect(
      excludeCandidate(candidate.id, "second", "test-actor"),
    ).rejects.toMatchObject({ code: "INVALID_VALIDATION_STATUS_TRANSITION" });
  });

  it("reinstates an excluded candidate back to MATCHED for re-validation", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "RIN");
    const exam = await createTestExam();
    const candidate = await createValidatedCandidate(exam.id, student.id, "RIN-1");
    await excludeCandidate(candidate.id, "mistaken exclusion", "test-actor");

    const reinstated = await reinstateCandidate(candidate.id, "exclusion was in error", "test-actor");
    expect(reinstated.validationStatus).toBe("MATCHED");
    expect(
      (await buildSolverCandidateList(exam.id)).some((c) => c.id === candidate.id),
    ).toBe(false);

    await transitionValidationStatus(candidate.id, "VALIDATED", "test-actor");
    expect(
      (await buildSolverCandidateList(exam.id)).some((c) => c.id === candidate.id),
    ).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "EXAM_CANDIDATE_REINSTATED", entityId: candidate.id },
    });
    expect(audit).toBeDefined();
  });

  it("rejects reinstating a candidate that was never excluded", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "RIN2");
    const exam = await createTestExam();
    const candidate = await createValidatedCandidate(exam.id, student.id, "RIN-2");
    await expect(reinstateCandidate(candidate.id, "nope", "test-actor")).rejects.toMatchObject({
      code: "INVALID_VALIDATION_STATUS_TRANSITION",
    });
  });
});

describe("cancelExam (Phase 19)", () => {
  it("cancels a DRAFT exam with an audit entry and reason", async () => {
    const exam = await createTestExam();
    const cancelled = await cancelExam(exam.id, "test-actor", "venue unavailable");
    expect(cancelled.status).toBe("CANCELLED");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "EXAM_CANCELLED", entityId: exam.id },
    });
    expect(audit).toBeDefined();
    expect((audit!.metadata as { reason: string }).reason).toBe("venue unavailable");
  });

  it("refuses to cancel a PUBLISHED exam", async () => {
    const exam = await createTestExam();
    await setExamStatus(exam.id, "PUBLISHED");
    await expect(cancelExam(exam.id, "test-actor")).rejects.toMatchObject({
      code: "INVALID_EXAM_STATUS_TRANSITION",
    });
  });

  it("refuses to cancel an exam while a generation is active", async () => {
    const exam = await createTestExam();
    await prisma.solveJob.create({
      data: { examId: exam.id, status: "QUEUED", candidateCount: 0, hallCount: 0 },
    });
    await expect(cancelExam(exam.id, "test-actor")).rejects.toMatchObject({
      code: "EXAM_CANCELLATION_BLOCKED_ACTIVE_GENERATION",
    });
  });

  it("is a no-op target for an unknown exam", async () => {
    await expect(cancelExam("missing-exam", "test-actor")).rejects.toMatchObject({
      code: "EXAM_NOT_FOUND",
    });
  });
});

const ADMIN_USERNAME = "phase19-cand-admin";
const ADMIN_PASSWORD = "phase19-cand-admin-password-1";
const STAFF_USERNAME = "phase19-cand-staff";
const STAFF_PASSWORD = "phase19-cand-staff-password-1";

let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;

const dispatch = (async () => {
  throw new Error("solver dispatch must never run behind candidate-management tests");
}) as unknown as SolverDispatch;

async function authedPost(
  path: string,
  token: string | null,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { Cookie: `ar_seat_session=${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("exam candidate management API (Phase 19)", () => {
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

  it("POST candidates requires ADMIN", async () => {
    const exam = await createTestExam();
    expect((await authedPost(`/exam-seating/exams/${exam.id}/candidates`, null)).status).toBe(401);
    expect((await authedPost(`/exam-seating/exams/${exam.id}/candidates`, staffToken)).status).toBe(403);
  });

  it("POST candidates adds a student from the master", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "API");
    const exam = await createTestExam();

    const res = await authedPost(
      `/exam-seating/exams/${exam.id}/candidates`,
      adminToken,
      { studentId: student.id, reason: "manual add" },
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<{ candidate: { id: string; validationStatus: string } }>(res);
    expect(body.candidate.validationStatus).toBe("MATCHED");
  });

  it("POST candidates -> 409 when the student is already a candidate", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "API2");
    const exam = await createTestExam();
    await createTestCandidate(exam.id, student.id, "API-2");

    const res = await authedPost(
      `/exam-seating/exams/${exam.id}/candidates`,
      adminToken,
      { studentId: student.id },
    );
    expect(res.status).toBe(409);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("STUDENT_ALREADY_CANDIDATE");
  });

  it("POST candidates -> 400 when studentId is missing", async () => {
    const exam = await createTestExam();
    const res = await authedPost(`/exam-seating/exams/${exam.id}/candidates`, adminToken, {});
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_INPUT");
  });

  it("POST candidates -> 409 when the exam roster is locked", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "API3");
    const exam = await createTestExam();
    await setExamStatus(exam.id, "APPROVED");
    const res = await authedPost(
      `/exam-seating/exams/${exam.id}/candidates`,
      adminToken,
      { studentId: student.id },
    );
    expect(res.status).toBe(409);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("EXAM_NOT_MUTABLE");
  });

  it("POST candidates -> 404 for an unknown student", async () => {
    const exam = await createTestExam();
    const res = await authedPost(
      `/exam-seating/exams/${exam.id}/candidates`,
      adminToken,
      { studentId: "nope" },
    );
    expect(res.status).toBe(404);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("STUDENT_NOT_FOUND");
  });

  it("POST exclude requires an audit reason (400)", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "API4");
    const exam = await createTestExam();
    const candidate = await createValidatedCandidate(exam.id, student.id, "API-4");

    const res = await authedPost(
      `/exam-seating/exams/${exam.id}/candidates/${candidate.id}/exclude`,
      adminToken,
      {},
    );
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_INPUT");
  });

  it("POST exclude and reinstate round-trip through the API", async () => {
    const cls = await seededClass();
    const student = await createTestStudent(cls.id, "API5");
    const exam = await createTestExam();
    const candidate = await createValidatedCandidate(exam.id, student.id, "API-5");

    const excluded = await authedPost(
      `/exam-seating/exams/${exam.id}/candidates/${candidate.id}/exclude`,
      adminToken,
      { reason: "conflicting exam" },
    );
    expect(excluded.status).toBe(200);
    expect((await jsonBody<{ candidate: { validationStatus: string } }>(excluded)).candidate.validationStatus).toBe("REJECTED");

    const reinstated = await authedPost(
      `/exam-seating/exams/${exam.id}/candidates/${candidate.id}/reinstate`,
      adminToken,
      { reason: "conflict resolved" },
    );
    expect(reinstated.status).toBe(200);
    expect((await jsonBody<{ candidate: { validationStatus: string } }>(reinstated)).candidate.validationStatus).toBe("MATCHED");
  });

  it("POST cancel transitions the exam to CANCELLED", async () => {
    const exam = await createTestExam();
    const res = await authedPost(
      `/exam-seating/exams/${exam.id}/cancel`,
      adminToken,
      { reason: "scheduling error" },
    );
    expect(res.status).toBe(200);
    expect((await jsonBody<{ exam: { status: string } }>(res)).exam.status).toBe("CANCELLED");
  });

  it("POST cancel -> 409 while a generation is active", async () => {
    const exam = await createTestExam();
    await prisma.solveJob.create({
      data: { examId: exam.id, status: "RUNNING", candidateCount: 0, hallCount: 0 },
    });
    const res = await authedPost(`/exam-seating/exams/${exam.id}/cancel`, adminToken, {});
    expect(res.status).toBe(409);
    expect((await jsonBody<{ error: string }>(res)).error).toBe(
      "EXAM_CANCELLATION_BLOCKED_ACTIVE_GENERATION",
    );
  });
});