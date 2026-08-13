import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { MemoryDocumentStore, sha256 } from "../src/services/exam-document/upload";
import { extractPdfText } from "../src/services/exam-document/pdf";
import { extractRowsFromText } from "../src/services/exam-document/extract";
import { normalizeRow } from "../src/services/exam-document/normalize";
import { ANNA_UNIVERSITY_TEXT_TABLE_CONFIG, GENERIC_TEXT_TABLE_CONFIG } from "../src/services/exam-document/extractorConfig";
import { annaFixtureLines, buildPdf, buildMultiPagePdf, genericFixtureLines } from "./fixture-pdf";
import { createTestExam, createTestStudent, seededClass } from "./fixtures";
import { ingestExamDocument } from "../src/services/exam-document/ingest";

const ANS = {
  ...ANNA_UNIVERSITY_TEXT_TABLE_CONFIG,
} as const;

describe("sha256 + MemoryDocumentStore", () => {
  it("computes stable sha256 hashes", () => {
    expect(sha256(new Uint8Array([1, 2, 3]))).toBe(sha256(new Uint8Array([1, 2, 3])));
    expect(sha256(new Uint8Array([1, 2, 3]))).not.toBe(sha256(new Uint8Array([1, 2])));
  });

  it("stores, reads, and lists files", async () => {
    const store = new MemoryDocumentStore();
    const data = new Uint8Array([9, 8, 7]);
    await store.put("exams/e1/notes.pdf", data);
    expect(await store.exists("exams/e1/notes.pdf")).toBe(true);
    const read = await store.get("exams/e1/notes.pdf");
    expect(read).not.toBeNull();
    expect(Array.from(read!)).toEqual([9, 8, 7]);
    expect(await store.list()).toEqual(["exams/e1/notes.pdf"]);
    expect((await store.metadata("exams/e1/notes.pdf"))?.sha256).toBe(sha256(data));
    await store.delete("exams/e1/notes.pdf");
    expect(await store.exists("exams/e1/notes.pdf")).toBe(false);
  });
});

describe("PDF text extraction (pdfjs)", () => {
  it("extracts header + candidate lines from a generated PDF", async () => {
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
      { serial: "002", registerNumber: "7330230410002", name: "KAVIN KUMAR P" },
    ]);
    const pdf = await buildPdf(lines);
    const pages = await extractPdfText(pdf);
    const text = pages.map((p) => p.text).join("\n");
    expect(text).toContain("ANNA UNIVERSITY");
    expect(text).toContain("CS8501");
    expect(text).toContain("7330230410001");
    expect(text).toContain("ANANTHA PRIYA S");
  });
});

describe("text -> candidate extraction", () => {
  it("extracts rows, header metadata, and filters header noise", async () => {
    const rows = [
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
      { serial: "002", registerNumber: "7330230410002", name: "KAVIN KUMAR P" },
      { serial: "003", registerNumber: "7330230410003", name: "DINESH BABU R" },
    ];
    const lines = annaFixtureLines(rows);
    const pdf = await buildPdf(lines);
    const pages = await extractPdfText(pdf);
    const result = extractRowsFromText(pages, ANS);

    expect(result.header.subjectCode).toBe("CS8501");
    expect(result.header.subjectName).toBe("THEORY OF COMPUTATION");
    expect(result.header.institutionName).toContain("ANNA UNIVERSITY");
    expect(result.header.regulation).toBe("2021");
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]!.rawRegisterNumber).toBe("7330230410001");
    expect(result.rows[0]!.nameTokens).toContain("ANANTHA");
  });

  it("normalizes register numbers and names", async () => {
    const rows = [
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
      { serial: "002", registerNumber: "7330230410002", name: "kavin kumar p" },
    ];
    const lines = annaFixtureLines(rows);
    const pdf = await buildPdf(lines);
    const pages = await extractPdfText(pdf);
    const result = extractRowsFromText(pages, ANS);

    const normalized = result.rows.map((row, index) => normalizeRow(row, ANS, index));
    expect(normalized[0]!.registerNumber).toBe("7330230410001");
    expect(normalized[0]!.name).toBe("ANANTHA PRIYA S");
    expect(normalized[1]!.name).toBe("KAVIN KUMAR P");
  });

  it("uses the generic config identically", async () => {
    const lines = genericFixtureLines([
      { serial: "01", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
    ]);
    const pdf = await buildPdf(lines);
    const pages = await extractPdfText(pdf);
    const result = extractRowsFromText(pages, GENERIC_TEXT_TABLE_CONFIG);
    expect(result.rows[0]!.rawRegisterNumber).toBe("7330230410001");
  });
});

