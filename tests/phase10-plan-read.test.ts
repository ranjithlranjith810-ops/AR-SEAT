/**
 * Phase 10 — plan-by-id seating read API contract.
 *
 * GET /exam-seating/plans/:seatingPlanId returns a seating plan and its
 * assignments regardless of plan status (DRAFT/APPROVED/PUBLISHED), so the
 * Generation Flow can render a freshly generated DRAFT plan. The route is
 * authenticated to both roles, keeps the intentional 404 PLAN_NOT_FOUND
 * contract, and does NOT change the PUBLISHED-only
 * /exam-seating/generations/:id/seating route.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import { createHall } from "../src/services/hall.service";
import { createExam } from "../src/services/exam.service";
import { createTestStudent, seededClass } from "./fixtures";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";
import type { Server } from "node:http";

const ADMIN_USERNAME = "phase10-plan-admin";
const ADMIN_PASSWORD = "phase10-plan-admin-password-1";
const STAFF_USERNAME = "phase10-plan-staff";
const STAFF_PASSWORD = "phase10-plan-staff-password-1";
const MARKER_DATE = new Date("2026-12-20T09:30:00Z");
const NONCE = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const HALL_PREFIX = `LH-P10P-${NONCE}-`;
const GEN_WITH_DRAFT = "gen-draft-plan";

let adminId: string;
let adminToken: string;
let staffToken: string;
let server: Server;
let baseUrl: string;
let examId: string;
let planId: string;
let studentId: string;
let candidateId: string;
let hallId: string;

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

async function authedGet(path: string, sessionToken: string | null): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: sessionToken ? { Cookie: `ar_seat_session=${sessionToken}` } : {},
  });
}

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("phase10 plan-by-id seating read", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    adminId = admin.id;
    adminToken = (await createSession(adminId)).token;

    const staff = await createUser({ username: STAFF_USERNAME, password: STAFF_PASSWORD, role: "STAFF" });
    staffToken = (await createSession(staff.id)).token;

    const exam = await createExam(
      { examDate: MARKER_DATE, session: "FN" },
      "test-actor",
    );
    examId = exam.id;

    const cls = await seededClass("CSE-A");
    const student = await createTestStudent(cls.id, `P10P-${NONCE}`);
    studentId = student.id;

    const candidate = await prisma.examCandidate.create({
      data: {
        examId,
        studentId,
        registerNumberSnapshot: `REG-${NONCE}-P10P-1`,
        studentNameSnapshot: "Plan Read Student",
        departmentSnapshot: cls.department.code,
        genderSnapshot: "MALE",
        classSnapshot: cls.name,
        subjectCode: "CS8501",
        subjectName: "Theory of Computation",
        validationStatus: "VALIDATED",
      },
    });
    candidateId = candidate.id;

    const hall = await createHall({
      hallNumber: `${HALL_PREFIX}1`,
      name: "Plan Read Hall",
      rows: 1,
      columns: 1,
    });
    hallId = hall.id;
    const seat = await prisma.hallSeat.findFirstOrThrow({ where: { hallId } });

    const plan = await prisma.seatingPlan.create({
      data: { examId, version: 1, status: "DRAFT", createdBy: adminId },
    });
    planId = plan.id;

    await prisma.seatAssignment.create({
      data: {
        seatingPlanId: planId,
        examCandidateId: candidateId,
        hallId,
        hallSeatId: seat.id,
      },
    });

    const registry = new Map<string, GenerationResult>([
      [GEN_WITH_DRAFT, stubResult(GEN_WITH_DRAFT, examId)],
    ]);

    const dispatch = (async () => {
      throw new Error("solver dispatch must never run in plan-read tests");
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

  it("unauthenticated request returns 401", async () => {
    const res = await authedGet(`/exam-seating/plans/${planId}`, null);
    expect(res.status).toBe(401);
    expect((await jsonBody<{ error: string }>(res)).error).toBe("UNAUTHORIZED");
  });

  it("ADMIN can read a DRAFT plan with its assignment", async () => {
    const res = await authedGet(`/exam-seating/plans/${planId}`, adminToken);
    expect(res.status).toBe(200);
    const body = await jsonBody<{
      plan: {
        id: string;
        examId: string;
        version: number;
        status: string;
        assignments: Array<{
          examCandidate: { registerNumberSnapshot: string };
          hall: { hallNumber: string };
          hallSeat: { seatPosition: string };
        }>;
      };
    }>(res);
    expect(body.plan.id).toBe(planId);
    expect(body.plan.examId).toBe(examId);
    expect(body.plan.status).toBe("DRAFT");
    expect(body.plan.version).toBe(1);
    expect(body.plan.assignments).toHaveLength(1);
    expect(body.plan.assignments[0]!.examCandidate.registerNumberSnapshot).toBe(
      `REG-${NONCE}-P10P-1`,
    );
    expect(body.plan.assignments[0]!.hall.hallNumber).toBe(`${HALL_PREFIX}1`);
    expect(body.plan.assignments[0]!.hallSeat.seatPosition).toBe("A1");
  });

  it("STAFF can read a DRAFT plan (both authenticated roles)", async () => {
    const res = await authedGet(`/exam-seating/plans/${planId}`, staffToken);
    expect(res.status).toBe(200);
    const body = await jsonBody<{ plan: { id: string; status: string } }>(res);
    expect(body.plan.id).toBe(planId);
    expect(body.plan.status).toBe("DRAFT");
  });

  it("unknown plan id -> intentional 404 PLAN_NOT_FOUND with no internal details", async () => {
    const res = await authedGet("/exam-seating/plans/unknown-plan-id", adminToken);
    expect(res.status).toBe(404);
    const raw = JSON.stringify(await jsonBody<{ error: string }>(res));
    expect((JSON.parse(raw) as { error: string }).error).toBe("PLAN_NOT_FOUND");
    for (const marker of ["prisma", "schema.prisma", "D:\\", "at "]) {
      expect(raw).not.toContain(marker);
    }
  });

  it("DRAFT plan is readable here while the PUBLISHED-only route still 404s", async () => {
    const publishedOnly = await authedGet(
      `/exam-seating/generations/${GEN_WITH_DRAFT}/seating`,
      adminToken,
    );
    expect(publishedOnly.status).toBe(404);
    expect((await jsonBody<{ error: string }>(publishedOnly)).error).toBe("PLAN_NOT_FOUND");

    const byId = await authedGet(`/exam-seating/plans/${planId}`, adminToken);
    expect(byId.status).toBe(200);
  });
});