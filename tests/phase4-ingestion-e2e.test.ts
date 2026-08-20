/**
 * Phase 4 — real PDF ingestion end-to-end (spec §24).
 *
 * Unlike phase4-e2e.test.ts (which seeds candidates directly with createMany),
 * this test drives the ACTUAL application ingestion path:
 *
 *   exam PDF (built) -> upload -> pdfjs text extraction -> row extraction ->
 *   normalization -> student-master lookup -> validation -> ExamCandidate DB
 *   synchronization (ingestExamDocument) -> MATCHED -> VALIDATED transition ->
 *   reconciliation -> partition -> worker dispatch (stub) -> authoritative
 *   validation -> merge -> transactional persistence -> Proforma 1 -> PDF
 *   round-trip.
 *
 * No candidate is written to ExamCandidate by hand; every row must originate
 * from the parsed document (sourceDocumentId is always set).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./setup";
import { seededClass } from "./fixtures";
import { createHall } from "../src/services/hall.service";
import { createExam } from "../src/services/exam.service";
import { transitionValidationStatus } from "../src/services/candidate.service";
import { ingestExamDocument } from "../src/services/exam-document/ingest";
import { MemoryDocumentStore } from "../src/services/exam-document/upload";
import { reconcileExamForGeneration } from "../src/phase4/reconcile";
import { runSeatingGeneration } from "../src/phase4/integration";
import { buildProformaInputFromPlan, generateProforma1 } from "../src/phase4/proforma";
import { extractPdfText } from "../src/services/exam-document/pdf";
import { annaFixtureLines, buildPdf } from "./fixture-pdf";
import type { DomainSolveResult, SolverDispatch } from "../src/phase4/types";

const CLASSES = ["CSE-A", "ECE-A"] as const;
const PER_CLASS = 8; // 16 candidates total across two departments.
const INGEST_DATE = new Date("2026-12-01T09:30:00Z");
const NONCE = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const RUN = 100000 + Math.floor(Math.random() * 899999);

const NAMES = [
  "ANANTHA PRIYA S",
  "KAVIN KUMAR P",
  "DINESH BABU R",
  "MEGHA SHARMA V",
  "ARUN RAJ K",
  "LAKSHMI NARAYANAN S",
  "VIGNESH KUMAR M",
  "SANDHIYA R",
  "HARISH RAGAV V",
  "DEEPAK S",
  "NANDHINI DEVI G",
  "SURIYA S",
  "KARTHIK RAJA S",
  "VARSHA R",
  "MOHAMED FAZIL A",
  "JENIFER A",
];

interface IngestRow {
  serial: string;
  registerNumber: string;
  name: string;
  className: string;
}

function buildRows(): IngestRow[] {
  const rows: IngestRow[] = [];
  for (let i = 0; i < PER_CLASS * CLASSES.length; i += 1) {
    rows.push({
      serial: String(i + 1).padStart(3, "0"),
      registerNumber: `${RUN}0${i + 1}`,
      name: NAMES[i]!,
      className: CLASSES[Math.floor(i / PER_CLASS)]!,
    });
  }
  return rows;
}

function stubOptimalDispatch(): SolverDispatch {
  return {
    async solveDomain(payload): Promise<DomainSolveResult> {
      const hall = payload.halls[0]!;
      return {
        requestId: payload.requestId,
        domainId: payload.requestId.split(":")[1]!,
        status: "OPTIMAL",
        assignments: payload.candidates.map((c, i) => ({
          candidateId: c.id,
          hallId: hall.id,
          hallSeatId: hall.seats[i]!.id,
        })),
        solverDurationMs: 8,
        candidateCount: payload.candidateCount,
        assignedCount: payload.candidateCount,
        unassignedCount: 0,
        reportedObjective: 0,
        rawSolverObjective: 0,
        validatorObjective: 0,
        infeasibilityReason: null,
        errorCode: null,
        errorMessage: null,
      };
    },
  };
}

function extractDigitRegisterNumbers(text: string): string[] {
  const tokens = text.split(/\s+/);
  return [...new Set(tokens.filter((t) => /^\d{6,14}$/.test(t)))].sort();
}

async function cleanUpIngestionMarkers(): Promise<void> {
  const exams = await prisma.exam.findMany({
    where: { examDate: { gte: INGEST_DATE, lt: new Date(INGEST_DATE.getTime() + 86400000) } },
    select: { id: true },
  });
  const examIds = exams.map((e) => e.id);
  if (examIds.length > 0) {
    await prisma.seatAssignment.deleteMany({ where: { seatingPlan: { examId: { in: examIds } } } });
    await prisma.seatingPlan.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.solveJob.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.examCandidate.deleteMany({ where: { examId: { in: examIds } } });
    await prisma.uploadedExamDocument.deleteMany({ where: { examId: { in: examIds } } });
    const students = await prisma.student.findMany({
      where: { registerNumber: { startsWith: String(RUN) } },
      select: { id: true },
    });
    if (students.length > 0) {
      await prisma.student.deleteMany({ where: { id: { in: students.map((s) => s.id) } } });
    }
    // Exam rows are soft-delete protected by a DB trigger — leave them.
  }
  const halls = await prisma.hall.findMany({
    where: { hallNumber: { startsWith: "LH-ING-" } },
    select: { id: true },
  });
  const hallIds = halls.map((h) => h.id);
  if (hallIds.length > 0) {
    await prisma.hallSeat.deleteMany({ where: { hallId: { in: hallIds } } });
    await prisma.hall.deleteMany({ where: { id: { in: hallIds } } });
  }
}

describe("phase4 real-ingestion end-to-end pipeline (spec §24)", () => {
  beforeEach(async () => {
    await cleanUpIngestionMarkers();
  });

  it(
    "ingests an exam PDF, validates against the student master, and runs the full seating generation without direct DB seeding",
    async () => {
      const rows = buildRows();
      const classes = new Map<string, Awaited<ReturnType<typeof seededClass>>>(
        await Promise.all(CLASSES.map(async (name) => [name, await seededClass(name)] as const)),
      );

      // Student master: the authoritative records the PDF is validated against.
      await prisma.student.createMany({
        data: rows.map((r, i) => ({
          name: r.name,
          rollNumber: `R-ING-${NONCE}-${i}`,
          registerNumber: r.registerNumber,
          gender: "MALE",
          classId: classes.get(r.className)!.id,
          status: "ACTIVE",
        })),
      });
      const students = await prisma.student.findMany({
        where: { registerNumber: { in: rows.map((r) => r.registerNumber) } },
        select: { id: true, registerNumber: true },
      });
      expect(students).toHaveLength(rows.length);

      // Physical halls for the session (two disconnected components).
      const halls = [];
      for (let i = 0; i < 2; i += 1) {
        halls.push(
          await createHall({
            hallNumber: `LH-ING-${NONCE}-${i}`,
            name: `Ingestion Hall ${i}`,
            rows: 5,
            columns: 5,
          }),
        );
      }

      const exam = await createExam({ examDate: INGEST_DATE, session: "FN" }, "test-actor");

      // §5 — the REAL upload -> extract -> validate -> DB-sync path.
      const pdf = await buildPdf(
        annaFixtureLines(rows.map((r) => ({ serial: r.serial, registerNumber: r.registerNumber, name: r.name }))),
      );
      const report = await ingestExamDocument(
        exam.id,
        "candidate-list.pdf",
        "application/pdf",
        pdf,
        {
          store: new MemoryDocumentStore(),
          storagePath: `exam-documents/${exam.id}/candidate-list.pdf`,
          actorId: "test-actor",
        },
      );

      expect(report.duplicate).toBe(false);
      expect(report.finalParseStatus).toBe("PARSED");
      expect(report.counts.extractedRows).toBe(rows.length);
      expect(report.counts.matched).toBe(rows.length);
      expect(report.counts.rejected).toBe(0);
      expect(report.candidatesPersisted).toBe(rows.length);
      expect(report.issuesByCode).toEqual({});
      expect(report.header.subjectCode).toBe("CS8501");
      expect(report.header.session).toBe("FN");

      const doc = await prisma.uploadedExamDocument.findFirst({ where: { examId: exam.id } });
      expect(doc).not.toBeNull();
      expect(doc!.parseStatus).toBe("PARSED");
      expect(doc!.fileHash).toHaveLength(64);

      // Every ExamCandidate row must come from the parsed document.
      let candidates = await prisma.examCandidate.findMany({
        where: { examId: exam.id },
        orderBy: { registerNumberSnapshot: "asc" },
      });
      expect(candidates).toHaveLength(rows.length);
      for (const candidate of candidates) {
        expect(candidate.sourceDocumentId).toBe(doc!.id);
        expect(candidate.validationStatus).toBe("MATCHED");
        const expected = rows.find((r) => r.registerNumber === candidate.registerNumberSnapshot)!;
        expect(candidate.studentNameSnapshot).toBe(expected.name);
        expect(candidate.departmentSnapshot).toBe(classes.get(expected.className)!.department.code);
      }

      // §5 validation step: confirm the parsed candidates, then seat them.
      for (const candidate of candidates) {
        await transitionValidationStatus(candidate.id, "VALIDATED", "test-actor");
      }
      candidates = await prisma.examCandidate.findMany({
        where: { examId: exam.id, validationStatus: "VALIDATED" },
      });
      expect(candidates).toHaveLength(rows.length);

      // §6/§7 — reconciliation + session identity before any dispatch.
      const reconciled = await reconcileExamForGeneration(exam.id);
      expect(reconciled.ok).toBe(true);
      expect(reconciled.candidateCount).toBe(rows.length);
      expect(reconciled.validatedCount).toBe(rows.length);
      expect(reconciled.nonValidated).toEqual([]);
      expect(reconciled.duplicateRegisterNumbers).toEqual([]);
      expect(reconciled.session.examId).toBe(exam.id);
      expect(reconciled.session.timeSlot).toBe("FN");
      expect(reconciled.session.examDate).toBe(exam.examDate.toISOString());

      // Full orchestration over the ingested candidates (stub dispatch keeps
      // the suite hermetic; the pipeline under test is unchanged).
      const output = await runSeatingGeneration({
        examId: exam.id,
        requestedBy: "test-actor",
        timeLimitSeconds: 30,
        maxParallelDomains: 4,
        solverConfig: { policyMode: "DEPARTMENT_ONLY" },
        dispatch: stubOptimalDispatch(),
      });

      expect(output.jobCreated).toBe(true);
      const { result } = output;
      expect(result.state).toBe("COMPLETED");
      expect(result.session?.timeSlot).toBe("FN");
      expect(result.sessionCandidateCount).toBe(rows.length);
      expect(result.merge?.valid).toBe(true);
      expect(result.merge?.assignedCandidateCount).toBe(rows.length);
      expect(result.completedDomainCount).toBe(result.domainCount);
      expect(result.failedDomainCount).toBe(0);
      expect(result.plan?.assignedCount).toBe(rows.length);
      expect(result.plan?.unassignedCount).toBe(0);
      expect(result.plan?.seatingPlanId).toBeTruthy();

      // §13 — transactional persistence: one assignment per candidate.
      const plan = await prisma.seatingPlan.findUniqueOrThrow({
        where: { id: result.plan!.seatingPlanId! },
        include: {
          assignments: {
            include: { examCandidate: true, hall: true, hallSeat: true },
          },
        },
      });
      expect(plan.status).toBe("DRAFT");
      expect(plan.version).toBe(1);
      expect(plan.assignments).toHaveLength(rows.length);
      const seatIds = plan.assignments.map((a) => a.hallSeatId);
      expect(new Set(seatIds).size).toBe(rows.length);
      for (const assignment of plan.assignments) {
        expect(assignment.examCandidate.sourceDocumentId).toBe(doc!.id);
      }

      const savedJob = await prisma.solveJob.findUniqueOrThrow({ where: { id: output.jobId } });
      expect(savedJob.status).toBe("SUCCEEDED");
      expect(savedJob.assignedCount).toBe(rows.length);
      expect(savedJob.unassignedCount).toBe(0);

      // §18/§19 — Proforma 1 from the persisted plan, then PDF round-trip.
      const proformaInput = buildProformaInputFromPlan(exam, plan);
      const proforma = await generateProforma1(proformaInput);
      expect(proforma.pageCount).toBeGreaterThanOrEqual(1);

      const pages = await extractPdfText(proforma.pdf);
      const allText = pages.map((p) => p.text).join("\n");
      expect(allText).toContain("PROFORMA - 1");
      expect(allText).toContain("GRAND TOTAL");

      const pdfRegisters = extractDigitRegisterNumbers(allText);
      const persistedRegisters = plan.assignments
        .map((a) => a.examCandidate.registerNumberSnapshot)
        .sort();
      expect(pdfRegisters).toEqual(persistedRegisters);
    },
    240000,
  );
});