describe("ingest pipeline (E2E, memory store)", () => {
  let exam: Awaited<ReturnType<typeof createTestExam>>;

  beforeAll(async () => {
    const cls = await seededClass("CSE-A");
    const s1 = await createTestStudent(cls.id, "P");
    const s2 = await createTestStudent(cls.id, "Q");
    await prisma.student.update({
      where: { id: s1.id },
      data: { registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
    });
    await prisma.student.update({
      where: { id: s2.id },
      data: { registerNumber: "7330230410002", name: "KAVIN KUMAR P" },
    });
    exam = await createTestExam();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs full upload -> parse -> validate -> candidate persist", async () => {
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
      { serial: "002", registerNumber: "7330230410002", name: "KAVIN KUMAR P" },
    ]);
    const pdf = await buildPdf(lines);

    const report = await ingestExamDocument(
      exam.id,
      "candidate-list.pdf",
      "application/pdf",
      pdf,
      { store: new MemoryDocumentStore(), storagePath: `exam-documents/${exam.id}/candidate-list.pdf`, actorId: "test-actor" },
    );

    expect(report.finalParseStatus).toBe("PARSED");
    expect(report.duplicate).toBe(false);
    expect(report.counts.extractedRows).toBe(2);
    expect(report.counts.matched).toBe(2);
    expect(report.candidatesPersisted).toBe(2);

    const doc = await prisma.uploadedExamDocument.findFirst({ where: { examId: exam.id } });
    expect(doc).not.toBeNull();
    expect(doc!.parseStatus).toBe("PARSED");
    expect(doc!.fileHash).toHaveLength(64);

    const candidates = await prisma.examCandidate.findMany({
      where: { examId: exam.id },
      orderBy: { registerNumberSnapshot: "asc" },
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.registerNumberSnapshot).toBe("7330230410001");
    expect(candidates[0]!.studentNameSnapshot).toBe("ANANTHA PRIYA S");
    expect(candidates[0]!.validationStatus).toBe("MATCHED");
    expect(candidates[0]!.sourceDocumentId).toBe(doc!.id);
  });

  it("flags unknown registers as NEEDS_REVIEW and persists only matches", async () => {
    const freshExam = await createTestExam();
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
      { serial: "002", registerNumber: "999999999999", name: "UNKNOWN STUDENT X" },
    ]);
    const pdf = await buildPdf(lines);

    const report = await ingestExamDocument(
      freshExam.id,
      "candidate-list-2.pdf",
      "application/pdf",
      pdf,
      { store: new MemoryDocumentStore(), storagePath: `exam-documents/${freshExam.id}/candidate-list-2.pdf`, actorId: "test-actor" },
    );

    expect(report.finalParseStatus).toBe("NEEDS_REVIEW");
    expect(report.duplicate).toBe(false);
    expect(report.counts.matched).toBe(1);
    expect(report.candidatesPersisted).toBe(1);
    expect(report.issuesByCode.STUDENT_NOT_FOUND).toBe(1);
  });
});

