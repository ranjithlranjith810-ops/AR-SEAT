/**
 * Phase 10 Slice 2 — exam list endpoint (GET /exam-seating/exams).
 *
 * The exam selection step is ADMIN-only and feeds the PDF upload workflow, so
 * this read route carries an explicit requireAdmin guard (mirroring upload and
 * generation). Requirements in this change:
 *   - 401 when unauthenticated, 403 for a non-ADMIN role.
 *   - 200 { exams: [...] } for ADMIN listing existing Exam records ordered by
 *     examDate descending, serializing only fields the backend owns.
 *   - The exam record has no academic-year or class-context field; the response
 *     must not fabricate either (documented as a DEFERRED backend note).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import { createExam } from "../src/services/exam.service";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";
import type { Server } from "node:http";

const ADMIN_USERNAME = "phase10-admin";
const ADMIN_PASSWORD = "phase10-admin-password-1";
const STAFF_USERNAME = "phase10-staff";
const STAFF_PASSWORD = "phase10-staff-password-1";

let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;

const dispatch = (async () => {
  throw new Error("solver dispatch must never run behind exam-list tests");
}) as unknown as SolverDispatch;

async function authedGet(path: string, token: string | null): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { Cookie: `ar_seat_session=${token}` } : {},
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("phase10 exam list product surface", () => {
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

  it("unauthenticated GET /exam-seating/exams -> 401 UNAUTHORIZED", async () => {
    const res = await authedGet("/exam-seating/exams", null);
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("STAFF GET /exam-seating/exams -> 403 FORBIDDEN", async () => {
    const res = await authedGet("/exam-seating/exams", staffToken);
    expect(res.status).toBe(403);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("FORBIDDEN");
  });

  it("ADMIN GET /exam-seating/exams -> 200 with backend-owned Exam fields", async () => {
    const exam = await createExam(
      { examDate: new Date("2026-12-03T09:30:00Z"), session: "FN", examType: "MODEL" },
      "test-actor",
    );

    const res = await authedGet("/exam-seating/exams", adminToken);
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      exams: Array<{
        id: string;
        examDate: string;
        session: string;
        examType: string;
        status: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>(res);
    expect(Array.isArray(body.exams)).toBe(true);

    const listed = body.exams.find((e) => e.id === exam.id);
    expect(listed).toBeDefined();
    expect(listed!.examDate).toBe("2026-12-03T09:30:00.000Z");
    expect(listed!.session).toBe("FN");
    expect(listed!.examType).toBe("MODEL");
    expect(listed!.status).toBe("DRAFT");
    expect(Number.isNaN(Date.parse(listed!.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(listed!.updatedAt))).toBe(false);
  });

  it("lists exams ordered by examDate descending without fabricating context", async () => {
    const first = await createExam(
      { examDate: new Date("2026-12-01T09:30:00Z"), session: "FN", examType: "UNIVERSITY" },
      "test-actor",
    );
    const second = await createExam(
      { examDate: new Date("2026-12-10T09:30:00Z"), session: "AN", examType: "INTERNAL" },
      "test-actor",
    );
    const third = await createExam(
      { examDate: new Date("2026-12-05T09:30:00Z"), session: "FN", examType: "MODEL" },
      "test-actor",
    );

    const res = await authedGet("/exam-seating/exams", adminToken);
    const body = await jsonBody<{
      exams: Array<{ id: string; examDate: string; session: string; examType: string }>;
    }>(res);

    const expected = new Set([first.id, second.id, third.id]);
    const ordered = body.exams.filter((e) => expected.has(e.id)).map((e) => e.id);
    expect(ordered).toEqual([second.id, third.id, first.id]);

    for (const e of body.exams) {
      expect(e).not.toHaveProperty("academicYear");
      expect(e).not.toHaveProperty("class");
      expect(e).not.toHaveProperty("className");
    }
  });
});
