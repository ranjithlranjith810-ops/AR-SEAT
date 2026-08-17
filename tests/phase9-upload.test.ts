/**
 * Phase 9 Slice 1 — authenticated PDF upload + ingestion status + validated
 * candidate view over the product HTTP surface.
 *
 * The upload route is the ONLY new entry point into the existing ingestion
 * pipeline; it must invoke ingestExamDocument (not re-implement extraction,
 * validation, or ExamCandidate sync). Contract requirements (Phase 9 §1/§6):
 *   - 401 when unauthenticated, 403 for a non-ADMIN role on upload.
 *   - Intentional 4xx for invalid file type, empty body, oversized body,
 *     unknown exam, invalid pagination; 404 for unknown document.
 *   - fileName is sanitized before persistence (no C0/C1 or bidi controls,
 *     capped length) and returned sanitized.
 *   - The generic 500 boundary still catches genuinely unexpected errors.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { prisma } from "./setup";
import { createPhase4Server, MAX_UPLOAD_BYTES } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import { createExam } from "../src/services/exam.service";
import { seededClass } from "./fixtures";
import { annaFixtureLines, buildPdf } from "./fixture-pdf";
import { sanitizeFileName } from "../src/services/exam-document/upload";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";
import type { Server } from "node:http";

const ADMIN_USERNAME = "phase9-admin";
const ADMIN_PASSWORD = "phase9-admin-password-1";
const STAFF_USERNAME = "phase9-staff";
const STAFF_PASSWORD = "phase9-staff-password-1";
const NAMES = ["ALICE ARUN", "BOB KRISHNA", "CHITRA DEVI"];
const RUN = "9" + String(Date.now()).slice(-6);
const NONCE = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;

const dispatch = (async () => {
  throw new Error("solver dispatch must never run behind upload tests");
}) as unknown as SolverDispatch;

function makeStubResult(examId: string, generationId: string): GenerationResult {
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

let ingestSeq = 0;

async function setupIngestableExam(): Promise<{
  exam: Awaited<ReturnType<typeof createExam>>;
  registers: string[];
  pdf: Uint8Array;
}> {
  const cls = await seededClass("CSE-A");
  const seq = ingestSeq;
  ingestSeq += 1;
  const exam = await createExam(
    { examDate: new Date(Date.UTC(2026, 11, 10, 9, 30 + seq)), session: seq % 2 === 0 ? "FN" : "AN" },
    "test-actor",
  );
  const registers = NAMES.map((_, i) => `${RUN}${String(seq).padStart(2, "0")}${i + 1}`);
  await prisma.student.createMany({
    data: registers.map((registerNumber, i) => ({
      name: NAMES[i]!,
      rollNumber: `R-P9-${NONCE}-${seq}-${i}`,
      registerNumber,
      gender: "MALE",
      classId: cls.id,
      status: "ACTIVE",
    })),
  });
  const pdf = await buildPdf(
    annaFixtureLines(
      registers.map((registerNumber, i) => ({
        serial: String(i + 1).padStart(3, "0"),
        registerNumber,
        name: NAMES[i]!,
      })),
    ),
  );
  return { exam, registers, pdf };
}

async function upload(
  body: Uint8Array | string,
  opts: { token: string | null; examId: string; contentType?: string; fileName?: string },
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Cookie = `ar_seat_session=${opts.token}`;
  headers["Content-Type"] = opts.contentType ?? "application/pdf";
  if (opts.fileName) headers["X-File-Name"] = opts.fileName;
  return fetch(`${baseUrl}/exam-seating/documents?examId=${opts.examId}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : Buffer.from(body),
  });
}

async function authedGet(path: string, token: string | null): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { Cookie: `ar_seat_session=${token}` } : {},
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("phase9 upload/ingestion product surface", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    const staff = await createUser({ username: STAFF_USERNAME, password: STAFF_PASSWORD, role: "STAFF" });
    adminToken = (await createSession(admin.id)).token;
    staffToken = (await createSession(staff.id)).token;

    const registry = new Map<string, GenerationResult>();
    registry.set("phase9-unused", makeStubResult("unused", "phase9-unused"));
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

  it("unauthenticated upload -> 401 UNAUTHORIZED", async () => {
    const exam = await createExam({ examDate: new Date("2026-12-09T09:30:00Z"), session: "FN" }, "test-actor");
    const res = await upload(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      token: null,
      examId: exam.id,
    });
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("STAFF upload -> 403 FORBIDDEN", async () => {
    const exam = await createExam({ examDate: new Date("2026-12-09T10:30:00Z"), session: "AN" }, "test-actor");
    const res = await upload(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      token: staffToken,
      examId: exam.id,
    });
    expect(res.status).toBe(403);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("FORBIDDEN");
  });

  it("ADMIN upload of a real PDF ingests and persists candidates from the master", async () => {
    const { exam, registers, pdf } = await setupIngestableExam();
    const res = await upload(pdf, { token: adminToken, examId: exam.id, fileName: "candidate-list.pdf" });
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      documentId: string;
      finalParseStatus: string;
      counts: { matched: number; rejected: number };
      candidatesPersisted: number;
      duplicate: boolean;
      fileName: string;
    }>(res);
    expect(body.duplicate).toBe(false);
    expect(body.finalParseStatus).toBe("PARSED");
    expect(body.counts.matched).toBe(NAMES.length);
    expect(body.counts.rejected).toBe(0);
    expect(body.candidatesPersisted).toBe(NAMES.length);
    expect(body.fileName).toBe("candidate-list.pdf");

    const doc = await prisma.uploadedExamDocument.findUniqueOrThrow({ where: { id: body.documentId } });
    expect(doc.parseStatus).toBe("PARSED");
    expect(doc.fileHash).toHaveLength(64);

    const candidates = await prisma.examCandidate.findMany({ where: { examId: exam.id } });
    expect(candidates).toHaveLength(NAMES.length);
    for (const candidate of candidates) {
      expect(candidate.sourceDocumentId).toBe(doc.id);
      expect(candidate.validationStatus).toBe("MATCHED");
      expect(candidate.studentNameSnapshot).toBe(
        NAMES[registers.indexOf(candidate.registerNumberSnapshot)]!,
      );
    }
  });

  it("duplicate upload -> 200 with duplicate:true and existingDocumentId", async () => {
    const { exam, pdf } = await setupIngestableExam();
    const first = await upload(pdf, { token: adminToken, examId: exam.id, fileName: "dup.pdf" });
    expect(first.status).toBe(200);
    const firstBody = await jsonBody<{ documentId: string; duplicate: boolean }>(first);
    expect(firstBody.duplicate).toBe(false);

    const second = await upload(pdf, { token: adminToken, examId: exam.id, fileName: "dup-copy.pdf" });
    expect(second.status).toBe(200);
    const secondBody = await jsonBody<{
      documentId: string;
      duplicate: boolean;
      existingDocumentId?: string;
    }>(second);
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.documentId).toBe(firstBody.documentId);
    expect(secondBody.existingDocumentId).toBe(firstBody.documentId);

    const docs = await prisma.uploadedExamDocument.findMany({ where: { examId: exam.id } });
    expect(docs).toHaveLength(1);
  });

  it("fileName is sanitized before persistence (controls stripped, length capped)", async () => {
    expect(sanitizeFileName("bad\u0000name\u202e.pdf")).toBe("badname.pdf");
    expect(sanitizeFileName("\u0001\u200e a b ")).toBe("a b");
    expect(sanitizeFileName("x".repeat(300))).toHaveLength(255);
    expect(sanitizeFileName("\u0000")).toBe("document.pdf");

    const exam = await createExam({ examDate: new Date("2026-12-09T13:30:00Z"), session: "FN" }, "test-actor");
    const pdf = await buildPdf([]);
    const res = await upload(pdf, { token: adminToken, examId: exam.id, fileName: "c".repeat(300) + ".pdf" });
    expect(res.status).toBe(200);
    const body = await jsonBody<{ documentId: string; fileName: string }>(res);
    expect(body.fileName.length).toBeLessThanOrEqual(255);
    expect(body.fileName.startsWith("c")).toBe(true);
    const doc = await prisma.uploadedExamDocument.findUniqueOrThrow({ where: { id: body.documentId } });
    expect(doc.fileName).toBe(body.fileName);
  });

  it("unknown exam -> intentional 404 EXAM_NOT_FOUND", async () => {
    const res = await upload(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      token: adminToken,
      examId: "no-such-exam",
    });
    expect(res.status).toBe(404);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("EXAM_NOT_FOUND");
  });

  it("missing examId -> 400 MISSING_EXAM_ID", async () => {
    const res = await fetch(`${baseUrl}/exam-seating/documents`, {
      method: "POST",
      headers: { Cookie: `ar_seat_session=${adminToken}`, "Content-Type": "application/pdf" },
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    });
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("MISSING_EXAM_ID");
  });

  it("wrong content type -> 400 INVALID_FILE_TYPE", async () => {
    const exam = await createExam({ examDate: new Date("2026-12-09T14:30:00Z"), session: "AN" }, "test-actor");
    const res = await upload("not a pdf at all", {
      token: adminToken,
      examId: exam.id,
      contentType: "text/plain",
    });
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_FILE_TYPE");
  });

  it("non-PDF magic bytes -> 400 INVALID_FILE_TYPE", async () => {
    const exam = await createExam({ examDate: new Date("2026-12-09T15:30:00Z"), session: "FN" }, "test-actor");
    const res = await upload("this is definitely not a pdf", {
      token: adminToken,
      examId: exam.id,
    });
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_FILE_TYPE");
  });

  it("oversized body -> 413 PAYLOAD_TOO_LARGE", async () => {
    const exam = await createExam({ examDate: new Date("2026-12-09T16:30:00Z"), session: "AN" }, "test-actor");
    const res = await upload(new Uint8Array(MAX_UPLOAD_BYTES + 1), {
      token: adminToken,
      examId: exam.id,
    });
    expect(res.status).toBe(413);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("PAYLOAD_TOO_LARGE");
  });

  it("ingestion status GET -> 200 for ADMIN and STAFF, 401 unauthenticated, 404 unknown", async () => {
    const { exam, pdf } = await setupIngestableExam();
    const up = await upload(pdf, { token: adminToken, examId: exam.id, fileName: "status.pdf" });
    const upBody = await jsonBody<{ documentId: string }>(up);
    const docId = upBody.documentId;

    const unauth = await authedGet(`/exam-seating/documents/${docId}`, null);
    expect(unauth.status).toBe(401);

    const adminRes = await authedGet(`/exam-seating/documents/${docId}`, adminToken);
    expect(adminRes.status).toBe(200);
    const adminBody = await jsonBody<{ document: { parseStatus: string; fileName: string; examId: string } }>(adminRes);
    expect(adminBody.document.parseStatus).toBe("PARSED");
    expect(adminBody.document.fileName).toBe("status.pdf");
    expect(adminBody.document.examId).toBe(exam.id);

    const staffRes = await authedGet(`/exam-seating/documents/${docId}`, staffToken);
    expect(staffRes.status).toBe(200);

    const missing = await authedGet("/exam-seating/documents/no-such-doc", adminToken);
    expect(missing.status).toBe(404);
    expect((await jsonBody<{ error: string }>(missing)).error).toBe("DOCUMENT_NOT_FOUND");
  });

  it("validated candidate view -> paginated master-sourced snapshots for the document only", async () => {
    const { exam, registers, pdf } = await setupIngestableExam();
    const up = await upload(pdf, { token: adminToken, examId: exam.id, fileName: "candidates.pdf" });
    const upBody = await jsonBody<{ documentId: string }>(up);
    const docId = upBody.documentId;

    const unauth = await authedGet(`/exam-seating/documents/${docId}/candidates`, null);
    expect(unauth.status).toBe(401);

    const res = await authedGet(`/exam-seating/documents/${docId}/candidates?limit=2`, adminToken);
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      documentId: string;
      total: number;
      offset: number;
      limit: number;
      candidates: Array<{ registerNumberSnapshot: string; sourceDocumentId?: string }>;
    }>(res);
    expect(body.documentId).toBe(docId);
    expect(body.total).toBe(NAMES.length);
    expect(body.limit).toBe(2);
    expect(body.candidates).toHaveLength(2);
    for (const candidate of body.candidates) {
      expect(candidate.sourceDocumentId).toBeUndefined();
      expect(registers).toContain(candidate.registerNumberSnapshot);
    }

    const badPagination = await authedGet(`/exam-seating/documents/${docId}/candidates?limit=999`, adminToken);
    expect(badPagination.status).toBe(400);
    expect((await jsonBody<{ error: string }>(badPagination)).error).toBe("INVALID_PAGINATION");

    const staffRes = await authedGet(`/exam-seating/documents/${docId}/candidates`, staffToken);
    expect(staffRes.status).toBe(200);

    const missing = await authedGet("/exam-seating/documents/no-such-doc/candidates", adminToken);
    expect(missing.status).toBe(404);
    expect((await jsonBody<{ error: string }>(missing)).error).toBe("DOCUMENT_NOT_FOUND");
  });
});