describe("document deduplication (examId + fileHash)", () => {
  let exam: Awaited<ReturnType<typeof createTestExam>>;
  let pdfBytes: Uint8Array;

  beforeAll(async () => {
    exam = await createTestExam();
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
    ]);
    pdfBytes = await buildPdf(lines);
  });

  it("first upload is created", async () => {
    const report = await ingestExamDocument(
      exam.id,
      "candidate-list.pdf",
      "application/pdf",
      pdfBytes,
      { store: new MemoryDocumentStore(), storagePath: `exams/${exam.id}/a.pdf`, actorId: "test-actor" },
    );
    expect(report.duplicate).toBe(false);
    const docs = await prisma.uploadedExamDocument.count({ where: { examId: exam.id } });
    expect(docs).toBe(1);
  });

  it("same PDF uploaded again for the same exam is a duplicate", async () => {
    const report = await ingestExamDocument(
      exam.id,
      "candidate-list-renamed.pdf",
      "application/pdf",
      pdfBytes,
      { store: new MemoryDocumentStore(), storagePath: `exams/${exam.id}/b.pdf`, actorId: "test-actor" },
    );
    expect(report.duplicate).toBe(true);
    expect(report.counts.extractedRows).toBe(0);
    expect(report.candidatesPersisted).toBe(0);
    const docs = await prisma.uploadedExamDocument.count({ where: { examId: exam.id } });
    expect(docs).toBe(1);
  });

  it("same content with a different filename is still a duplicate", async () => {
    const report = await ingestExamDocument(
      exam.id,
      "totally-different-name.pdf",
      "application/pdf",
      pdfBytes,
      { store: new MemoryDocumentStore(), storagePath: `exams/${exam.id}/c.pdf`, actorId: "test-actor" },
    );
    expect(report.duplicate).toBe(true);
    const docs = await prisma.uploadedExamDocument.count({ where: { examId: exam.id } });
    expect(docs).toBe(1);
  });

  it("a different PDF for the same exam is allowed", async () => {
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "7330230410002", name: "KAVIN KUMAR P" },
    ]);
    const otherPdf = await buildPdf(lines);
    const report = await ingestExamDocument(
      exam.id,
      "candidate-list-other.pdf",
      "application/pdf",
      otherPdf,
      { store: new MemoryDocumentStore(), storagePath: `exams/${exam.id}/d.pdf`, actorId: "test-actor" },
    );
    expect(report.duplicate).toBe(false);
    const docs = await prisma.uploadedExamDocument.count({ where: { examId: exam.id } });
    expect(docs).toBe(2);
  });

  it("the same PDF uploaded for a different exam is allowed (case B)", async () => {
    const otherExam = await createTestExam();
    const report = await ingestExamDocument(
      otherExam.id,
      "candidate-list.pdf",
      "application/pdf",
      pdfBytes,
      { store: new MemoryDocumentStore(), storagePath: `exams/${otherExam.id}/a.pdf`, actorId: "test-actor" },
    );
    expect(report.duplicate).toBe(false);
    expect(report.counts.extractedRows).toBe(1);
    expect(report.candidatesPersisted).toBe(1);
    const otherDocs = await prisma.uploadedExamDocument.count({ where: { examId: otherExam.id } });
    expect(otherDocs).toBe(1);
    // The same file hash is now present for two different exams — global
    // uniqueness would reject this, but examId+fileHash scoping allows it.
    const rowsWithSameHash = await prisma.uploadedExamDocument.count({
      where: { fileHash: sha256(pdfBytes) },
    });
    expect(rowsWithSameHash).toBe(2);
  });

  it("the examined hash matches sha256(t): handle mismatch/corruption", async () => {
    // Corrupted content: flip a byte -> different hash -> treated as a fresh document.
    const corrupted = pdfBytes.slice();
    corrupted[0] = corrupted[0]! ^ 0xff;
    const digest1 = sha256(pdfBytes);
    const digest2 = sha256(corrupted);
    expect(digest1).not.toBe(digest2);
  });
});

describe("Anna University multi-group extraction", () => {
  it("extracts rows across multiple pages/groups without silently discarding them", async () => {
    const pdf = await buildMultiPagePdf([
      {
        institution: "ANNA UNIVERSITY :: CHENNAI 600 025",
        regulation: "REGULATIONS 2021",
        subjectCode: "CS8501",
        subjectName: "THEORY OF COMPUTATION",
        date: "12.05.2026",
        session: "FN",
        rows: [
          { serial: "001", registerNumber: "7330230410001", name: "ANANTHA PRIYA S" },
          { serial: "002", registerNumber: "7330230410002", name: "KAVIN KUMAR P" },
        ],
      },
      {
        institution: "ANNA UNIVERSITY :: CHENNAI 600 025",
        regulation: "REGULATIONS 2021",
        subjectCode: "CS8602",
        subjectName: "COMPILER DESIGN",
        date: "12.05.2026",
        session: "FN",
        rows: [
          { serial: "001", registerNumber: "7330230410003", name: "DINESH BABU R" },
          { serial: "002", registerNumber: "7330230410004", name: "MEGHA SHARMA V" },
        ],
      },
    ]);

    const pages = await extractPdfText(pdf);
    expect(pages).toHaveLength(2);

    const result = extractRowsFromText(pages, ANS);
    // All rows across both groups must be surfaced, none dropped.
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((r) => r.pageNumber).sort()).toEqual([1, 1, 2, 2]);
    const registers = result.rows.map((r) => r.rawRegisterNumber).sort();
    expect(registers).toEqual([
      "7330230410001",
      "7330230410002",
      "7330230410003",
      "7330230410004",
    ]);
    // Mixed subject codes across groups must be surfaced for review, not silently merged.
    expect(result.warnings.some((w) => w.code === "UNMATCHED_LINE")).toBe(true);
  });

  it("normalizes Anna University register numbers (leading zeros preserved as-is)", async () => {
    const lines = annaFixtureLines([
      { serial: "001", registerNumber: "953022104001", name: "ANANTHA PRIYA S" },
      { serial: "002", registerNumber: "953022104002", name: "KAVIN KUMAR P" },
    ]);
    const pdf = await buildPdf(lines);
    const pages = await extractPdfText(pdf);
    const result = extractRowsFromText(pages, ANS);
    const normalized = result.rows.map((row, index) => normalizeRow(row, ANS, index));
    expect(normalized[0]!.registerNumber).toBe("953022104001");
    expect(normalized[1]!.registerNumber).toBe("953022104002");
  });
});