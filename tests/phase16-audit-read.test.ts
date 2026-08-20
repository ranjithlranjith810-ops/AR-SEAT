/**
 * Phase 16 — ADMIN audit-read surface.
 *
 * GET /exam-seating/audit-logs is a strictly read-only, ADMIN-only listing with
 * offset pagination, deterministic (createdAt DESC, id DESC) ordering, bounded
 * filters (action/entityType/entityId/actorId/from/to), and a whitelisted
 * serializer that exposes id/action/entityType/entityId/createdAt/actor and
 * NEVER metadata or internal fields. The endpoint must not create audit rows.
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

const ADMIN_USERNAME = "phase16-admin";
const ADMIN_PASSWORD = "phase16-admin-password-1";
const STAFF_USERNAME = "phase16-staff";
const STAFF_PASSWORD = "phase16-staff-password-1";
const FIXTURE_ENTITY = "AuditTestFixture";
const BASE = Date.parse("2026-01-10T00:00:00.000Z");

const INTERNAL_MARKERS = ["prisma", "schema.prisma", "D:\\", "at ", "SQL", "stack"];

let adminId: string;
let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;
let realExamId: string;
let fixtureIds: string[] = [];

const FIXTURE_TOTAL = 29;

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

async function authedRequest(path: string, sessionToken: string | null): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: sessionToken ? { Cookie: `ar_seat_session=${sessionToken}` } : {},
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("phase16 ADMIN audit-read surface", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    adminId = admin.id;
    adminToken = (await createSession(adminId)).token;

    const staff = await createUser({ username: STAFF_USERNAME, password: STAFF_PASSWORD, role: "STAFF" });
    staffToken = (await createSession(staff.id)).token;

    // 25 numbered rows: even indexes -> actorId = adminId, odd -> actorId = null.
    const rows: Array<{ id: string; actorId: string | null; action: string; createdAt: Date }> = [];
    for (let i = 0; i < 25; i++) {
      rows.push({
        id: `fixture-${i}`,
        actorId: i % 2 === 0 ? adminId : null,
        action: "EXAM_CREATED",
        createdAt: new Date(BASE + (i + 1) * 1000),
      });
    }
    // Deterministic id tie-break at the same createdAt (newest timestamp).
    rows.push(
      { id: "fixture-zzz", actorId: null, action: "EXAM_CREATED", createdAt: new Date(BASE + 26 * 1000) },
      { id: "fixture-aaa", actorId: null, action: "EXAM_CREATED", createdAt: new Date(BASE + 26 * 1000) },
      { id: "fixture-nouser", actorId: "no-such-user", action: "EXAM_CREATED", createdAt: new Date(BASE + 27 * 1000) },
      { id: "fixture-plan", actorId: adminId, action: "PLAN_APPROVED", createdAt: new Date(BASE + 28 * 1000) },
    );

    for (const row of rows) {
      await prisma.auditLog.create({
        data: {
          id: row.id,
          actorId: row.actorId,
          action: row.action as never,
          entityType: FIXTURE_ENTITY,
          entityId: row.id,
          createdAt: row.createdAt,
        },
      });
    }
    fixtureIds = rows.map((row) => row.id);

    // A real audit write through logAudit (createExam) to prove the endpoint
    // resolves the acting ADMIN and that read paths leave writes untouched.
    const exam = await createExam({ examDate: new Date("2026-03-01T09:30:00Z"), session: "FN" }, adminId);
    realExamId = exam.id;

    const registry = new Map<string, GenerationResult>();
    const dispatch = (async () => {
      throw new Error("solver dispatch must never run in audit-read tests");
    }) as unknown as SolverDispatch;

    server = createPhase4Server({ registry, dispatch });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ id: { in: fixtureIds } }, { entityType: "Exam", entityId: realExamId }],
      },
    });
    // Hard delete is disabled for exams (RDBMS-level guard); mark CANCELLED instead.
    await prisma.exam.update({ where: { id: realExamId }, data: { status: "CANCELLED" } });
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("unauthenticated request returns 401 UNAUTHORIZED", async () => {
    const res = await authedRequest("/exam-seating/audit-logs", null);
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("STAFF is denied with 403 FORBIDDEN", async () => {
    const res = await authedRequest("/exam-seating/audit-logs", staffToken);
    expect(res.status).toBe(403);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("FORBIDDEN");
  });

  it("ADMIN receives 200 with the approved response shape and no metadata", async () => {
    const res = await authedRequest(`/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}`, adminToken);
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      items: Array<Record<string, unknown>>;
      total: number;
      limit: number;
      offset: number;
    }>(res);
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(typeof body.limit).toBe("number");
    expect(typeof body.offset).toBe("number");
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.action).toBe("string");
      expect(typeof item.entityType).toBe("string");
      expect(typeof item.entityId).toBe("string");
      expect(item.createdAt).toBeTruthy();
      expect(Object.keys(item).sort()).toEqual(
        ["action", "actor", "createdAt", "entityId", "entityType", "id"].sort(),
      );
      expect("metadata" in item).toBe(false);
      expect("passwordHash" in item).toBe(false);
      expect("actorId" in item).toBe(false);
    }
  });

  it("defaults to limit=20 and offset=0", async () => {
    const res = await authedRequest(`/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}`, adminToken);
    const body = await jsonBody<{ items: unknown[]; total: number; limit: number; offset: number }>(res);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(20);
    expect(body.total).toBe(FIXTURE_TOTAL);
  });

  it("honors explicit limit and offset", async () => {
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&limit=10&offset=5`,
      adminToken,
    );
    const body = await jsonBody<{ items: Array<{ id: string }>; limit: number; offset: number }>(res);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(5);
    expect(body.items).toHaveLength(10);
  });

  it("accepts the maximum limit of 100", async () => {
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&limit=100`,
      adminToken,
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<{ items: unknown[]; total: number }>(res);
    expect(body.items).toHaveLength(FIXTURE_TOTAL);
    expect(body.total).toBe(FIXTURE_TOTAL);
  });

  it("orders by createdAt DESC then id DESC deterministically", async () => {
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&limit=100`,
      adminToken,
    );
    const body = await jsonBody<{ items: Array<{ id: string }> }>(res);
    const ids = body.items.map((item) => item.id);
    // fixture-plan (28s) newest; fixture-nouser (27s) next; then the 26s
    // tie-break pair with id DESC: fixture-zzz before fixture-aaa.
    expect(ids[0]).toBe("fixture-plan");
    expect(ids[1]).toBe("fixture-nouser");
    expect(ids[2]).toBe("fixture-zzz");
    expect(ids[3]).toBe("fixture-aaa");
    // Then the numbered rows newest-first.
    expect(ids[4]).toBe("fixture-24");
    expect(ids[ids.length - 1]).toBe("fixture-0");
  });

  it("filters by action", async () => {
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&action=PLAN_APPROVED`,
      adminToken,
    );
    const body = await jsonBody<{ items: Array<{ action: string }>; total: number }>(res);
    expect(body.total).toBe(1);
    expect(body.items[0]?.action).toBe("PLAN_APPROVED");
  });

  it("filters by entityType", async () => {
    const res = await authedRequest(`/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}`, adminToken);
    const body = await jsonBody<{ items: Array<{ entityType: string }>; total: number }>(res);
    expect(body.total).toBe(FIXTURE_TOTAL);
    for (const item of body.items) expect(item.entityType).toBe(FIXTURE_ENTITY);
  });

  it("filters by entityId", async () => {
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&entityId=fixture-5`,
      adminToken,
    );
    const body = await jsonBody<{ items: Array<{ id: string }>; total: number }>(res);
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe("fixture-5");
  });

  it("filters by actorId and resolves only that actor's rows", async () => {
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&actorId=${adminId}`,
      adminToken,
    );
    const body = await jsonBody<{
      items: Array<{ actor: { id: string } | null }>;
      total: number;
    }>(res);
    // Even-numbered rows (13) + fixture-plan = 14 rows acted by the admin.
    expect(body.total).toBe(14);
    expect(body.items).toHaveLength(14);
    for (const item of body.items) expect(item.actor?.id).toBe(adminId);
  });

  it("filters by from/to timestamp range (inclusive)", async () => {
    const from = new Date(BASE + 2 * 1000).toISOString();
    const to = new Date(BASE + 5 * 1000).toISOString();
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&from=${from}&to=${to}`,
      adminToken,
    );
    const body = await jsonBody<{ items: Array<{ id: string }>; total: number }>(res);
    expect(body.total).toBe(4);
    expect(body.items.map((item) => item.id).sort()).toEqual([
      "fixture-1",
      "fixture-2",
      "fixture-3",
      "fixture-4",
    ]);
  });

  it("returns empty items when nothing matches", async () => {
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=DefinitelyDoesNotExist`,
      adminToken,
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<{ items: unknown[]; total: number }>(res);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("renders actor=null for actor-less and unresolvable-actor entries", async () => {
    const actorless = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&entityId=fixture-1`,
      adminToken,
    );
    const actorlessBody = await jsonBody<{ items: Array<{ actor: unknown }> }>(actorless);
    expect(actorlessBody.items[0]?.actor).toBeNull();

    const unresolvable = await authedRequest(
      `/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&entityId=fixture-nouser`,
      adminToken,
    );
    const unresolvableBody = await jsonBody<{ items: Array<{ actor: unknown }> }>(unresolvable);
    expect(unresolvableBody.items[0]?.actor).toBeNull();
  });

  it("resolves the actor to id/username/role through a real logAudit write", async () => {
    const res = await authedRequest(
      `/exam-seating/audit-logs?entityType=Exam&entityId=${realExamId}`,
      adminToken,
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      items: Array<{ action: string; actor: { id: string; username: string; role: string } | null }>;
      total: number;
    }>(res);
    expect(body.total).toBe(1);
    expect(body.items[0]?.action).toBe("EXAM_CREATED");
    expect(body.items[0]?.actor).toEqual({
      id: adminId,
      username: ADMIN_USERNAME,
      role: "ADMIN",
    });
  });

  it("rejects an invalid action with 400 INVALID_ACTION", async () => {
    const res = await authedRequest("/exam-seating/audit-logs?action=NOT_A_REAL_ACTION", adminToken);
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_ACTION");
  });

  it.each([["0"], ["-5"], ["101"], ["abc"]])(
    "rejects invalid limit %s with 400 INVALID_PAGINATION",
    async (limit) => {
      const res = await authedRequest(`/exam-seating/audit-logs?limit=${limit}`, adminToken);
      expect(res.status).toBe(400);
      expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_PAGINATION");
    },
  );

  it("rejects an invalid offset with 400 INVALID_PAGINATION", async () => {
    const res = await authedRequest("/exam-seating/audit-logs?offset=-1", adminToken);
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_PAGINATION");
  });

  it("rejects an invalid date with 400 INVALID_DATE", async () => {
    const res = await authedRequest("/exam-seating/audit-logs?from=not-a-date", adminToken);
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_DATE");
  });

  it("rejects from after to with 400 INVALID_DATE_RANGE", async () => {
    const res = await authedRequest(
      "/exam-seating/audit-logs?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z",
      adminToken,
    );
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("INVALID_DATE_RANGE");
  });

  it("sanitizes every intentional error body", async () => {
    const responses: Response[] = [];
    responses.push(await authedRequest("/exam-seating/audit-logs", null));
    responses.push(await authedRequest("/exam-seating/audit-logs", staffToken));
    responses.push(await authedRequest("/exam-seating/audit-logs?action=NOPE", adminToken));
    responses.push(await authedRequest("/exam-seating/audit-logs?limit=0", adminToken));
    responses.push(await authedRequest("/exam-seating/audit-logs?from=garbage", adminToken));
    for (const res of responses) {
      expect([401, 403, 400]).toContain(res.status);
      const raw = JSON.stringify(await jsonBody<unknown>(res));
      for (const marker of INTERNAL_MARKERS) expect(raw).not.toContain(marker);
    }
  });

  it("never creates audit rows while reading", async () => {
    const before = await prisma.auditLog.count({ where: { entityType: FIXTURE_ENTITY } });
    await authedRequest(`/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}`, adminToken);
    await authedRequest(`/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&limit=5&offset=2`, adminToken);
    await authedRequest(`/exam-seating/audit-logs?entityType=${FIXTURE_ENTITY}&action=EXAM_CREATED`, adminToken);
    const after = await prisma.auditLog.count({ where: { entityType: FIXTURE_ENTITY } });
    expect(after).toBe(before);
  });

  it("leaves the real audit write behavior unchanged (single EXAM_CREATED row)", async () => {
    const audits = await prisma.auditLog.findMany({
      where: { action: "EXAM_CREATED", entityType: "Exam", entityId: realExamId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(adminId);
  });
});
