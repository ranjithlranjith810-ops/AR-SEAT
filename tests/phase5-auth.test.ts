/**
 * Phase 5 â€” authentication + API protection (spec Â§10).
 *
 * Exercises the node:http API surface end-to-end: login, logout, session
 * validation, role authorization, and 401/403 behavior. Auth runs BEFORE
 * routing, so unauthenticated requests must never reach candidate processing,
 * solver dispatch, or persistence.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import { createExam } from "../src/services/exam.service";
import { createTestCandidate, seededClass } from "./fixtures";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";
import type { Server } from "node:http";

const ADMIN_USERNAME = "phase5-admin";
const ADMIN_PASSWORD = "phase5-admin-password-1";
const STAFF_USERNAME = "phase5-staff";
const STAFF_PASSWORD = "phase5-staff-password-1";

let adminId: string;
let staffId: string;
let registry: Map<string, GenerationResult>;
let server: Server;
let baseUrl: string;

function stubOptimalDispatch(): SolverDispatch {
  return {
    async solveDomain(): Promise<never> {
      // The reconcile gate stops generation before any dispatch in these
      // tests; a reaching dispatch is a test failure in itself.
      throw new Error("solver dispatch must never run behind auth tests");
    },
  };
}

function cookieToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(";")[0]!;
  const eq = first.indexOf("=");
  if (eq === -1) return null;
  return first.slice(eq + 1);
}

async function login(username: string, password: string): Promise<{ status: number; token: string | null; body: unknown }> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return {
    status: res.status,
    token: cookieToken(res.headers.get("set-cookie")),
    body: await res.json(),
  };
}

async function authedFetch(path: string, token: string | null): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { Cookie: `ar_seat_session=${token}` } : {},
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function createExamWithUnvalidatedCandidate(): Promise<{ id: string }> {
  const exam = await createExam({ examDate: new Date("2026-12-03T09:30:00Z"), session: "FN" }, "test-actor");
  const cls = await seededClass("CSE-A");
  const student = await prisma.student.create({
    data: {
      name: "Auth Fixture Student",
      rollNumber: `R-AUTH-${Date.now()}`,
      registerNumber: `REG-AUTH-${Date.now()}`,
      gender: "MALE",
      classId: cls.id,
      status: "ACTIVE",
    },
  });
  await createTestCandidate(exam.id, student.id);
  return { id: exam.id };
}

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

describe("phase5 authentication + API protection", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    const staff = await createUser({ username: STAFF_USERNAME, password: STAFF_PASSWORD, role: "STAFF" });
    adminId = admin.id;
    staffId = staff.id;

    registry = new Map();
    server = createPhase4Server({
      registry,
      dispatch: stubOptimalDispatch(),
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("Test A â€” unauthenticated requests get 401 and never reach generation work", async () => {
    const exam = await createExamWithUnvalidatedCandidate();

    const createRes = await fetch(`${baseUrl}/exam-seating/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examId: exam.id }),
    });
    expect(createRes.status).toBe(401);
    expect((await jsonBody<{ error: string }>(createRes)).error).toBe("UNAUTHORIZED");

    const meRes = await fetch(`${baseUrl}/auth/me`);
    expect(meRes.status).toBe(401);

    const statusRes = await fetch(`${baseUrl}/exam-seating/generations/some-id`);
    expect(statusRes.status).toBe(401);

    const seatingRes = await fetch(`${baseUrl}/exam-seating/generations/some-id/seating`);
    expect(seatingRes.status).toBe(401);

    // No solve job, no seating plan, no persistence side effects.
    expect(await prisma.solveJob.count({ where: { examId: exam.id } })).toBe(0);
    expect(await prisma.seatingPlan.count({ where: { examId: exam.id } })).toBe(0);
  });

  it("Test B â€” invalid session token gets 401", async () => {
    const res = await authedFetch("/auth/me", "bogus-invalid-session-token");
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("Test C â€” a valid authenticated ADMIN session is accepted and reaches the pipeline gate", async () => {
    const loginResult = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    expect(loginResult.status).toBe(200);
    expect(loginResult.token).toBeTruthy();
    expect((loginResult.body as { user: { role: string } }).user.role).toBe("ADMIN");

    const meRes = await authedFetch("/auth/me", loginResult.token);
    expect(meRes.status).toBe(200);
    expect((await jsonBody<{ user: { username: string } }>(meRes)).user.username).toBe(ADMIN_USERNAME);

    const exam = await createExamWithUnvalidatedCandidate();
    const createRes = await fetch(`${baseUrl}/exam-seating/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `ar_seat_session=${loginResult.token}`,
      },
      body: JSON.stringify({ examId: exam.id }),
    });
expect(createRes.status).not.toBe(401);
    expect(createRes.status).not.toBe(403);
    const created = (await jsonBody<{ generationId: string; state: string }>(createRes));
    // Request passed auth + role and stopped at the reconciliation gate:
    // the unvalidated candidate blocks dispatch before any solver work.
    expect(created.state).toBe("FAILED_RECONCILIATION");

    const statusRes = await authedFetch(`/exam-seating/generations/${created.generationId}`, loginResult.token);
    expect(statusRes.status).toBe(200);
    const status = await jsonBody<{ state: string; error: { code: string } | null }>(statusRes);
    expect(status.state).toBe("FAILED_RECONCILIATION");
    expect(status.error?.code).toBe("ERR_CANDIDATE_RECONCILIATION");
  });

  it("Test D â€” an authenticated STAFF user is forbidden from creating generations but may view", async () => {
    const loginResult = await login(STAFF_USERNAME, STAFF_PASSWORD);
    expect(loginResult.status).toBe(200);
    expect(loginResult.token).toBeTruthy();
    expect((loginResult.body as { user: { role: string } }).user.role).toBe("STAFF");

    const meRes = await authedFetch("/auth/me", loginResult.token);
    expect(meRes.status).toBe(200);

    const exam = await createExamWithUnvalidatedCandidate();
    const createRes = await fetch(`${baseUrl}/exam-seating/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `ar_seat_session=${loginResult.token}`,
      },
      body: JSON.stringify({ examId: exam.id }),
    });
    expect(createRes.status).toBe(403);
    expect((await jsonBody<{ error: string }>(createRes)).error).toBe("FORBIDDEN");

    // No solver dispatch, no persistence behind the 403.
    expect(await prisma.solveJob.count({ where: { examId: exam.id } })).toBe(0);
    expect(await prisma.seatingPlan.count({ where: { examId: exam.id } })).toBe(0);

// STAFF can still view authenticated resources.
    const viewId = `gen-view-${Date.now()}`;
    registry.set(viewId, makeStubResult(exam.id, viewId));
    const statusRes = await authedFetch(`/exam-seating/generations/${viewId}`, loginResult.token);
    expect(statusRes.status).toBe(200);
    // The seating endpoint passes the same auth gate; a missing PUBLISHED plan
    // is the pre-existing Phase 4 PLAN_NOT_FOUND (500), not an auth failure.
    const seatingRes = await authedFetch(`/exam-seating/generations/${viewId}/seating`, loginResult.token);
    expect(seatingRes.status).not.toBe(401);
    expect(seatingRes.status).not.toBe(403);
  });

  it("Test E â€” logout invalidates the session", async () => {
    const before = await prisma.authSession.count({ where: { userId: adminId } });

    const loginResult = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    expect(loginResult.token).toBeTruthy();
    expect((await authedFetch("/auth/me", loginResult.token)).status).toBe(200);
    expect(await prisma.authSession.count({ where: { userId: adminId } })).toBe(before + 1);

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { Cookie: `ar_seat_session=${loginResult.token}` },
    });
    expect(logoutRes.status).toBe(200);
    expect((await jsonBody<{ ok: boolean }>(logoutRes)).ok).toBe(true);

    const afterLogout = await authedFetch("/auth/me", loginResult.token);
    expect(afterLogout.status).toBe(401);
    expect(await prisma.authSession.count({ where: { userId: adminId } })).toBe(before);
  });

  it("Test F â€” an expired session cannot authorize protected requests", async () => {
    const before = await prisma.authSession.count({ where: { userId: staffId } });

    const expired = await createSession(staffId, -60);
    expect(await prisma.authSession.count({ where: { userId: staffId } })).toBe(before + 1);

    const res = await authedFetch("/auth/me", expired.token);
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");

    // The expired session is removed during validation.
    expect(await prisma.authSession.count({ where: { userId: staffId } })).toBe(before);
  });

  it("Test G â€” wrong credentials are rejected with 401 and no session", async () => {
    const res = await login(ADMIN_USERNAME, "definitely-wrong-password");
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toBe("INVALID_CREDENTIALS");
    expect(res.token).toBeNull();
  });
});
