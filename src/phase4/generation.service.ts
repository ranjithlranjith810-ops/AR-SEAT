/**
 * Phase 4 — seating generation orchestration (§8, §9, §10).
 *
 * Pure orchestration (no DB): partition -> guard -> bounded dispatch -> track
 * -> collect -> validate -> merge -> final validation. Persistence is injected
 * so the pipeline is deterministic and testable; the DB-backed wrapper wires
 * buildSolverInput + SolveJob lifecycle + SeatingPlan/assignment persistence.
 */
import { partitionCandidates } from "./partition";
import { DEFAULT_COMPOSITION_LIMITS } from "./partition";
import type { CompositionLimits } from "./partition";
import { resolveMaxParallelDomains } from "./config";
import type {
  DomainCandidate,
  DomainHall,
  DomainPlan,
  DomainRunRecord,
  DomainSolvePayload,
  DomainSolveResult,
  GenerateOptions,
  GenerationResult,
  GenerationSession,
  GenerationState,
  GenerationTimings,
  SolverDispatch,
  DomainState,
} from "./types";
import { GUARD_ERR_CODES } from "./types";
import { mapWithConcurrency } from "./workerPool";
import { validateDomainResult, validateMerge } from "./validateMerge";

export interface GenerationInput {
  generationId: string;
  examId: string;
  candidates: DomainCandidate[];
  halls: DomainHall[];
  timeLimitSeconds: number;
  maxParallelDomains: number;
  solverConfig: DomainSolvePayload["solverConfig"];
  limits?: CompositionLimits;
  /** Called once the merged result passes final validation. */
  persist?: (result: GenerationResult) => Promise<GenerationResult["plan"] | null>;
  dispatch?: SolverDispatch;
  onDomainState?: (domainId: string, state: DomainState) => void;
}

export function createGeneration(): {
  state: GenerationState;
  domains: DomainRunRecord[];
} {
  return { state: "CREATED", domains: [] };
}

