import { CandidateValidationStatus } from "@prisma/client";
import { prisma } from "../../db";
import { SeatingError } from "../../errors";
import { logAudit } from "../audit.service";
import { extractRowsFromText } from "./extract";
import { ANNA_UNIVERSITY_TEXT_TABLE_CONFIG } from "./extractorConfig";
import { normalizeRow } from "./normalize";
import { extractPdfText } from "./pdf";
import {
  CandidateValidationOutcome,
  ExtractorConfig,
  FinalParseStatus,
  IngestReport,
  NormalizedCandidate,
} from "./types";
import { MemoryDocumentStore, SupabaseDocumentStore, sha256 } from "./upload";
import { lookupStudents, normalizeInput } from "./validate";
import {
  findDuplicateDocument,
  markFailed,
  markNeedsReview,
  markParsed,
  markProcessing,
  markRejected,
  registerDocument,
} from "./document.service";

export interface IngestOptions {
  actorId?: string;
  format?: ExtractorConfig;
  storagePath?: string;
  store?: MemoryDocumentStore | SupabaseDocumentStore;
}

export async function ingestExamDocument(
  examId: string,
  fileName: string,
  mimeType: string,
  fileBytes: Uint8Array,
  options: IngestOptions = {},
): Promise<IngestReport> {
  const format = options.format ?? ANNA_UNIVERSITY_TEXT_TABLE_CONFIG;
  const store = options.store ?? resolveStore(mimeType);

  try {
    const existing = await findDuplicateDocument(examId, sha256(fileBytes));
    if (existing) {
      return {
        documentId: existing.id,
        finalParseStatus: existing.parseStatus as FinalParseStatus,
        counts: { extractedRows: 0, normalized: 0, validated: 0, matched: 0, rejected: 0 },
        issuesByCode: {},
        candidatesPersisted: 0,
        header: {},
        warnings: [],
        duplicate: true,
        existingDocumentId: existing.id,
      };
    }

    const storagePath =
      options.storagePath ?? buildStoragePath(examId, fileName);
    await store.put(storagePath, fileBytes);

    const document = await registerDocument(
      {
        examId,
        fileName,
        mimeType,
        fileBytes,
        storagePath,
        uploadedBy: options.actorId,
      },
      options.actorId,
    );
    const record = document.document;
    await markProcessing(record.id, options.actorId);

    const pages = await extractPdfText(fileBytes);
    const extraction = extractRowsFromText(pages, format);

    const normalized: NormalizedCandidate[] = extraction.rows.map((row, index) => {
      const result = normalizeRow(row, format, index);
      return {
        rowIndex: result.index,
        pageNumber: row.pageNumber,
        registerNumber: result.registerNumber,
        name: result.name,
      };
    });

    const students = await lookupStudents(normalized.map((row) => row.registerNumber));
    const outcomes = normalizeInput(normalized, students);

    const matched = outcomes.filter((outcome) => !outcome.blocking && outcome.studentId);
    const validated = matched;
    const rejected = outcomes.filter((outcome) => outcome.blocking);

    const existingCandidates = await prisma.examCandidate.findMany({
      where: { examId },
      select: { registerNumberSnapshot: true },
    });
    const existingRegisterNumbers = new Set(existingCandidates.map((c) => c.registerNumberSnapshot));

    let shouldRejectDuplicateInExam = false;
    const upsertedCandidateIds: string[] = [];
    for (const outcome of matched) {
      if (!outcome.studentId) continue;
      if (existingRegisterNumbers.has(outcome.registerNumber)) {
        outcome.issues.push({
          code: "DUPLICATE_IN_EXAM",
          detail: "register number already exists for this exam",
        });
        outcome.blocking = true;
        outcome.status = "REJECTED";
        rejected.push(outcome);
        shouldRejectDuplicateInExam = true;
        continue;
      }
      const upserted = await upsertCandidate(
        examId,
        outcome,
        { id: record.id, examId, fileName },
        extraction.header.subjectCode,
        extraction.header.subjectName,
        options.actorId,
      );
      upsertedCandidateIds.push(upserted);
      existingRegisterNumbers.add(outcome.registerNumber);
    }

    const counts = {
      extractedRows: extraction.rows.length,
      normalized: normalized.length,
      validated: validated.length,
      matched: upsertedCandidateIds.length,
      rejected: rejected.length,
    };

    const finalStatus = resolveFinalStatus(extraction.warnings.length > 0, counts);
    await commitParseStatus(
      record.id,
      finalStatus,
      upsertedCandidateIds,
      extraction.warnings,
      outcomes,
      options.actorId,
    );

    const issuesByCode: Record<string, number> = {};
    for (const outcome of outcomes) {
      for (const issue of outcome.issues) {
        issuesByCode[issue.code] = (issuesByCode[issue.code] ?? 0) + 1;
      }
    }
    if (shouldRejectDuplicateInExam) {
      issuesByCode.DUPLICATE_IN_EXAM = (issuesByCode.DUPLICATE_IN_EXAM ?? 0) + 1;
    }

    return {
      documentId: record.id,
      finalParseStatus: finalStatus,
      counts,
      issuesByCode,
      candidatesPersisted: upsertedCandidateIds.length,
      header: extraction.header,
      warnings: extraction.warnings,
      duplicate: false,
      existingDocumentId: undefined,
    };
  } catch (error) {
    if (error instanceof SeatingError && error.code === "DOCUMENT_NOT_FOUND") {
      throw error;
    }
    const storagePath = options.storagePath ?? buildStoragePath(examId, fileName);
    const document = await prisma.uploadedExamDocument.findFirst({
      where: { examId, storagePath },
    });
    if (document) {
      await markFailed(document.id, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

function buildStoragePath(examId: string, fileName: string): string {
  return `exams/${examId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

function resolveStore(mimeType: string): MemoryDocumentStore | SupabaseDocumentStore {
  // Writes into the private bucket require the service role key. Without it
  // (tests/CI, local development) we stage documents in memory instead.
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (mimeType === "application/pdf" && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseDocumentStore(bucket ?? "exam-documents");
  }
  return new MemoryDocumentStore();
}

async function upsertCandidate(
  examId: string,
  outcome: CandidateValidationOutcome,
  document: { id: string; examId: string; fileName: string },
  subjectCode: string | undefined,
  subjectName: string | undefined,
  actorId?: string,
): Promise<string> {
  const student = await prisma.student.findUnique({
    where: { id: outcome.studentId },
    include: { class: { include: { department: true } } },
  });
  if (!student) {
    throw new SeatingError("Student master record missing during upsert", "STUDENT_NOT_FOUND");
  }
  const candidate = await prisma.examCandidate.upsert({
    where: {
      examId_registerNumberSnapshot: {
        examId,
        registerNumberSnapshot: outcome.registerNumber,
      },
    },
    create: {
      examId,
      studentId: student.id,
      sourceDocumentId: document.id,
      registerNumberSnapshot: outcome.registerNumber,
      studentNameSnapshot: student.name,
      departmentSnapshot: student.class.department.code,
      genderSnapshot: student.gender,
      classSnapshot: student.class.name,
      subjectCode: subjectCode ?? "UNKNOWN",
      subjectName: subjectName ?? "UNKNOWN",
      validationStatus: "MATCHED" as CandidateValidationStatus,
    },
    update: {
      sourceDocumentId: document.id,
      validationStatus: "MATCHED" as CandidateValidationStatus,
    },
  });
  if ((candidate as { validationStatus?: string }).validationStatus === "MATCHED") {
    await logAudit({
      action: "CANDIDATE_MATCHED",
      entityType: "ExamCandidate",
      entityId: candidate.id,
      actorId,
      metadata: { sourceDocumentId: document.id, fileName: document.fileName },
    });
  }
  return candidate.id;
}

async function commitParseStatus(
  documentId: string,
  status: FinalParseStatus,
  candidateIds: string[],
  warnings: { code: string; detail: string }[],
  outcomes: CandidateValidationOutcome[],
  actorId?: string,
): Promise<void> {
  if (status === "PARSED" || status === "NEEDS_REVIEW" || status === "REJECTED") {
    const issues = summarizeIssues(outcomes);
    if (status === "PARSED") {
      await markParsed(documentId, candidateIds, actorId, { warnings, issues });
    } else if (status === "NEEDS_REVIEW") {
      await markNeedsReview(documentId, { warnings, issues }, actorId);
    } else {
      await markRejected(documentId, Object.keys(issues).join(", "), actorId);
    }
  }
}

function summarizeIssues(outcomes: CandidateValidationOutcome[]) {
  const byCode: Record<string, number> = {};
  for (const outcome of outcomes) {
    for (const issue of outcome.issues) {
      byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
    }
  }
  return byCode;
}

function resolveFinalStatus(
  hasExtractionWarnings: boolean,
  counts: { extractedRows: number; normalized: number; validated: number; matched: number; rejected: number },
): FinalParseStatus {
  if (hasExtractionWarnings) return "NEEDS_REVIEW";
  if (counts.matched === 0) return "REJECTED";
  if (counts.extractedRows > counts.matched) return "NEEDS_REVIEW";
  return "PARSED";
}