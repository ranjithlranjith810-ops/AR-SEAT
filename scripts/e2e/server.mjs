/**
 * Phase 14 — runnable backend entry point for E2E.
 *
 * Boots the real Phase 4 HTTP surface (createPhase4Server) with a live in-memory
 * generation registry and the real solver HTTP dispatch. No mocked backend, no
 * mocked solver: generation domains are POSTed to the frozen solver service.
 *
 * Env contract (set by the E2E orchestrator, never loaded from .env):
 *   DATABASE_URL / DIRECT_URL        -> local E2E postgres
 *   SOLVER_BASE_URL                  -> e.g. http://127.0.0.1:8000
 *   SOLVER_INTERNAL_TOKEN            -> non-default shared service token
 *   PORT                             -> listen port (default 8787)
 *   MAX_PARALLEL_DOMAINS             -> solver concurrency (default 1)
 *   TIME_LIMIT_SECONDS               -> per-domain solver time limit (default 60)
 *
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must NOT be set so documents are
 * staged in the MemoryDocumentStore rather than a remote bucket.
 */
import { createPhase4Server } from "../../src/phase4/api.ts";
import { solveDomain } from "../../src/phase4/solverClient.ts";

const registry = new Map();
const port = Number(process.env.PORT ?? 8787);

const server = createPhase4Server({
  registry,
  dispatch: { solveDomain },
  timeLimitSeconds: Number(process.env.TIME_LIMIT_SECONDS ?? 60),
  maxParallelDomains: Number(process.env.MAX_PARALLEL_DOMAINS ?? 1),
  solverConfig: {
    policyMode: "DEPARTMENT_ONLY",
    adjacency: "cardinal",
    compositionAction: "warn",
    randomSeed: 42,
    numSearchWorkers: 1,
  },
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[e2e-server] listening on http://127.0.0.1:${port}`);
});
