/**
 * Phase 4 — Node <-> Python orchestration contracts (§2, §7).
 *
 * The frozen Phase 3 CP-SAT engine stays untouched. Node owns: prepare ->
 * validate -> partition -> dispatch -> track -> collect -> validate -> merge
 * -> persist. Python owns: seat optimization inside ONE physical domain
 * (POST /solve-domain -> seatlabel.solve_domain).
 */

export type SolverStatus = "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "ERROR";

export interface DomainCandidate {
  id: string;
  registerNumber: string;
  studentName: string;
  department: string;
  class: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  subjectCode: string;
  subjectName: string;
  year?: string | null;
}

export interface DomainSeat {
  id: string;
  seatPosition: string;
  row: string;
  column: number;
}

export interface DomainHall {
  id: string;
  hallNumber: string;
  name: string;
  building: string | null;
  rows: number;
  columns: number;
  capacity: number;
  seats: DomainSeat[];
}

export interface DomainSolvePayload {
  requestId: string;
  examId: string;
  candidates: DomainCandidate[];
  halls: DomainHall[];
  timeLimitSeconds: number;
  solverConfig: {
    policyMode: "DEPARTMENT_ONLY" | "STRICT_DEPT_OR_YEAR" | "COHORT";
    adjacency: "eight" | "cardinal";
    compositionAction: "warn" | "reject";
    randomSeed: number;
    numSearchWorkers: number | null;
  };
  candidateCount: number;
  availableSeatCount: number;
}

export interface DomainAssignment {
  candidateId: string;
  hallId: string;
  hallSeatId: string;
}

export interface DomainSolveResult {
  requestId: string;
  domainId: string;
  status: SolverStatus;
  assignments: DomainAssignment[];
  solverDurationMs: number;
  candidateCount: number;
  assignedCount: number;
  unassignedCount: number;
  /** Reported objective — equals the authoritative validator count for any
   * non-ERROR/INFEASIBLE domain (frozen engine guarantee, seatlabel §18). */
  reportedObjective: number | null;
  rawSolverObjective: number | null;
  validatorObjective: number | null;
  infeasibilityReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/** §8 — per-domain lifecycle (no silent disappearance). */
export type DomainState =
  | "PENDING"
  | "VALIDATING"
  | "DISPATCHED"
  | "SOLVING"
  | "VALIDATING_RESULT"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED_TIMEOUT"
  | "FAILED_WORKER"
  | "FAILED_VALIDATION"
  | "FAILED_RESOURCE"
  | "CANCELLED";

/** §9 — generation lifecycle. */
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

export type GuardClassification =
  | "BALANCED"
  | "IMBALANCE_RISK"
  | "INSUFFICIENT_CAPACITY";

export interface DomainGuardResult {
  classification: GuardClassification;
  riskViolations: string[];
}

export interface DomainPlan {
  domainId: string;
  /** Every hall in this physical connected component (>= 1). */
  hallIds: string[];
  hallNumbers: string[];
  /** Component halls with their seats. */
  halls: DomainHall[];
  /** Flattened active seats of the component. */
  seats: DomainSeat[];
  candidates: DomainCandidate[];
  seatCount: number;
  candidateCount: number;
  /** Pre-dispatch guard status (capacity / ceiling / composition). */
  guard: DomainGuardResult;
  blocked: boolean;
  blockedReason: string | null;
}

export interface DomainRunRecord {
  domainId: string;
  state: DomainState;
  plan: DomainPlan | null;
  result: DomainSolveResult | null;
  startedAt: number | null;
  finishedAt: number | null;
  errorMessage: string | null;
}

export interface MergeValidation {
  sessionCandidateCount: number;
  assignedCandidateCount: number;
  duplicateCandidateIds: string[];
  duplicateSeatIds: string[];
  unknownDomainIds: string[];
  missingCandidateCount: number;
  crossDomainAdjacencyDetected: boolean;
  valid: boolean;
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

/** The exam session (date + time slot) this generation is scoped to. */
export interface GenerationSession {
  examId: string;
  examDate: string;
  timeSlot: "FN" | "AN";
}

export interface GenerationResult {
  generationId: string;
  examId: string;
  state: GenerationState;
  /** Session identity when the generation is scoped to a real exam. */
  session: GenerationSession | null;
  sessionCandidateCount: number;
  domainCount: number;
  completedDomainCount: number;
  failedDomainCount: number;
  failedDomainIds: string[];
  blockedDomainIds: string[];
  domains: DomainRunRecord[];
  merge: MergeValidation | null;
  timings: GenerationTimings;
  plan: {
    seatingPlanId: string | null;
    version: number | null;
    solverStatus: SolverStatus | null;
    assignedCount: number;
    unassignedCount: number;
  } | null;
  error: { code: string; message: string } | null;
}

/** Dependency injected into the generation pipeline (testability). */
export interface SolverDispatch {
  solveDomain(payload: DomainSolvePayload): Promise<DomainSolveResult>;
}

export interface GenerateOptions {
  generationId?: string;
  timeLimitSeconds?: number;
  maxParallelDomains?: number;
  solverConfig?: Partial<DomainSolvePayload["solverConfig"]>;
  dispatch: SolverDispatch;
  onDomainState?: (domainId: string, state: DomainState) => void;
  limits?: GenerationLimits;
  session?: GenerationSession;
  persist?: (result: GenerationResult) => Promise<GenerationResult["plan"] | null>;
}

export interface GenerationLimits {
  largestDepartmentRatio?: number;
  largestYearRatio?: number;
  largestCohortRatio?: number;
  maxEmptySeatRatio?: number;
  /** Topology ceiling (§24) — maximum candidates per connected component. */
  maxDomainCandidates?: number;
}

export const MAX_DOMAIN_CANDIDATES = 1000;

export const GUARD_ERR_CODES = {
  INSUFFICIENT_CAPACITY: "ERR_INSUFFICIENT_DOMAIN_CAPACITY",
  TOPOLOGY_OVERSIZED: "ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT",
  COMPOSITION_IMBALANCE: "ERR_DOMAIN_COMPOSITION_IMBALANCE",
} as const;
