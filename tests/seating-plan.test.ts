import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectUniqueViolation } from "./helpers";
import { createTestExam } from "./fixtures";
import {
  approvePlan,
  createPlan,
  getLatestVersion,
  publishPlan,
} from "../src/services/seatingPlan.service";

describe("SeatingPlan", () => {
  it("assigns an automatically incrementing version per exam", async () => {
    const exam = await createTestExam();
    const v1 = await createPlan(exam.id, "test-actor");
    const v2 = await createPlan(exam.id, "test-actor");
    const v3 = await createPlan(exam.id, "test-actor");
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);
    expect(await getLatestVersion(exam.id)).toBe(3);
  });

  it("keeps every historical version available instead of overwriting", async () => {
    const exam = await createTestExam();
    const v1 = await createPlan(exam.id, "test-actor");
    await createPlan(exam.id, "test-actor");

    const all = await prisma.seatingPlan.findMany({
      where: { examId: exam.id },
      orderBy: { version: "asc" },
    });
    expect(all.map((p) => p.version)).toEqual([1, 2]);
    expect(all[0]!.status).toBe("SUPERSEDED");
    expect(v1.id).toBeDefined();
    const historical = await prisma.seatingPlan.findUnique({ where: { id: v1.id } });
    expect(historical).not.toBeNull();
  });

  it("supersedes the previous plan and links via supersedesPlanId", async () => {
    const exam = await createTestExam();
    const v1 = await createPlan(exam.id, "test-actor");
    const v2 = await createPlan(exam.id, "test-actor");

    const superseded = await prisma.seatingPlan.findUniqueOrThrow({ where: { id: v1.id } });
    expect(superseded.status).toBe("SUPERSEDED");
    expect(v2.supersedesPlanId).toBe(v1.id);
  });

  it("moves a plan through DRAFT -> APPROVED -> PUBLISHED", async () => {
    const exam = await createTestExam();
    const plan = await createPlan(exam.id, "test-actor");
    const approved = await approvePlan(plan.id, "approver");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).not.toBeNull();
    const published = await publishPlan(plan.id, "publisher");
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).not.toBeNull();
  });

  it("enforces a unique (examId, version) combination", async () => {
    const exam = await createTestExam();
    const plan = await createPlan(exam.id, "test-actor");
    await expectUniqueViolation(
      prisma.seatingPlan.create({
        data: {
          examId: exam.id,
          version: plan.version,
          status: "DRAFT",
        },
      }),
    );
  });

  it("allows only one PUBLISHED plan per exam", async () => {
    const exam = await createTestExam();
    const v1 = await createPlan(exam.id, "test-actor");
    const v2 = await createPlan(exam.id, "test-actor");
    await approvePlan(v2.id, "approver");
    await publishPlan(v2.id, "publisher");

    const publishedCount = await prisma.seatingPlan.count({
      where: { examId: exam.id, status: "PUBLISHED" },
    });
    expect(publishedCount).toBe(1);

    await expectUniqueViolation(
      prisma.seatingPlan.update({
        where: { id: v1.id },
        data: { status: "PUBLISHED" },
      }),
    );
  });

  it("publishing supersedes any other PUBLISHED plan for the same exam", async () => {
    const exam = await createTestExam();
    const v1 = await createPlan(exam.id, "test-actor");
    await approvePlan(v1.id, "approver");
    await publishPlan(v1.id, "publisher");

    const v2 = await createPlan(exam.id, "test-actor"); // supersedes published v1
    const v3 = await createPlan(exam.id, "test-actor"); // supersedes draft v2
    await approvePlan(v3.id, "approver");
    await publishPlan(v3.id, "publisher");

    const rows = await prisma.seatingPlan.findMany({
      where: { examId: exam.id },
      orderBy: { version: "asc" },
    });
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.status)).toEqual(["SUPERSEDED", "SUPERSEDED", "PUBLISHED"]);
    expect(v1.id !== v2.id && v2.id !== v3.id).toBe(true);
  });

  it("rejects approving or publishing a SUPERSEDED plan", async () => {
    const exam = await createTestExam();
    const v1 = await createPlan(exam.id, "test-actor");
    await createPlan(exam.id, "test-actor"); // supersedes v1
    await expect(approvePlan(v1.id, "approver")).rejects.toThrow();
    await expect(publishPlan(v1.id, "publisher")).rejects.toThrow();
  });
});