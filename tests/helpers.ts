import { expect } from "vitest";
import { PrismaClient } from "@prisma/client";

const TABLES = [
  '"auth_sessions"',
  '"users"',
  '"audit_logs"',
  '"seat_assignments"',
  '"seating_plans"',
  '"solve_jobs"',
  '"exam_candidates"',
  '"uploaded_exam_documents"',
  '"students"',
  '"classes"',
  '"departments"',
  '"hall_seats"',
  '"halls"',
] as const;

export async function verifyTestDatabase(prisma: PrismaClient): Promise<void> {
  if (process.env.RUN_TESTS !== "1") {
    throw new Error(
      "Guard: integrity tests must be run through `npm test` (scripts/run-tests.mjs) so the isolated test database is loaded.",
    );
  }
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  const dbName = rows[0]?.name ?? "unknown";
  if (!dbName.toLowerCase().includes("exam_seating_test")) {
    throw new Error(`Guard refused to run tests against non-test database "${dbName}".`);
  }
}

export async function resetTestDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function expectRejected(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow();
}

export async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: "P2002" });
}

export async function expectForeignKeyViolation(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code: "P2003" });
}