export async function runGeneration(
  input: GenerateOptions & {
    generationId: string;
    examId: string;
    candidates: GenerationInput["candidates"];
    halls: DomainHall[];
  },
): Promise<GenerationResult> {
  const {
    generationId,
    examId,
    candidates,
    halls,
    timeLimitSeconds = 60,
    maxParallelDomains = resolveMaxParallelDomains(),
    dispatch,
    persist,
    session = null,
  } = input;
  const limits: CompositionLimits = { ...DEFAULT_COMPOSITION_LIMITS, ...(input.limits ?? {}) };

  const startedAt = performance.now();
  const domains: DomainRunRecord[] = [];
  let state: GenerationState = "CREATED";
  const solverConfig = resolveSolverConfig(input.solverConfig);
  const timings: GenerationTimings = {
    partitionMs: 0,
    dispatchMs: 0,
    solveMs: 0,
    validationMs: 0,
    mergeMs: 0,
    persistMs: 0,
    wallClockMs: 0,
  };
  let merge = null as GenerationResult["merge"];
  let plan = null as GenerationResult["plan"];
  let error = null as GenerationResult["error"];

  const fail = (next: GenerationState, code: string, message: string): GenerationResult => {
    state = next;
    error = { code, message };
    return finish();
  };

  const finish = (): GenerationResult => ({
    generationId,
    examId,
    state,
    session,
    sessionCandidateCount: candidates.length,
    domainCount: domains.length,
    completedDomainCount: domains.filter((d) => d.state === "COMPLETED").length,
    failedDomainCount: domains.filter((d) => d.state.startsWith("FAILED")).length,
    failedDomainIds: domains.filter((d) => d.state.startsWith("FAILED")).map((d) => d.domainId),
    blockedDomainIds: domains.filter((d) => d.state === "BLOCKED").map((d) => d.domainId),
    domains,
    merge,
    timings: { ...timings, wallClockMs: performance.now() - startedAt },
    plan,
    error,
  });

  // --- PARTITIONING (§4, §5) ---
  state = "PARTITIONING";
  const partitionStart = performance.now();
  const partition = partitionCandidates({ candidates, halls }, limits);
  timings.partitionMs = performance.now() - partitionStart;

  if (partition.blocked) {
    return fail(
      "FAILED_PARTITION",
      "ERR_PARTITION_BLOCKED",
      partition.blockedReason ?? "candidate allocation failed",
    );
  }

  for (const planItem of partition.domains) {
    domains.push({
      domainId: planItem.domainId,
      state: "PENDING",
      plan: planItem,
      result: null,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    });
  }

  // --- GUARD_VALIDATION (§6) ---
  state = "GUARD_VALIDATION";
  const blockedDomain = partition.domains.find((d) => d.blocked);
  if (blockedDomain) {
    const record = domains.find((d) => d.domainId === blockedDomain.domainId);
    if (record) {
      record.state = "BLOCKED";
      record.errorMessage = blockedDomain.blockedReason;
    }
    return fail(
      "FAILED_GUARD",
      blockedDomain.blockedReason ?? GUARD_ERR_CODES.COMPOSITION_IMBALANCE,
      `${blockedDomain.domainId} failed pre-dispatch validation`,
    );
  }
  if (solverConfig.compositionAction === "reject") {
    const risky = partition.domains.find((d) => d.guard.classification === "IMBALANCE_RISK");
    if (risky) {
      const record = domains.find((d) => d.domainId === risky.domainId);
      if (record) {
        record.state = "BLOCKED";
        record.errorMessage = risky.guard.riskViolations.join("; ");
      }
      return fail(
        "FAILED_GUARD",
        GUARD_ERR_CODES.COMPOSITION_IMBALANCE,
        `${risky.domainId} composition risk with compositionAction=reject`,
      );
    }
  }

  // --- DISPATCHING / SOLVING (§7, §8, §15) ---
  state = "DISPATCHING";
  const dispatchStart = performance.now();
  const payloads: { record: DomainRunRecord; payload: DomainSolvePayload }[] =
    domains.map((record) => ({
      record,
      payload: buildDomainPayload(generationId, examId, record.plan as DomainPlan, timeLimitSeconds, solverConfig),
    }));
  timings.dispatchMs = performance.now() - dispatchStart;

  state = "SOLVING";
  const solveStart = performance.now();
  const outcomes = await mapWithConcurrency(
    payloads,
    async ({ record, payload }) => {
      setState(record, "VALIDATING");
      record.startedAt = performance.now();
      if (record.plan?.blocked) {
        setState(record, "BLOCKED");
        return null;
      }
      setState(record, "DISPATCHED");
      setState(record, "SOLVING");
      let result: DomainSolveResult;
      try {
        result = await dispatch!.solveDomain(payload);
      } catch (transportError) {
        record.errorMessage = describeError(transportError);
        record.finishedAt = performance.now();
        setState(record, classifyTransportState(transportError));
        return null;
      }
      record.result = result;
      record.finishedAt = performance.now();
      setState(record, "VALIDATING_RESULT");
      return { record, payload, result };
    },
    {
      limit: maxParallelDomains,
      onProgress: (item) => {
        const record = (item as { record: DomainRunRecord }).record;
        input.onDomainState?.(record.domainId, record.state);
      },
    },
  );
  timings.solveMs = performance.now() - solveStart;

  // --- collect + domain validation (§11) ---
  const validationStart = performance.now();
  let generationFailed: { code: string; message: string } | null = null;
  for (let i = 0; i < outcomes.results.length; i++) {
    const outcome = outcomes.results[i];
    const record = payloads[i]!.record;
    if (!outcome) {
      // The worker threw (transport/timeout/worker error) — the record state
      // was already classified by classifyTransportState. Surface it as a
      // domain failure, never as a partial merge.
      generationFailed ??= {
        code: "ERR_DOMAIN_FAILED",
        message: `${record.domainId}: ${record.errorMessage ?? "domain dispatch failed"}`,
      };
      continue;
    }
    const { payload, result } = outcome;
    if (result.status === "INFEASIBLE") {
      setState(record, "FAILED_VALIDATION");
      record.errorMessage = result.infeasibilityReason ?? "domain infeasible";
      generationFailed ??= {
        code: "ERR_DOMAIN_INFEASIBLE",
        message: `${record.domainId} infeasible: ${record.errorMessage}`,
      };
      continue;
    }
    if (result.status === "ERROR") {
      setState(record, "FAILED_WORKER");
      record.errorMessage = result.errorMessage ?? result.errorCode ?? "domain solver error";
      generationFailed ??= {
        code: result.errorCode ?? "ERR_DOMAIN_SOLVER_ERROR",
        message: `${record.domainId}: ${record.errorMessage}`,
      };
      continue;
    }
    const validation = validateDomainResult(record.plan as DomainPlan, result);
    if (!validation.valid) {
      setState(record, "FAILED_VALIDATION");
      record.errorMessage = validation.structuralErrors.join("; ");
      generationFailed ??= {
        code: "ERR_DOMAIN_VALIDATION",
        message: `${record.domainId}: ${record.errorMessage}`,
      };
      continue;
    }
    void payload;
    setState(record, "COMPLETED");
  }
  for (const failure of outcomes.failures) {
    const record = (failure.item as { record: DomainRunRecord }).record;
    generationFailed ??= {
      code: "ERR_DOMAIN_FAILED",
      message: `${record.domainId}: ${record.errorMessage ?? describeError(failure.error)}`,
    };
  }
  timings.validationMs = performance.now() - validationStart;

  if (generationFailed) {
    return fail("FAILED_DOMAIN", generationFailed.code, generationFailed.message);
  }

  // --- MERGING + FINAL_VALIDATION (§12) ---
  state = "MERGING";
  const mergeStart = performance.now();
  merge = validateMerge(domains, candidates, halls);
  timings.mergeMs = performance.now() - mergeStart;

  if (!merge.valid) {
    state = "FAILED_MERGE";
    return finish();
  }

  state = "FINAL_VALIDATION";
  const allCompleted = domains.every((d) => d.state === "COMPLETED");
  if (!allCompleted) {
    return fail("FAILED_VALIDATION", "ERR_GENERATION_INCOMPLETE", "not all domains completed");
  }

  // --- PERSISTENCE (§13) ---
  if (persist) {
    const persistStart = performance.now();
    try {
      plan = await persist(finish());
    } catch (persistError) {
      state = "FAILED_PERSISTENCE";
      error = {
        code: "ERR_PERSISTENCE",
        message: persistError instanceof Error ? persistError.message : String(persistError),
      };
      return finish();
    }
    timings.persistMs = performance.now() - persistStart;
  }

  state = "COMPLETED";
  return finish();
}

