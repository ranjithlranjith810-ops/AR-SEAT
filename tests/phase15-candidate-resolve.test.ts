/**
 * Phase 15 — candidate reconciliation surface (MATCHED -> VALIDATED).
 *
 * POST /exam-seating/documents/:documentId/candidates/:candidateId/resolve is
 * an ADMIN-only transition that reuses transitionValidationStatus() and its
 * single CANDIDATE_RESOLVED audit event. STAFF is denied; unknown candidates
 * and cross-document candidates return intentional 404 CANDIDATE_NOT_FOUND;
 * illegal/repeated transitions return 409
 * INVALID_VALIDATION_STATUS_TRANSITION. All intentional bodies are sanitized.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import { createExam } from "../src/services/exam.service";
import {
  createCandidate,
  transitionValidationStatus,
} from "../src/services/candidate.service";
import { createTestStudent, seededClass } from "./fixtures";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";
import type { Server } from "node:http";

const ADMIN_USERNAME = "phase15-admin";
const ADMIN_PASSWORD = "phase15-admin-password-1";
const STAFF_USERNAME = "phase15-staff";
const STAFF_PASSWORD = "phase15-staff-password-1";
const MARKER_DATE = new Date("2026-12-23T09:30:00Z");

let adminId: string;
let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;
let documentId: string;
let otherDocumentId: string;
let matchedCandidateId: string;
let otherCandidateId: string;

const INTERNAL_MARKERS = ["prisma", "schema.prisma", "D:\\", "at ", "SQL", "stack"];

function stubResult(generationId: string, examId: string): GenerationResult {
  return {
    generationId,
    examId,
    state: "COMPLETED",
    session: null,
    sessionCandidateCount: 0,
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
    error: null,
  };
}

async function authedRequest(
  path: string,
  sessionToken: string | null,
  method: "GET" | "POST",
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: sessionToken ? { Cookie: `ar_seat_session=${sessionToken}` } : {},
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function candidateStatus(candidateId: string): Promise<string> {
  const candidate = await prisma.examCandidate.findUniqueOrThrow({
    where: { id: candidateId },
  });
  return candidate.validationStatus;
}

async function createExamWithMatchedCandidate(): Promise<{
  documentId: string;
  candidateId: string;
}> {
  const exam = await createExam({ examDate: MARKER_DATE, session: "FN" }, "test-actor");
  const classRecord = await seededClass();
  const student = await createTestStudent(classRecord.id, "T");
  const document = await prisma.uploadedExamDocument.create({
    data: {
      examId: exam.id,
      fileName: "candidates.pdf",
      storagePath: `exams/${exam.id}/phase15.pdf`,
      mimeType: "application/pdf",
      fileSize: 10,
      fileHash: "f".repeat(64),
    },
  });
  const candidate = await createCandidate(
    {
      examId: exam.id,
      studentId: student.id,
      sourceDocumentId: document.id,
      subjectCode: "CS8501",
      subjectName: "ToC",
      registerNumberSnapshot: student.registerNumber,
    },
    "test-actor",
  );
  await transitionValidationStatus(candidate.id, "MATCHED", "test-actor");
  return { documentId: document.id, candidateId: candidate.id };
}

describe("phase15 candidate resolve HTTP surface", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    adminId = admin.id;
    adminToken = (await createSession(adminId)).token;

    const staff = await createUser({ username: STAFF_USERNAME, password: STAFF_PASSWORD, role: "STAFF" });
    staffToken = (await createSession(staff.id)).token;

    const primary = await createExamWithMatchedCandidate();
    documentId = primary.documentId;
    matchedCandidateId = primary.candidateId;

    const other = await createExamWithMatchedCandidate();
    otherDocumentId = other.documentId;
    otherCandidateId = other.candidateId;

    const registry = new Map<string, GenerationResult>();
    const dispatch = (async () => {
      throw new Error("solver dispatch must never run in candidate resolve tests");
    }) as unknown as SolverDispatch;

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

  it("unauthenticated resolve returns 401 UNAUTHORIZED", async () => {
    const res = await authedRequest(
      `/exam-seating/documents/${documentId}/candidates/${matchedCandidateId}/resolve`,
      null,
      "POST",
    );
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("STAFF is denied resolve with 403 FORBIDDEN and the candidate stays MATCHED", async () => {
    const res = await authedRequest(
      `/exam-seating/documents/${documentId}/candidates/${matchedCandidateId}/resolve`,
      staffToken,
      "POST",
    );
    expect(res.status).toBe(403);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("FORBIDDEN");
    expect(await candidateStatus(matchedCandidateId)).toBe("MATCHED");
  });

  it("ADMIN resolve moves MATCHED -> VALIDATED and returns the updated candidate", async () => {
    const res = await authedRequest(
      `/exam-seating/documents/${documentId}/candidates/${matchedCandidateId}/resolve`,
      adminToken,
      "POST",
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<{ candidate: Record<string, unknown> }>(res);
    expect(body.candidate.id).toBe(matchedCandidateId);
    expect(body.candidate.validationStatus).toBe("VALIDATED");
    expect(typeof body.candidate.registerNumberSnapshot).toBe("string");
    expect(typeof body.candidate.studentNameSnapshot).toBe("string");
    expect(typeof body.candidate.departmentSnapshot).toBe("string");
    expect(typeof body.candidate.classSnapshot).toBe("string");
    expect(typeof body.candidate.subjectCode).toBe("string");
    expect(typeof body.candidate.subjectName).toBe("string");
    expect("academicYear" in body.candidate).toBe(false);
    expect(await candidateStatus(matchedCandidateId)).toBe("VALIDATED");
  });

  it("resolving the same candidate again returns 409 INVALID_VALIDATION_STATUS_TRANSITION", async () => {
    const res = await authedRequest(
      `/exam-seating/documents/${documentId}/candidates/${matchedCandidateId}/resolve`,
      adminToken,
      "POST",
    );
    expect(res.status).toBe(409);
    const raw = JSON.stringify(await jsonBody<{ error: string }>(res));
    expect((JSON.parse(raw) as { error: string }).error).toBe(
      "INVALID_VALIDATION_STATUS_TRANSITION",
    );
    for (const marker of INTERNAL_MARKERS) {
      expect(raw).not.toContain(marker);
    }
  });

  it("resolving an unknown candidate returns intentional 404 CANDIDATE_NOT_FOUND", async () => {
    const res = await authedRequest(
      `/exam-seating/documents/${documentId}/candidates/unknown-candidate-id/resolve`,
      adminToken,
      "POST",
    );
    expect(res.status).toBe(404);
    const raw = JSON.stringify(await jsonBody<{ error: string }>(res));
    expect((JSON.parse(raw) as { error: string }).error).toBe("CANDIDATE_NOT_FOUND");
    for (const marker of INTERNAL_MARKERS) {
      expect(raw).not.toContain(marker);
    }
  });

  it("resolving a candidate under the wrong document returns 404 CANDIDATE_NOT_FOUND", async () => {
    const res = await authedRequest(
      `/exam-seating/documents/${documentId}/candidates/${otherCandidateId}/resolve`,
      adminToken,
      "POST",
    );
    expect(res.status).toBe(404);
    const raw = JSON.stringify(await jsonBody<{ error: string }>(res));
    expect((JSON.parse(raw) as { error: string }).error).toBe("CANDIDATE_NOT_FOUND");
    for (const marker of INTERNAL_MARKERS) {
      expect(raw).not.toContain(marker);
    }
    expect(await candidateStatus(otherCandidateId)).toBe("MATCHED");
  });

  it("reuses the single CANDIDATE_RESOLVED audit event with the acting ADMIN", async () => {
    const audits = await prisma.auditLog.findMany({
      where: {
        action: "CANDIDATE_RESOLVED",
        entityType: "ExamCandidate",
        entityId: matchedCandidateId,
      },
      orderBy: { createdAt: "asc" },
    });
    const resolvedByAdmin = audits.filter(
      (audit) =>
        audit.actorId === adminId &&
        (audit.metadata as Record<string, string> | null)?.validationStatus === "VALIDATED",
    );
    expect(resolvedByAdmin).toHaveLength(1);
    expect(resolvedByAdmin[0]?.actorId).toBe(adminId);
  });
});
