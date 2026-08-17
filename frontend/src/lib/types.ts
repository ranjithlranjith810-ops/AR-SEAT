export type Role = "ADMIN" | "STAFF";

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
}

export type ExamSession = "FN" | "AN";

export type ExamType = "UNIVERSITY" | "INTERNAL" | "MODEL";

export type ExamStatus =
  | "DRAFT"
  | "READY"
  | "GENERATING"
  | "GENERATED"
  | "APPROVED"
  | "PUBLISHED"
  | "CANCELLED";

export interface Exam {
  id: string;
  examDate: string;
  session: ExamSession;
  examType: ExamType;
  status: ExamStatus;
  createdAt: string;
  updatedAt: string;
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

export type GenerationState =
  | "CREATED"
  | "PARTITIONING"
  | "GUARD_VALIDATION"
  | "DISPATCHING"
  | "SOLVING"
  | "MERGING"
  | "FINAL_VALIDATION"
  | "COMPLETED"
  | "FAILED_PARTITION"
  | "FAILED_GUARD"
  | "FAILED_RECONCILIATION"
  | "FAILED_DOMAIN"
  | "FAILED_VALIDATION"
  | "FAILED_MERGE"
  | "FAILED_PERSISTENCE"
  | "CANCELLED";

export type SolverStatus = "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "ERROR";

export interface GenerationPlanMeta {
  seatingPlanId: string | null;
  version: number | null;
  solverStatus: SolverStatus | null;
  assignedCount: number;
  unassignedCount: number;
}

export interface GenerationTimings {
  partitionMs: number;
  dispatchMs: number;
  solveMs: number;
  validationMs: number;
  mergeMs: number;
  persistMs: number;
  wallClockMs: number;
}

export interface GenerationCreated {
  generationId: string;
  state: GenerationState;
  pollUrl: string;
  jobId: string;
}

export interface GenerationStatus {
  generationId: string;
  state: GenerationState;
  sessionCandidateCount: number;
  domainCount: number;
  completedDomainCount: number;
  failedDomainCount: number;
  failedDomainIds: string[];
  blockedDomainIds: string[];
  error: { code: string; message: string } | null;
  timings: GenerationTimings;
  plan: GenerationPlanMeta | null;
}

export type SeatingPlanStatus = "DRAFT" | "APPROVED" | "PUBLISHED" | "SUPERSEDED";

export interface SeatingAssignment {
  id: string;
  examCandidate: {
    id: string;
    registerNumberSnapshot: string;
    studentNameSnapshot: string;
    departmentSnapshot: string;
    classSnapshot: string;
    subjectCode: string;
  };
  hall: { id: string; hallNumber: string; rows: number; columns: number };
  hallSeat: { id: string; seatPosition: string; row: string; column: number };
}

export interface SeatingPlan {
  id: string;
  examId: string;
  version: number;
  status: SeatingPlanStatus;
  createdAt: string;
  updatedAt: string;
  assignments: SeatingAssignment[];
}

export function isTerminalGenerationState(state: GenerationState): boolean {
  return state === "COMPLETED" || state.startsWith("FAILED") || state === "CANCELLED";
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