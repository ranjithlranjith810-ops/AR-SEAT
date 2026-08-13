import { SeatingPlanStatus } from "@prisma/client";
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "./audit.service";

const PLAN_TRANSITIONS: Record<SeatingPlanStatus, SeatingPlanStatus[]> = {
  DRAFT: ["APPROVED", "SUPERSEDED"],
  APPROVED: ["PUBLISHED", "SUPERSEDED"],
  PUBLISHED: ["SUPERSEDED"],
  SUPERSEDED: [],
};

export function assertPlanTransition(from: SeatingPlanStatus, to: SeatingPlanStatus): void {
  if (!PLAN_TRANSITIONS[from].includes(to)) {
    throw new SeatingError(
      `Invalid seating plan status transition: ${from} -> ${to}`,
      "INVALID_PLAN_STATUS_TRANSITION",
    );
  }
}

export async function getPlan(id: string) {
  const plan = await prisma.seatingPlan.findUnique({ where: { id } });
  if (!plan) throw new SeatingError("SeatingPlan not found", "PLAN_NOT_FOUND");
  return plan;
}

export async function getLatestVersion(examId: string): Promise<number> {
  const latest = await prisma.seatingPlan.findFirst({
    where: { examId },
    orderBy: { version: "desc" },
  });
  return latest ? latest.version : 0;
}

export async function createPlan(examId: string, createdBy?: string) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.seatingPlan.findFirst({
      where: { examId },
      orderBy: { version: "desc" },
    });
    if (latest && latest.status !== "SUPERSEDED") {
      await tx.seatingPlan.update({
        where: { id: latest.id },
        data: { status: "SUPERSEDED" },
      });
      await tx.auditLog.create({
        data: {
          action: "PLAN_SUPERSEDED",
          entityType: "SeatingPlan",
          entityId: latest.id,
          actorId: createdBy ?? null,
        },
      });
    }
    const version = latest ? latest.version + 1 : 1;
    return tx.seatingPlan.create({
      data: {
        examId,
        version,
        status: "DRAFT",
        supersedesPlanId: latest?.id ?? null,
        createdBy: createdBy ?? null,
      },
    });
  });
}

export async function approvePlan(id: string, approvedBy?: string) {
  const plan = await getPlan(id);
  assertPlanTransition(plan.status, "APPROVED");
  const updated = await prisma.seatingPlan.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: approvedBy ?? null, approvedAt: new Date() },
  });
  await logAudit({
    action: "PLAN_APPROVED",
    entityType: "SeatingPlan",
    entityId: id,
    actorId: approvedBy,
  });
  return updated;
}

export async function publishPlan(id: string, publishedBy?: string) {
  const plan = await getPlan(id);
  assertPlanTransition(plan.status, "PUBLISHED");

  const otherPublished = await prisma.seatingPlan.findFirst({
    where: { examId: plan.examId, status: "PUBLISHED", id: { not: plan.id } },
  });
  if (otherPublished) {
    await prisma.seatingPlan.update({
      where: { id: otherPublished.id },
      data: { status: "SUPERSEDED" },
    });
    await logAudit({
      action: "PLAN_SUPERSEDED",
      entityType: "SeatingPlan",
      entityId: otherPublished.id,
      actorId: publishedBy,
    });
  }

  const updated = await prisma.seatingPlan.update({
    where: { id },
    data: { status: "PUBLISHED", publishedBy: publishedBy ?? null, publishedAt: new Date() },
  });
  await logAudit({
    action: "PLAN_PUBLISHED",
    entityType: "SeatingPlan",
    entityId: id,
    actorId: publishedBy,
  });
  return updated;
}

export async function supersedePlan(id: string, actorId?: string) {
  const plan = await getPlan(id);
  assertPlanTransition(plan.status, "SUPERSEDED");
  const updated = await prisma.seatingPlan.update({
    where: { id },
    data: { status: "SUPERSEDED" },
  });
  await logAudit({
    action: "PLAN_SUPERSEDED",
    entityType: "SeatingPlan",
    entityId: id,
    actorId,
  });
  return updated;
}