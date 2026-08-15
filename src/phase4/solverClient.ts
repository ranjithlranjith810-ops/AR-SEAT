/**
 * Phase 4 — HTTP client for the FROZEN Python solver service (§7, §18).
 *
 * POSTs one connected domain payload to /solve-domain and classifies every
 * outcome distinctly: timeout vs worker crash vs resource failure vs
 * validation failure vs infeasible vs success. No solver logic here.
 */
import type {
  DomainAssignment,
  DomainSolvePayload,
  DomainSolveResult,
} from "./types";

export interface SolverClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutBufferSeconds?: number;
}

export type SolverTransportError =
  | { kind: "TIMEOUT"; message: string }
  | { kind: "RESOURCE_FAILURE"; message: string }
  | { kind: "WORKER_ERROR"; message: string };

const DEFAULT_TIMEOUT_BUFFER_SECONDS = 30;

export function resolveSolverBaseUrl(): string {
  return process.env.SOLVER_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8000";
}

const KNOWN_DEFAULT_TOKEN = "dev-internal-token";

export function resolveSolverToken(): string {
  const token = process.env.SOLVER_INTERNAL_TOKEN;
  if (!token || token.trim() === "") {
    throw new Error(
      "SOLVER_INTERNAL_TOKEN is not set; refusing to call the solver without a configured service token",
    );
  }
  if (token === KNOWN_DEFAULT_TOKEN) {
    throw new Error(
      "SOLVER_INTERNAL_TOKEN must not be the known default 'dev-internal-token'; configure a real token",
    );
  }
  return token;
}

export async function solveDomain(
  payload: DomainSolvePayload,
  options: SolverClientOptions = {},
): Promise<DomainSolveResult> {
  const baseUrl = options.baseUrl ?? resolveSolverBaseUrl();
  const token = options.token ?? resolveSolverToken();
  const timeoutMs =
    (payload.timeLimitSeconds + (options.timeoutBufferSeconds ?? DEFAULT_TIMEOUT_BUFFER_SECONDS)) * 1000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/solve-domain`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    throw classifyTransportError(error, timeoutMs);
  } finally {
    clearTimeout(timer);
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw {
      kind: "WORKER_ERROR",
      message: `solver returned non-JSON response (HTTP ${response.status})`,
    } satisfies SolverTransportError;
  }

  if (!response.ok) {
    const detail =
      typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
    throw {
      kind: "WORKER_ERROR",
      message: `solver rejected domain payload: ${detail}`,
    } satisfies SolverTransportError;
  }

  const status = body.status as DomainSolveResult["status"];
  const assignments = (body.assignments ?? []) as DomainAssignment[];
  const objectiveValue = body.objectiveValue == null ? null : (body.objectiveValue as number);
  const infeasibilityReason =
    body.infeasibilityReason == null ? null : (body.infeasibilityReason as string);
  const errorCode = body.errorCode == null ? null : (body.errorCode as string);
  const errorMessage = body.errorMessage == null ? null : (body.errorMessage as string);

  return {
    requestId: payload.requestId,
    domainId: payload.requestId.split(":")[1] ?? payload.requestId,
    status,
    assignments,
    solverDurationMs: (body.solverDurationMs as number) ?? 0,
    candidateCount: (body.candidateCount as number) ?? payload.candidateCount,
    assignedCount: (body.assignedCount as number) ?? assignments.length,
    unassignedCount: (body.unassignedCount as number) ?? payload.candidateCount - assignments.length,
    reportedObjective: objectiveValue,
    rawSolverObjective: status === "OPTIMAL" ? objectiveValue : null,
    validatorObjective: objectiveValue,
    infeasibilityReason,
    errorCode,
    errorMessage,
  };
}

function classifyTransportError(
  error: unknown,
  timeoutMs: number,
): SolverTransportError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      kind: "TIMEOUT",
      message: `solver call exceeded ${Math.round(timeoutMs / 1000)}s`,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connection/i.test(message)) {
    return { kind: "RESOURCE_FAILURE", message };
  }
  return { kind: "WORKER_ERROR", message };
}