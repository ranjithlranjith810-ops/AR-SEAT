/**
 * Phase 4 — external configuration (§10, §24).
 *
 * The bounded domain-worker pool is configurable and never hardcoded. The
 * conservative production default is 4 concurrent domain jobs (the 2/4/8
 * benchmark measured 4 as the practical sweet spot for this CP-SAT workload).
 * Override with SOLVER_MAX_PARALLEL_DOMAINS.
 */
export const DEFAULT_MAX_PARALLEL_DOMAINS = 4;

export function resolveMaxParallelDomains(): number {
  const raw = process.env.SOLVER_MAX_PARALLEL_DOMAINS;
  if (raw && /^\d{1,3}$/.test(raw.trim())) {
    const value = Number(raw.trim());
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return DEFAULT_MAX_PARALLEL_DOMAINS;
}

export function resolveSolverTimeLimitSeconds(): number {
  const raw = process.env.SOLVER_TIME_LIMIT_SECONDS;
  if (raw && /^\d{1,5}$/.test(raw.trim())) {
    const value = Number(raw.trim());
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return 60;
}