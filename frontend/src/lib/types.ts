export type Role = "ADMIN" | "STAFF";

export type Gender = "MALE" | "FEMALE" | "OTHER";

export type StudentStatus = "ACTIVE" | "INACTIVE" | "PASSED_OUT" | "TRANSFERRED";

export const STUDENT_STATUSES: StudentStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "PASSED_OUT",
  "TRANSFERRED",
];

export interface Department {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassItem {
  id: string;
  departmentId: string;
  name: string;
  year: number;
  section: string;
  academicYear: string;
  department: { id: string; code: string; name: string };
}

export interface Student {
  id: string;
  name: string;
  rollNumber: string;
  registerNumber: string;
  gender: Gender;
  status: StudentStatus;
  classId: string;
  createdAt: string;
  updatedAt: string;
  class: ClassItem;
}

export interface StudentPage {
  students: Student[];
  total: number;
  limit: number;
  offset: number;
}

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
}

export interface HallSeat {
  id: string;
  hallId: string;
  benchId: string | null;
  seatPosition: string;
  row: string;
  column: number;
  isActive: boolean;
}

export interface HallBench {
  id: string;
  hallId: string;
  benchNumber: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  capacity: number;
  seats: HallSeat[];
}

export interface Hall {
  id: string;
  hallNumber: string;
  name: string;
  building: string | null;
  rows: number;
  columns: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  totalSeatCount: number;
  activeSeatCount: number;
  unassignedSeats: HallSeat[];
  benches: HallBench[];
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

export interface ExamCandidateRef {
  candidateId: string;
  examId: string;
  status: string;
  subjectCode: string;
  subjectName: string;
  validationStatus: string;
}

export interface ExamConflict {
  studentId: string;
  registerNumber: string;
  studentName: string;
  candidate: ExamCandidateRef;
  conflictingExams: ExamCandidateRef[];
}

export interface ExamConflictReport {
  examId: string;
  examDate: string;
  session: ExamSession;
  conflicts: ExamConflict[];
}

export interface ExamCandidatePage {
  examId: string;
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

export const AUDIT_ACTIONS = [
  "PDF_UPLOADED",
  "CANDIDATE_MATCHED",
  "CANDIDATE_RESOLVED",
  "EXAM_CREATED",
  "SOLVE_REQUESTED",
  "SOLVE_STARTED",
  "SOLVE_COMPLETED",
  "SOLVE_FAILED",
  "PLAN_APPROVED",
  "PLAN_PUBLISHED",
  "PLAN_SUPERSEDED",
  "STUDENT_CREATED",
  "STUDENT_UPDATED",
  "STUDENT_STATUS_CHANGED",
  "DEPARTMENT_CREATED",
  "DEPARTMENT_UPDATED",
  "CLASS_CREATED",
  "CLASS_UPDATED",
  "HALL_CREATED",
  "HALL_UPDATED",
  "HALL_STATUS_CHANGED",
  "BENCH_CREATED",
  "BENCH_UPDATED",
  "BENCH_STATUS_CHANGED",
  "BENCH_SEAT_ASSIGNED",
  "BENCH_SEAT_REMOVED",
  "EXAM_CANCELLED",
  "EXAM_CONFLICT_CHECKED",
  "EXAM_CANDIDATE_ADDED",
  "EXAM_CANDIDATE_EXCLUDED",
  "EXAM_CANDIDATE_REINSTATED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditActor {
  id: string;
  username: string;
  role: Role;
}

export interface AuditLogItem {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  createdAt: string;
  actor: AuditActor | null;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  total: number;
  limit: number;
  offset: number;
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