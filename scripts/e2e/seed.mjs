/**
 * Phase 14 — E2E database seed.
 *
 * Idempotent seed for the local E2E database:
 *   - student/class/hall master (prisma/seed.ts)
 *   - one exam for the golden-path UI upload (fresh candidates via upload)
 *   - one exam + pre-ingested PARSED document for role-gating/auth read paths
 *   - ADMIN + STAFF users
 *
 * Writes E2E_SEED_STATE to a JSON file consumed by the Playwright specs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../src/db.ts";
import { seedDatabase } from "../../prisma/seed.ts";
import { createExam } from "../../src/services/exam.service.ts";
import { createUser } from "../../src/phase4/auth/users.ts";
import { ingestExamDocument } from "../../src/services/exam-document/ingest.ts";
import { annaFixtureLines, buildPdf } from "../../tests/fixture-pdf.ts";

const E2E_ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? "e2e-admin";
const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2e-password-1";
const E2E_STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? "e2e-staff";
const E2E_STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? "e2e-password-1";

const GOLDEN_PATH_ROWS = [
  { serial: "1", registerNumber: "DEMO-CSE-001", name: "Student 001" },
  { serial: "2", registerNumber: "DEMO-CSE-002", name: "Student 002" },
  { serial: "3", registerNumber: "DEMO-CSE-003", name: "Student 003" },
  { serial: "4", registerNumber: "DEMO-CSE-004", name: "Student 004" },
  { serial: "5", registerNumber: "DEMO-CSE-007", name: "Student 007" },
  { serial: "6", registerNumber: "DEMO-CSE-008", name: "Student 008" },
  { serial: "7", registerNumber: "DEMO-ECE-001", name: "Student 013" },
  { serial: "8", registerNumber: "DEMO-ECE-002", name: "Student 014" },
  { serial: "9", registerNumber: "DEMO-EEE-001", name: "Student 019" },
  { serial: "10", registerNumber: "DEMO-EEE-002", name: "Student 020" },
  { serial: "11", registerNumber: "DEMO-MECH-001", name: "Student 025" },
  { serial: "12", registerNumber: "DEMO-MECH-002", name: "Student 026" },
];

async function upsertUser(username, password, role) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return existing;
  return createUser({ username, password, role });
}

async function main() {
  await seedDatabase(prisma);

  const goldenExam = await createExam({
    examDate: new Date("2026-05-12T00:00:00Z"),
    session: "FN",
    examType: "UNIVERSITY",
  });

  const roleExam = await createExam({
    examDate: new Date("2026-05-13T00:00:00Z"),
    session: "AN",
    examType: "UNIVERSITY",
  });

  const rolePdf = await buildPdf(
    annaFixtureLines(
      [
        { serial: "1", registerNumber: "DEMO-CSE-005", name: "Student 005" },
        { serial: "2", registerNumber: "DEMO-CSE-006", name: "Student 006" },
      ],
      { date: "13.05.2026", session: "AN" },
    ),
  );
  const roleReport = await ingestExamDocument(
    roleExam.id,
    "role-gating-fixture.pdf",
    "application/pdf",
    new Uint8Array(rolePdf),
    { actorId: undefined },
  );

  const admin = await upsertUser(E2E_ADMIN_USERNAME, E2E_ADMIN_PASSWORD, "ADMIN");
  const staff = await upsertUser(E2E_STAFF_USERNAME, E2E_STAFF_PASSWORD, "STAFF");

  const state = {
    admin: { username: admin.username, password: E2E_ADMIN_PASSWORD },
    staff: { username: staff.username, password: E2E_STAFF_PASSWORD },
    goldenExam: { id: goldenExam.id },
    roleExam: { id: roleExam.id },
    roleDocument: { id: roleReport.documentId, parseStatus: roleReport.finalParseStatus },
  };

  const statePath = process.env.E2E_SEED_STATE ?? path.resolve("e2e", "seed-state.json");
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  console.log(
    `[e2e-seed] goldenExam=${goldenExam.id} roleExam=${roleExam.id} ` +
      `roleDocument=${roleReport.documentId} status=${roleReport.finalParseStatus} ` +
      `admin=${admin.username} staff=${staff.username}`,
  );
  console.log(`[e2e-seed] wrote ${statePath}`);
}

main()
  .catch((error) => {
    console.error("[e2e-seed] failed", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
