/**
 * Phase 7c Part A — PLAN_NOT_FOUND API contract.
 *
 * A missing PUBLISHED seating plan is a KNOWN application condition and must
 * surface as an intentional HTTP 404 { error: "PLAN_NOT_FOUND" } — not a 500.
 * The Phase 7b boundary must still sanitize genuinely unexpected exceptions,
 * and existing auth/authorization behavior must remain unchanged.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import { createExam } from "../src/services/exam.service";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";
import type { Server } from "node:http";

const ADMIN_USERNAME = "phase7c-admin";
const ADMIN_PASSWORD = "phase7c-admin-password-1";
const FORCED_ID = "forcing-id";
const INJECTED_MESSAGE =
  "prisma.authSession.findUnique failed: table public.auth_sessions does not exist at D:\\secrets\\schema.prisma line 42";
const NO_INTERNAL_MARKERS = [
  "SeatingError",
  "PUBLISHED",
  "persist.ts",
  "at ",
  "An unexpected error occurred",
  "prisma",
  "auth_sessions",
  "D:\\secrets",
];

let token: string;
let server: Server;
let baseUrl: string;
let examWithPlanId: string;
let examNoPlanId: string;
let genWithPlan = "gen-withplan";
let genNoPlan = "gen-noplan";

class ThrowingRegistry extends Map<string, GenerationResult> {
  override get(key: string): GenerationResult | undefined {
    if (key === FORCED_ID) {
      throw new Error(INJECTED_MESSAGE);
    }
    return super.get(key);
  }
}

const dispatch = (async () => {
  throw new Error("solver dispatch must never run in plan-not-found tests");
}) as unknown as SolverDispatch;

function stubResult(examId: string, generationId: string): GenerationResult {
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

async function authedGet(path: string, sessionToken: string | null): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: sessionToken ? { Cookie: `ar_seat_session=${sessionToken}` } : {},
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("phase7c PLAN_NOT_FOUND API contract", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    token = (await createSession(admin.id)).token;

    const examWithPlan = await createExam(
      { examDate: new Date("2026-12-05T09:30:00Z"), session: "FN" },
      "test-actor",
    );
    examWithPlanId = examWithPlan.id;
    await prisma.seatingPlan.create({
      data: { examId: examWithPlanId, version: 1, status: "PUBLISHED", createdBy: admin.id },
    });

    const examNoPlan = await createExam(
      { examDate: new Date("2026-12-05T14:00:00Z"), session: "AN" },
      "test-actor",
    );
    examNoPlanId = examNoPlan.id;

    const registry = new ThrowingRegistry();
    registry.set(genWithPlan, stubResult(examWithPlanId, genWithPlan));
    registry.set(genNoPlan, stubResult(examNoPlanId, genNoPlan));

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

  it("existing published plan -> 200 with the plan", async () => {
    const res = await authedGet(`/exam-seating/generations/${genWithPlan}/seating`, token);
    expect(res.status).toBe(200);
    const body = await jsonBody<{ plan: { id: string; examId: string; status: string } }>(res);
    expect(body.plan.examId).toBe(examWithPlanId);
    expect(body.plan.status).toBe("PUBLISHED");
  });

  it("missing published plan -> intentional 404 PLAN_NOT_FOUND with no internal details", async () => {
    const res = await authedGet(`/exam-seating/generations/${genNoPlan}/seating`, token);
    expect(res.status).toBe(404);
    const body = await jsonBody<{ error: string }>(res);
    expect(body.error).toBe("PLAN_NOT_FOUND");

    const raw = JSON.stringify(body);
    for (const marker of NO_INTERNAL_MARKERS) {
      expect(raw).not.toContain(marker);
    }
  });

  it("missing generation keeps the GENERATION_NOT_FOUND 404 contract", async () => {
    const res = await authedGet("/exam-seating/generations/unknown-id/seating", token);
    expect(res.status).toBe(404);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("GENERATION_NOT_FOUND");
  });

  it("unauthenticated seating request still returns 401", async () => {
    const res = await authedGet(`/exam-seating/generations/${genNoPlan}/seating`, null);
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("unexpected exception still returns sanitized 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await authedGet(`/exam-seating/generations/${FORCED_ID}/seating`, token);
      expect(res.status).toBe(500);
      const body = await jsonBody<{ error: string; message: string }>(res);
      expect(body.error).toBe("INTERNAL_ERROR");
      expect(body.message).toBe("An unexpected error occurred");
      expect(JSON.stringify(body)).not.toContain(INJECTED_MESSAGE);
      const logged = errorSpy.mock.calls.some(
        (call) => call[1] instanceof Error && (call[1] as Error).message === INJECTED_MESSAGE,
      );
      expect(logged).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});