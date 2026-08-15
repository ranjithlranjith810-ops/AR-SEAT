# Phase 6 TB3 — Solver-Service Trust Boundary Verification & Enforcement: Close-Out

Date: 2026-08-15
HEAD (pre-change): 38e917d94d22c2880ee9b4142026633112f2066c
Branch: main (in sync with origin/main). Changes below are UNCOMMITTED.

## 1. Objective

Verify whether `/solve-domain` (and every solver-exposing route) can be reached
without going through the authenticated Node API, then enforce the trust
boundary. Investigation was completed empirically (not inferred from source)
before any code was written.

## 2. Investigation findings (Steps 1-7) — evidence files

- `node-startup.log` — No standalone Node API entrypoint exists; `createPhase4Server`
  is exercised only by tests. Solver dispatch is real `solverClient.solveDomain`
  by default (integration.ts), base URL `SOLVER_BASE_URL ?? http://127.0.0.1:8000`.
- `fastapi-startup.log` — uvicorn entrypoint, `main.py` route surface, duplicated
  per-route token checks (pre-change), `docs_url=None` (schema disabled).
- `bind-address.log` — **Actual** live bind measured: `TCP 127.0.0.1:8000
  LISTENING` (loopback) for the dev-start convention. Dockerfile declares
  `0.0.0.0` inside the container network.
- `unauthenticated-call-before-a.log` — POST /solve-domain with NO token → **401**.
- `unauthenticated-call-before-b.log` — POST /solve-domain with the well-known
  default `X-Internal-Token: dev-internal-token` → **200 OPTIMAL**. HEADLINE
  FINDING: the shared secret was effectively a public default; the fail-open-of-
  the-secret path existed. (Dev bind is loopback, so not remotely reachable
  today, but the Docker topology would expose it to any network peer.)
- `route-enumeration.log` — exactly 3 routes (`/health`, `/solve`,
  `/solve-domain`); `/docs`, `/redoc`, `/openapi.json`, `/admin`, `/__debug__`
  all 404; wrong method → 405. No 4th/undocumented route.
- `topology-decision.md` — same trusted host/network segment ⇒ private binding +
  shared-secret header is the correct mechanism (mTLS not justified); the Step
  5(b) finding is recorded as its own section; `/health` stays open with a
  recorded justification.

## 3. What was changed (uncommitted)

| File | Change |
|------|--------|
| `solver-service/app/config.py` | Fail-closed: `verify_token` rejects blank config AND the known default `dev-internal-token` (still constant-time `secrets.compare_digest` for real tokens). |
| `solver-service/app/main.py` | One shared `require_internal_token` FastAPI dependency applied via `dependencies=[Depends(...)]` to `/solve` and `/solve-domain`; duplicated per-route checks removed. Auth now precedes payload validation (401 before 422). |
| `src/phase4/solverClient.ts` | `resolveSolverToken()` throws when `SOLVER_INTERNAL_TOKEN` is unset OR equals the known default — no silent fallback. |
| `scripts/benchmark-parallel.ts` | Sets a real benchmark token on both the client and the spawned uvicorn (inherits env). |
| `scripts/run-tests.mjs`, `scripts/run-one-test.mjs` | Supply `SOLVER_INTERNAL_TOKEN=test-internal-token` in the test env. |
| `solver-service/tests/test_api.py`, `test_solve_domain.py`, `test_config.py` (new) | Fail-closed tests: missing/wrong/dev-default/blank token on both routes + config-level unit tests. |
| `tests/phase4-orchestration.test.ts` | Node solverClient tests: header is sent with the configured token; unset and dev-default tokens throw. |

Frozen files (seatlabel.py, solver.py, graph.py, partition.py, guards.py,
validation.py) verified byte-identical to HEAD (`git diff --exit-code` → 0).

## 4. Verification results

- **Live post-change re-probe** (`unauthenticated-call-after.log`):
  - Server WITHOUT `SOLVER_INTERNAL_TOKEN`: no token→401, dev-internal-token→401,
    any token→401 (fail-closed by default).
  - Server WITH `SOLVER_INTERNAL_TOKEN=<REAL_CONFIGURED_TOKEN>`: no token→401,
    dev-internal-token→401 (correct-match-with-default still rejected), real
    token→200.
- **solver-service pytest**: `96 passed` (was 85; +11) — `tb3-tests.log`.
- **npm regression** via `scripts/run-tests.mjs` (migrate deploy + seed + vitest
  against isolated test DB): `19 files passed / 1 skipped`, `135 passed /
  3 skipped` (was 132/3; +3) — `npm-test.log`.
- **Typecheck**: `tsc --noEmit` exit 0 — `typecheck.log`.
- **Git hygiene**: `git-diff.log`, `git-log.log`. Pre-existing untracked files
  (phase3-benchmarks logs, phase4-benchmarks/, phase3-discovery.md,
  phase4-ingestion-e2e.test.ts, stray "eating prototype✎") are NOT part of this
  change and remain untracked.

## 5. Classification — CASE B: VERIFIED WITH NOTED EXCEPTIONS

The trust boundary is now verified and enforced end-to-end:
- Every solver-exposing route requires a valid, non-default, environment-
  configured shared secret (single dependency, constant-time compare).
- The Node client cannot silently fall back to a well-known default.
- Empirically re-probed live: the previously-exploitable default is closed; a
  real configured secret works.

Noted exceptions / residual items (recorded, not fixed in this phase):
1. **Docker topology is DECLARED-ONLY (provisional).** Dev topology is
   EMPIRICALLY VERIFIED (live netstat: loopback `127.0.0.1:8000`). The
   Dockerfile (`--host 0.0.0.0`) declares a non-loopback bind, but no
   deployment manifest exists to empirically establish the container network
   trust zone. The "same trusted network segment" conclusion for Docker is
   provisional and must be re-verified against the actual deployment topology
   before production (see `topology-decision.md` §1). Until then the shared
   secret is the ONLY control between network peers in Docker, so a strong,
   non-default `SOLVER_INTERNAL_TOKEN` is mandatory; mTLS is the escalation if
   the deployed network ever spans separate trust zones (deferred — not
   justified by the currently verified topology).
2. **Operational requirement**: running the solver for local dev now requires
   `SOLVER_INTERNAL_TOKEN` to be set (the default is deliberately unusable).
   Intended fail-closed behavior; the test runners and benchmark script are
   already updated.
3. **Auth-before-validation precedence change** on /solve and /solve-domain:
   a bad token now yields 401 even with an invalid body (previously 422).
   Intentional (auth before schema disclosure); covered by explicit
   `test_invalid_token_rejected_before_payload_validation` tests on both
   routes.

## 6. Provenance

Evidence directory: `docs/evidence/phase6-tb3/` (this file plus the logs listed
in §2/§4). `*.log` files are gitignored; the tracked deliverables of this phase
would be the source/test changes and this closeout. Nothing has been committed;
a commit will be created only on explicit instruction.