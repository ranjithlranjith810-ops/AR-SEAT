# Phase 13 — Full End-to-End Product Acceptance & Release Gate: CLOSEOUT

- Phase: Phase 13 (Full E2E Product Acceptance & Release Gate)
- Status: **CASE D — ENVIRONMENTAL FAILURE**
- Date: 2026-08-17
- Pre-flight gate: **VERIFIED (PASS)**
- Environment gate: **FAILED — STOP per phase rules**
- Production code changes: **NONE**
- Commits / pushes: **NONE**

## Objective

Execute a browser-first, full end-to-end acceptance run of the seating-plan
product (Login → Select Exam → Upload PDF → Processing → Candidate Review →
Generate → Generation Status → View Seating → Approve → Publish → Verify
Published) as a real ADMIN user, without direct API or DB manipulation, then run
a regression and close out with a single product classification.

## Pre-flight Gate — VERIFIED (PASS)

- `HEAD` == `origin/main` == `4725288fdb528274264e67c427a5967753ce97c7`
- Branch `main` in sync with `origin/main`.
- Working tree contains **no tracked modifications** (only pre-existing
  unrelated untracked artifacts remain, untouched).
- Evidence: `phase13-preflight.log`.

## Environment Gate — FAILED (hard STOP per phase rules)

The integrated product **cannot be started** in this repository/environment.
Verified findings (evidence: `phase13-environment-gate.log`):

1. **No runnable backend server.** `createPhase4Server` is defined only in
   `src/phase4/api.ts:78` and is invoked exclusively by tests. There is no
   `.listen(` call anywhere in `src`, and no `index.ts`/`server.ts`/`main.ts`/
   `start.*` entry file exists repo-wide. The frontend Vite dev proxy targets
   `http://localhost:8787`, but no process can be started there. This is a
   pre-existing, documented property (`docs/evidence/phase6-tb3/phase6-tb3-closeout.md`
   and `docs/evidence/phase7a/phase7a-closeout.md`).
2. **No browser-automation tooling.** No Playwright/Puppeteer (or any E2E
   driver) is installed in either `package.json`. A browser-first journey
   (Phase 13 Rule 1) is therefore not executable without installing tooling.
3. **No solver runtime configuration.** `src/phase4/solverClient.ts` refuses to
   dispatch solve jobs without `SOLVER_INTERNAL_TOKEN` (not present in `.env`),
   and expects a solver at `SOLVER_BASE_URL` (default `http://127.0.0.1:8000`).
   The Python CP-SAT solver exists under `solver-service/` but is not booted or
   configured, and no bootstrap script for it is present in the repo.
4. **Live-infra side effects for any real run.** The only configured database
   and storage are the live Supabase project (`.env` supplies
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`). A genuine run
   requires seeding the live DB, creating ADMIN/STAFF users, and uploading real
   PDFs to the live private bucket — side-effecting operations that require
   explicit authorization and were declined for this phase.

Because the browser-first E2E journey cannot be started (backend has no entry
point; no browser driver; solver unconfigured), Phase 13 stops at the
environment gate and is classified per the phase rules. No journey stages were
executed; no regression was run (the environment-gate STOP precedes regression).

## Classification

**CASE D — ENVIRONMENTAL FAILURE**

Per the Phase 13 classification rules: the failure is caused by service
startup / external dependencies / browser environment (no runnable backend
entry point, no browser-automation tooling, no solver runtime configuration,
live-Supabase-only infrastructure). This is **not** a defect in the product's
backend contracts or frontend integration, and **not** a spec/contract
mismatch.

## Per-Journey-Stage Status

| Stage | Status | Notes |
| --- | --- | --- |
| Login | NOT RUN | Backend not startable |
| Exam Selection | NOT RUN | — |
| Upload PDF | NOT RUN | — |
| Processing | NOT RUN | — |
| Candidate Review | NOT RUN | — |
| Generate | NOT RUN | — |
| Generation Status | NOT RUN | — |
| View Seating | NOT RUN | — |
| Approve | NOT RUN | — |
| Publish | NOT RUN | — |
| Verify Published | NOT RUN | — |
| STAFF boundary | NOT RUN | — |
| Regression (post-E2E) | NOT RUN | Gated behind environment gate |

## Evidence Index (`docs/evidence/phase13/`)

- `phase13-preflight.log` — pre-flight gate raw output (HEAD, origin/main,
  branch, log, status).
- `phase13-environment-gate.log` — environment-gate findings.
- `phase13-final-git-log.log` — final provenance (HEAD, origin/main, branch,
  log, status).
- `phase13-final-frozen-diff.log` — `git diff --exit-code HEAD` → exit 0 (no
  tracked modifications).
- `phase13-closeout.md` — this file.

## Git Provenance

- `HEAD` == `origin/main` == `4725288fdb528274264e67c427a5967753ce97c7`
- No commits were created; nothing was pushed.
- Frozen diff (tracked working tree vs HEAD): **exit 0** — no tracked
  modifications (`phase13-final-frozen-diff.log`).
- Only additions during this phase: the untracked `docs/evidence/phase13/`
  directory (evidence logs only).

## Security

- No credentials were printed or logged; `.env` values were treated as secret.
- No live-infra mutation was performed (no DB seed, no user creation, no
  uploads to the storage bucket).
- The environment gate was intentionally enforced rather than patching around
  it to reach a green claim.

## Deferred Items

1. **Phase 12 (audit-read support)** — remains deferred (closed `AuditAction`
   Postgres enum; requires a migration; separate reviewed backend task).
2. **Academic-year / class-context model** — remains deferred (no explicit
   academic-year or class-context selection surface beyond the seeded model).
3. **NEW — Phase 13 environment scaffolding** (required to make a future E2E
   run possible):
   - A runnable backend entry point (boot `createPhase4Server`, wire DB, auth,
     storage, solver dispatch).
   - A documented start procedure for frontend + backend (and, for full E2E,
     the solver-service runtime and `SOLVER_INTERNAL_TOKEN`/`SOLVER_BASE_URL`
     configuration).
   - A browser E2E harness (e.g. Playwright) with a documented smoke journey.
   - Explicit authorization for live-Supabase test-data seeding and bucket
     uploads, or a disposable test project.

## Final Classification

**CASE D — ENVIRONMENTAL FAILURE.** Full E2E not executed; pre-flight gate
passed; environment gate failed for verified, pre-existing infrastructure
reasons. No production code was changed; no commit/push was performed.
