/**
 * Phase 11 — approve / publish HTTP surface contract.
 *
 * POST /exam-seating/plans/:seatingPlanId/approve and .../publish are ADMIN-only
 * state transitions that drive the plan through DRAFT -> APPROVED -> PUBLISHED
 * (approve gates publish). Each cell of the permission matrix gets its own
 * 401/403 test; every plan-scoped error reuses the intentional PLAN_NOT_FOUND
 * 404 contract; already-advanced plans return distinct 409 codes; both actions
 * are audited; and publishing keeps exactly one PUBLISHED plan per exam via the
 * existing DB-enforced gate.
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

const ADMIN_USERNAME = "phase11-admin";
const ADMIN_PASSWORD = "phase11-admin-password-1";
const STAFF_USERNAME = "phase11-staff";
const STAFF_PASSWORD = "phase11-staff-password-1";
const MARKER_DATE = new Date("2026-12-21T09:30:00Z");

let adminId: string;
let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;
let examId: string;
let draftPlanId: string;
let approvedPlanId: string;

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

async function planStatus(planId: string): Promise<string> {
  const plan = await prisma.seatingPlan.findUniqueOrThrow({ where: { id: planId } });
  return plan.status;
}

describe("phase11 approve/publish HTTP surface", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    adminId = admin.id;
    adminToken = (await createSession(adminId)).token;

    const staff = await createUser({ username: STAFF_USERNAME, password: STAFF_PASSWORD, role: "STAFF" });
    staffToken = (await createSession(staff.id)).token;

    const exam = await createExam({ examDate: MARKER_DATE, session: "FN" }, "test-actor");
    examId = exam.id;

    const draft = await prisma.seatingPlan.create({
      data: { examId, version: 1, status: "DRAFT", createdBy: adminId },
    });
    draftPlanId = draft.id;

    const approved = await prisma.seatingPlan.create({
      data: { examId, version: 2, status: "APPROVED", createdBy: adminId },
    });
    approvedPlanId = approved.id;

    const registry = new Map<string, GenerationResult>();
    const dispatch = (async () => {
      throw new Error("solver dispatch must never run in publish tests");
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

  it("unauthenticated approve returns 401 UNAUTHORIZED", async () => {
    const res = await authedRequest(`/exam-seating/plans/${draftPlanId}/approve`, null, "POST");
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("unauthenticated publish returns 401 UNAUTHORIZED", async () => {
    const res = await authedRequest(`/exam-seating/plans/${draftPlanId}/publish`, null, "POST");
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("STAFF is denied approve with 403 FORBIDDEN", async () => {
    const res = await authedRequest(`/exam-seating/plans/${draftPlanId}/approve`, staffToken, "POST");
    expect(res.status).toBe(403);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("FORBIDDEN");
    expect(await planStatus(draftPlanId)).toBe("DRAFT");
  });

  it("STAFF is denied publish with 403 FORBIDDEN", async () => {
    const res = await authedRequest(`/exam-seating/plans/${draftPlanId}/publish`, staffToken, "POST");
    expect(res.status).toBe(403);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("FORBIDDEN");
    expect(await planStatus(draftPlanId)).toBe("DRAFT");
  });

  it("approve gates publish: publishing a DRAFT plan returns 409 INVALID_PLAN_STATUS_TRANSITION", async () => {
    const res = await authedRequest(`/exam-seating/plans/${draftPlanId}/publish`, adminToken, "POST");
    expect(res.status).toBe(409);
    const body = await jsonBody<{ error: string }>(res);
    expect(body.error).toBe("INVALID_PLAN_STATUS_TRANSITION");
    expect(await planStatus(draftPlanId)).toBe("DRAFT");
  });

  it("ADMIN approve moves DRAFT -> APPROVED, records the actor, and audits", async () => {
    const res = await authedRequest(`/exam-seating/plans/${draftPlanId}/approve`, adminToken, "POST");
    expect(res.status).toBe(200);
    const body = await jsonBody<{ plan: { id: string; status: string; approvedBy: string | null } }>(res);
    expect(body.plan.id).toBe(draftPlanId);
    expect(body.plan.status).toBe("APPROVED");
    expect(body.plan.approvedBy).toBe(adminId);

    const plan = await prisma.seatingPlan.findUniqueOrThrow({ where: { id: draftPlanId } });
    expect(plan.status).toBe("APPROVED");
    expect(plan.approvedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: "PLAN_APPROVED", entityType: "SeatingPlan", entityId: draftPlanId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(adminId);
  });

  it("approving an already APPROVED plan returns 409 ALREADY_APPROVED", async () => {
    const res = await authedRequest(`/exam-seating/plans/${draftPlanId}/approve`, adminToken, "POST");
    expect(res.status).toBe(409);
    const raw = JSON.stringify(await jsonBody<{ error: string }>(res));
    expect((JSON.parse(raw) as { error: string }).error).toBe("ALREADY_APPROVED");
    for (const marker of ["prisma", "schema.prisma", "D:\\", "at ", "SQL"]) {
      expect(raw).not.toContain(marker);
    }
  });

  it("approving an unknown plan returns intentional 404 PLAN_NOT_FOUND with no internals", async () => {
    const res = await authedRequest("/exam-seating/plans/unknown-plan-id/approve", adminToken, "POST");
    expect(res.status).toBe(404);
    const raw = JSON.stringify(await jsonBody<{ error: string }>(res));
    expect((JSON.parse(raw) as { error: string }).error).toBe("PLAN_NOT_FOUND");
    for (const marker of ["prisma", "schema.prisma", "D:\\", "at "]) {
      expect(raw).not.toContain(marker);
    }
  });

  it("ADMIN publish moves APPROVED -> PUBLISHED, records the actor, and audits", async () => {
    const res = await authedRequest(`/exam-seating/plans/${approvedPlanId}/publish`, adminToken, "POST");
    expect(res.status).toBe(200);
    const body = await jsonBody<{ plan: { id: string; status: string; publishedBy: string | null } }>(res);
    expect(body.plan.id).toBe(approvedPlanId);
    expect(body.plan.status).toBe("PUBLISHED");
    expect(body.plan.publishedBy).toBe(adminId);

    const plan = await prisma.seatingPlan.findUniqueOrThrow({ where: { id: approvedPlanId } });
    expect(plan.status).toBe("PUBLISHED");
    expect(plan.publishedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: "PLAN_PUBLISHED", entityType: "SeatingPlan", entityId: approvedPlanId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(adminId);
  });

  it("publishing an already PUBLISHED plan returns 409 ALREADY_PUBLISHED", async () => {
    const res = await authedRequest(`/exam-seating/plans/${approvedPlanId}/publish`, adminToken, "POST");
    expect(res.status).toBe(409);
    const raw = JSON.stringify(await jsonBody<{ error: string }>(res));
    expect((JSON.parse(raw) as { error: string }).error).toBe("ALREADY_PUBLISHED");
    for (const marker of ["prisma", "schema.prisma", "D:\\", "at ", "SQL"]) {
      expect(raw).not.toContain(marker);
    }
  });

  it("publishing an unknown plan returns intentional 404 PLAN_NOT_FOUND with no internals", async () => {
    const res = await authedRequest("/exam-seating/plans/unknown-plan-id/publish", adminToken, "POST");
    expect(res.status).toBe(404);
    const raw = JSON.stringify(await jsonBody<{ error: string }>(res));
    expect((JSON.parse(raw) as { error: string }).error).toBe("PLAN_NOT_FOUND");
    for (const marker of ["prisma", "schema.prisma", "D:\\", "at "]) {
      expect(raw).not.toContain(marker);
    }
  });

  it("publishing a new plan supersedes the previous PUBLISHED plan for the same exam", async () => {
    const exam = await createExam({ examDate: MARKER_DATE, session: "AN" }, "test-actor");
    const p1 = await prisma.seatingPlan.create({
      data: { examId: exam.id, version: 1, status: "APPROVED" },
    });
    const p2 = await prisma.seatingPlan.create({
      data: { examId: exam.id, version: 2, status: "APPROVED" },
    });

    const first = await authedRequest(`/exam-seating/plans/${p1.id}/publish`, adminToken, "POST");
    expect(first.status).toBe(200);
    expect(await planStatus(p1.id)).toBe("PUBLISHED");

    const second = await authedRequest(`/exam-seating/plans/${p2.id}/publish`, adminToken, "POST");
    expect(second.status).toBe(200);
    expect(await planStatus(p2.id)).toBe("PUBLISHED");
    expect(await planStatus(p1.id)).toBe("SUPERSEDED");

    const published = await prisma.seatingPlan.count({
      where: { examId: exam.id, status: "PUBLISHED" },
    });
    expect(published).toBe(1);
  });
});