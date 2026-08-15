# Phase 6 TB3 — Solver-Service Trust Boundary: Topology Decision

Date: 2026-08-15
HEAD before change: 38e917d94d22c2880ee9b4142026633112f2066c
Scope: verify whether `/solve-domain` (and every solver-exposing route) can be
reached without going through the authenticated Node API, then enforce.

---

## 1. Topology determination (Steps 3-4)

### DEV TOPOLOGY
------------------
EMPIRICALLY VERIFIED

- The Node API and the solver service are co-located on the SAME host.
  `SOLVER_BASE_URL` resolves to `http://127.0.0.1:8000`
  (src/phase4/solverClient.ts:27-29).
- **Actual live bind (measured, not inferred):** see `bind-address.log` —
  `netstat -ano` shows `TCP 127.0.0.1:8000 LISTENING` when the service is
  started the dev way (`python -m uvicorn app.main:app`). Loopback only.
  Same host, loopback binding, single trust zone. VERIFIED.

### DOCKER TOPOLOGY
-------------------
DECLARED BY DOCKERFILE
NETWORK MEMBERSHIP NOT EMPIRICALLY VERIFIED

- `solver-service/Dockerfile:12` declares
  `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`
  (non-loopback bind INSIDE the container) and `EXPOSE 8000`.
- No Docker Compose / deployment manifest exists in this repository to
  empirically establish the complete container network trust zone (which
  containers are on which network, firewall/ingress rules, whether the Node
  API and the solver are the ONLY members of that segment).
- Therefore the container network membership is DECLARED-ONLY. The Dockerfile
  establishes a non-loopback bind inside the container, but no deployment
  manifest was available to empirically establish the complete container
  network trust zone. Therefore the "same trusted network segment" conclusion
  for Docker is provisional and must be re-verified against the actual
  deployment topology before production deployment.

### DECISION (implementation)

The shared-secret header mechanism is the correct implementation for the
CURRENTLY VERIFIED (dev) topology: **private/loopback binding + a validated
shared-secret header** (`X-Internal-Token`), NOT mTLS. mTLS is not justified for
the verified topology: there is no crossing of separate trust zones, and no
PKI/infra exists in this prototype. The shared-secret header approach is
retained.

Current bind note: dev runs loopback-only (correct). The Dockerfile declares
`0.0.0.0`; that is standard for a container network but means the shared secret
is the ONLY control between network peers in Docker. That makes a strong,
non-default shared secret mandatory (see §2), AND the Docker trust-zone
assumption itself must be re-verified against a real deployment manifest before
production.

## 2. Step 5(b) finding — dev-default token is currently exploitable  (HEADLINE FINDING)

Evidence: `unauthenticated-call-before-b.log`.

- Probe (a) — POST `/solve-domain` with **no token header**: `HTTP 401`
  `{"detail":"unauthorized"}`. The gate rejects missing tokens.
- Probe (b) — POST `/solve-domain` with `X-Internal-Token: dev-internal-token`
  (the well-known DEFAULT shared by both sides): **`HTTP 200 OK`** with a real
  CP-SAT result (`status:"OPTIMAL"`, assignment produced in 137 ms).

**Finding:** in the current environment, the well-known default token
`dev-internal-token` GRANTS ACCESS to the solver. Because the dev bind is
loopback, a remote attacker cannot reach it today; but in the containerized
topology (Dockerfile binds `0.0.0.0`), ANY network peer that knows the public
default value can call the solver directly, bypassing Node API authentication.
This is a real fail-open-of-the-secret weakness, not a hypothetical.

Root cause: no `SOLVER_*` env is configured anywhere (`.env` scan showed zero
`SOLVER_*` keys; `.env.example` defines none), so both sides silently use
`internal_token = "dev-internal-token"` (solver-service/app/config.py:16) and
`resolveSolverToken()` fallback (src/phase4/solverClient.ts:31-33).

**Resolution (this phase): fail-closed.**
1. Server rejects ALL solver requests whenever the configured token is blank OR
   equals the known default `dev-internal-token` (config.py + shared dependency).
2. Node client refuses to call the solver when `SOLVER_INTERNAL_TOKEN` is unset
   or is the known default (solverClient.ts).
3. Scripts that relied on the default are fixed to configure a real token:
   `scripts/benchmark-parallel.ts`, `scripts/run-tests.mjs`,
   `scripts/run-one-test.mjs`.

## 3. Route enumeration (Step 6) — no undocumented 4th route

Evidence: `route-enumeration.log` (live server).

| Method | Path            | Token         | Result |
|--------|-----------------|---------------|--------|
| GET    | /health         | (none)        | 200    |
| GET    | /health/extra   | (none)        | 404    |
| POST   | /solve          | (none)        | 401    |
| POST   | /solve-domain   | (none)        | 401    |
| POST   | /solve-domain   | dev-internal-token | 200 (the §2 finding) |
| POST   | /solve-domain   | wrong-token   | 401    |
| GET    | /docs           | (none)        | 404 (disabled) |
| GET    | /redoc          | (none)        | 404 (disabled) |
| GET    | /openapi.json   | (none)        | 404 (disabled) |
| GET    | /admin          | (none)        | 404    |
| GET    | /__debug__      | (none)        | 404    |
| DELETE | /solve-domain   | dev-internal-token | 405    |
| PUT    | /health         | (none)        | 405    |

Only `/health`, `/solve`, `/solve-domain` exist (source: main.py). Schema docs
are disabled (`docs_url=None`). No 4th route, no debug/admin surface.

## 4. /health openness decision (recorded)

- **Decision:** GET `/health` remains OPEN (no token required).
- **Justification:** `/health` returns exactly `{"status":"ok"}` and nothing
  else — verified by live probe (200, body `{"status":"ok"}`) and by source
  (main.py:36-38). It exposes zero candidate/solver-state data, so leaving it
  open is safe and is the standard liveness-probe contract for orchestrators and
  the benchmark harness `waitForHealth()`. Requiring a secret on /health would
  break liveness checks without adding security.

## 5. What this phase changes

1. `solver-service/app/config.py` — fail-closed `verify_token` (reject blank and
   the known default).
2. `solver-service/app/main.py` — replace the two duplicated per-route token
   checks with ONE shared FastAPI dependency applied to `/solve` and
   `/solve-domain`. (Also moves auth BEFORE payload validation for these routes;
   a missing/bad token now yields 401 before a 422.)
3. `src/phase4/solverClient.ts` — `resolveSolverToken()` throws on unset or
   known-default token (no silent fallback).
4. `scripts/benchmark-parallel.ts` — configure a real benchmark token on both
   the client and the spawned uvicorn.
5. `scripts/run-tests.mjs` / `scripts/run-one-test.mjs` — supply
   `SOLVER_INTERNAL_TOKEN` in the test environment.
6. Tests: solver-service tests for fail-closed behavior; Node solverClient tests
   (header is sent; unset token throws).

No frozen file is touched. No mTLS introduced. Nothing is committed without an
explicit instruction.