export function resolveSolverConfig(
  partial?: Partial<DomainSolvePayload["solverConfig"]>,
): DomainSolvePayload["solverConfig"] {
  return {
    policyMode: partial?.policyMode ?? "DEPARTMENT_ONLY",
    adjacency: partial?.adjacency ?? "eight",
    compositionAction: partial?.compositionAction ?? "warn",
    randomSeed: partial?.randomSeed ?? 0,
    numSearchWorkers: partial?.numSearchWorkers ?? null,
  };
}

export function buildDomainPayload(
  generationId: string,
  examId: string,
  plan: DomainPlan,
  timeLimitSeconds: number,
  solverConfig: DomainSolvePayload["solverConfig"],
): DomainSolvePayload {
  const halls = plan.halls
    .map((h) => ({
      ...h,
      seats: [...h.seats].sort(
        (a, b) => a.row.localeCompare(b.row) || a.column - b.column,
      ),
    }))
    .sort((a, b) => a.hallNumber.localeCompare(b.hallNumber));
  const candidates = [...plan.candidates].sort((a, b) =>
    a.registerNumber.localeCompare(b.registerNumber),
  );
  return {
    requestId: `${generationId}:${plan.domainId}`,
    examId,
    candidates,
    halls,
    timeLimitSeconds,
    solverConfig,
    candidateCount: candidates.length,
    availableSeatCount: plan.seatCount,
  };
}

function setState(record: DomainRunRecord, state: DomainState): void {
  record.state = state;
}

function classifyTransportState(error: unknown): DomainState {
  const kind =
    typeof error === "object" && error !== null && "kind" in error
      ? (error as { kind: string }).kind
      : "WORKER_ERROR";
  if (kind === "TIMEOUT") return "FAILED_TIMEOUT";
  if (kind === "RESOURCE_FAILURE") return "FAILED_RESOURCE";
  return "FAILED_WORKER";
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}