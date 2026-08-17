export type Role = "ADMIN" | "STAFF";

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
}

export type DocumentParseStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "PARSED"
  | "NEEDS_REVIEW"
  | "REJECTED"
  | "FAILED";

export interface IngestReport {
  documentId: string;
  finalParseStatus: DocumentParseStatus;
  counts: {
    extractedRows: number;
    normalized: number;
    validated: number;
    matched: number;
    rejected: number;
  };
  issuesByCode: Record<string, number>;
  candidatesPersisted: number;
  header: Record<string, unknown>;
  warnings: Array<{ code: string; detail: string }>;
  duplicate: boolean;
  existingDocumentId?: string;
  fileName: string;
}

export interface UploadedDocument {
  id: string;
  examId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  parseStatus: DocumentParseStatus;
  parseMetadata: unknown;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: string;
  registerNumberSnapshot: string;
  studentNameSnapshot: string;
  departmentSnapshot: string;
  genderSnapshot: string;
  classSnapshot: string;
  subjectCode: string;
  subjectName: string;
  validationStatus: string;
}

export interface CandidatePage {
  documentId: string;
  total: number;
  offset: number;
  limit: number;
  candidates: Candidate[];
}

export const TERMINAL_DOCUMENT_STATUSES: DocumentParseStatus[] = [
  "PARSED",
  "NEEDS_REVIEW",
  "REJECTED",
  "FAILED",
];

export function isTerminalStatus(status: DocumentParseStatus): boolean {
  return TERMINAL_DOCUMENT_STATUSES.includes(status);
}