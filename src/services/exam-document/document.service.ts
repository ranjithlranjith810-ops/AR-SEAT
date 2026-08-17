import { DocumentParseStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { SeatingError } from "../../errors.js";
import { logAudit } from "../audit.service.js";
import { sanitizeFileName, sha256 } from "./upload.js";

export interface RegisterDocumentInput {
  examId: string;
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
  storagePath: string;
  uploadedBy?: string;
}

const PARSE_TRANSITIONS: Record<ParseTransitionable, ParseTransitionable[]> = {
  UPLOADED: ["PROCESSING"],
  PROCESSING: ["PARSED", "NEEDS_REVIEW", "REJECTED", "FAILED"],
  PARSED: ["PROCESSING"],
  NEEDS_REVIEW: ["PROCESSING"],
  REJECTED: [],
  FAILED: [],
};

type ParseTransitionable = Exclude<DocumentParseStatus, "UPLOADED" | "PROCESSING"> | "UPLOADED" | "PROCESSING";

export function assertParseTransition(
  from: DocumentParseStatus,
  to: DocumentParseStatus,
): void {
  const allowed = PARSE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new SeatingError(
      `Invalid parse status transition: ${from} -> ${to}`,
      "INVALID_PARSE_STATUS_TRANSITION",
    );
  }
}

export async function registerDocument(
  input: RegisterDocumentInput,
  actorId?: string,
) {
  const fileHash = sha256(input.fileBytes);
  const existing = await findDuplicateDocument(input.examId, fileHash);
  if (existing) {
    return {
      document: existing,
      created: false,
      duplicate: true,
    };
  }
  const fileName = sanitizeFileName(input.fileName);
  const document = await prisma.uploadedExamDocument.create({
    data: {
      examId: input.examId,
      fileName,
      storagePath: input.storagePath,
      mimeType: input.mimeType,
      fileSize: input.fileBytes.length,
      fileHash,
      parseStatus: "UPLOADED",
      uploadedBy: actorId,
    },
  });
  await logAudit({
    action: "PDF_UPLOADED",
    entityType: "UploadedExamDocument",
    entityId: document.id,
    actorId,
    metadata: { fileName, fileSize: input.fileBytes.length, fileHash },
  });
  return { document, created: true, duplicate: false };
}

export async function findDuplicateDocument(examId: string, fileHash: string) {
  return prisma.uploadedExamDocument.findUnique({
    where: { examId_fileHash: { examId, fileHash } },
  });
}

export async function getDocument(id: string) {
  const document = await prisma.uploadedExamDocument.findUnique({ where: { id } });
  if (!document) {
    throw new SeatingError("UploadedExamDocument not found", "DOCUMENT_NOT_FOUND");
  }
  return document;
}

export async function transitionParseStatus(
  id: string,
  to: DocumentParseStatus,
  actorId?: string,
  metadata?: Prisma.InputJsonValue,
) {
  const document = await getDocument(id);
  assertParseTransition(document.parseStatus, to);
  const updated = await prisma.uploadedExamDocument.update({
    where: { id },
    data: { parseStatus: to, parseMetadata: metadata ?? undefined },
  });
  return updated;
}

export async function markProcessing(id: string, actorId?: string) {
  return transitionParseStatus(id, "PROCESSING", actorId);
}

export async function markParsed(
  id: string,
  candidateIds: string[],
  actorId?: string,
  extraMetadata?: Record<string, unknown>,
) {
  const updated = await transitionParseStatus(id, "PARSED", actorId, {
    candidateIds,
    ...extraMetadata,
  });
  return updated;
}

export async function markNeedsReview(
  id: string,
  issues: Prisma.InputJsonValue,
  actorId?: string,
) {
  return transitionParseStatus(id, "NEEDS_REVIEW", actorId, { issues });
}

export async function markRejected(
  id: string,
  reason: string,
  actorId?: string,
) {
  return transitionParseStatus(id, "REJECTED", actorId, { reason });
}

export async function markFailed(
  id: string,
  error: string,
  actorId?: string,
) {
  return transitionParseStatus(id, "FAILED", actorId, { error });
}