/**
 * Phase 8 — publication-race / concurrency correctness.
 *
 * Threat-model question: can two concurrent completions both pass the
 * "no published plan" gate, producing duplicate plan versions, two PUBLISHED
 * plans, or two active solve jobs for one exam?
 *
 * These tests settle the question empirically: the gates are DB-enforced
 * (partial unique indexes + @@unique([examId, version]) from the init
 * migration), NOT merely app-level findFirst checks. Under real concurrency
 * the losers are rejected by the database (P2002) or safely serialized,
 * and the invariants always hold.
 */
import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { createTestExam } from "./fixtures";
import { createPlan, publishPlan } from "../src/services/seatingPlan.service";
import { requestSolve } from "../src/services/solveJob.service";

const PUBLISHED_GATE_INDEX = "seating_plans_one_published_per_exam";
const ACTIVE_JOB_GATE_INDEX = "solve_jobs_one_active_per_exam";

describe("Phase 8 publication-race / concurrency correctness", () => {
  it("the concurrency gates exist as database indexes (not just app-level)", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN (${PUBLISHED_GATE_INDEX}, ${ACTIVE_JOB_GATE_INDEX})
    `;
    const names = rows.map((r) => r.indexname);
    expect(names).toContain(PUBLISHED_GATE_INDEX);
    expect(names).toContain(ACTIVE_JOB_GATE_INDEX);
  });

  it("concurrent completion cannot allocate duplicate plan versions (DB @@unique(examId, version))", async () => {
    const exam = await createTestExam();
    const outcomes = await Promise.allSettled([
      createPlan(exam.id, "runner-a"),
      createPlan(exam.id, "runner-b"),
    ]);

    const versions = await prisma.seatingPlan.findMany({
      where: { examId: exam.id },
      select: { version: true },
    });
    const unique = new Set(versions.map((v) => v.version));
    expect(unique.size).toBe(versions.length);
    expect(versions.length).toBeGreaterThan(0);
    expect(outcomes.some((o) => o.status === "fulfilled")).toBe(true);
  });

  it("concurrent publication leaves exactly one PUBLISHED plan (DB partial unique index)", async () => {
    const exam = await createTestExam();
    const p1 = await prisma.seatingPlan.create({
      data: { examId: exam.id, version: 1, status: "APPROVED" },
    });
    const p2 = await prisma.seatingPlan.create({
      data: { examId: exam.id, version: 2, status: "APPROVED" },
    });

    const outcomes = await Promise.allSettled([
      publishPlan(p1.id, "publisher-a"),
      publishPlan(p2.id, "publisher-b"),
    ]);

    const published = await prisma.seatingPlan.findMany({
      where: { examId: exam.id, status: "PUBLISHED" },
      select: { id: true, status: true },
    });
    expect(published.length).toBe(1);
    expect(outcomes.some((o) => o.status === "fulfilled")).toBe(true);
  });

  it("concurrent solve requests create at most one active job (DB partial unique index)", async () => {
    const exam = await createTestExam();
    const outcomes = await Promise.allSettled([
      requestSolve({ examId: exam.id }),
      requestSolve({ examId: exam.id }),
    ]);

    const active = await prisma.solveJob.count({
      where: { examId: exam.id, status: { in: ["QUEUED", "RUNNING"] } },
    });
    expect(active).toBe(1);

    const created = outcomes.filter(
      (o) => o.status === "fulfilled" && o.value.created === true,
    );
    expect(created.length).toBe(1);
  });
});