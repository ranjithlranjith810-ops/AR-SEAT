# Phase 14 — E2E Environment Scaffolding & Browser Acceptance Harness: CLOSEOUT

- Phase: Phase 14 (E2E Environment Scaffolding & Browser Acceptance Harness)
- Status: **CASE A — VERIFIED (full browser journey passes)**
- Date: 2026-08-17
- Pre-flight gate: **VERIFIED (PASS)** — HEAD `433bdbf` (Phase 15 reconciliation surface)
- Environment gate: **PROVISIONED & RUN** (disposable local Postgres, real backend + real solver + real UI)
- Contract gate: **UNBLOCKED** (Phase 15 shipped the candidate-resolution surface; gap closed)
- Production code changes: **YES** (two E2E-proven defect fixes in `src/phase4/api.ts` + regression test)
- Schema changes: **NONE**
- Commits / pushes: **NONE** (Phase 14 changes remain uncommitted; awaiting approval)

## 1. Objective

Establish a reproducible, isolated (non-production) environment plus a browser
harness capable of executing the full seating-plan journey through the real UI
(Login → Select Exam → Upload PDF → Processing → Candidate Review → Generate →
Generation Status → View Seating → Approve → Publish → Verify Published), and
run that journey honestly against the **real frozen solver and real backend**,
with no dependency on live Supabase data.

## 2. Pre-flight result

- `HEAD` = `433bdbf0be504652b69f9a8b884aff2cdf6bfbbd` (Phase 15 commit, parent `4725288`).
- Phase 15 evidence complete; Phase 14 precondition captured in
  `phase14-phase15-git-precondition.log`.
- Frozen solver diff (`solver-service/app/`): clean.

## 3. Environment inventory

Complete in the prior run — `phase14-environment-inventory.md`. This resume
confirmed and used the same inventory:

- **Backend:** `scripts/e2e/server.mjs` bootstrap on `127.0.0.1:8787` (real
  `createPhase4Server`, real `GenerationRegistry`, real solver dispatch; env
  scrubbed of `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` so storage falls back to
  `MemoryDocumentStore`). Evidenced: `phase14-backend.log` (listening on 8787).
- **Frontend:** Vite dev server (`frontend/`) on `127.0.0.1:5173`, proxy target
  `http://127.0.0.1:8787` via `VITE_API_TARGET`. Evidenced: `phase14-frontend.log`.
- **Database:** disposable Docker `postgres:16` (`ar-seat-e2e-db`) on
  `127.0.0.1:55432`, db `exam_seating_e2e_test`, all 3 Prisma migrations applied.
- **Auth:** ADMIN `e2e-admin` and STAFF `e2e-staff` created by `scripts/e2e/seed.mjs`.
- **Storage:** `MemoryDocumentStore` (no Supabase env present).
- **Solver:** frozen FastAPI CP-SAT service from `solver-service/.venv`, fail-closed
  `SOLVER_INTERNAL_TOKEN=e2e-internal-token`. Evidenced: `phase14-solver-service.log`.
- **Browser:** Playwright `@playwright/test@^1.62.1` + Chromium (Chrome for Testing).

## 4. Environment gate result

**RUN — PROVISIONED & VERIFIED.** Docker container recreated fresh by
`scripts/e2e/run-e2e.mjs` each run; PostgreSQL readiness confirmed; `prisma
migrate deploy` applied 3 migrations; seed created master data, golden exam
(2026-05-12 FN), role exam + pre-ingested PARSED document (2026-05-13 AN),
users, and the LH09 hall (5x5=25 seats).

## 5. Backend startup result

**PASS.** Real `createPhase4Server` bootstrapped on 8787 with solver dispatch;
smoke checks (401 unauthenticated `/auth/me`, ADMIN login) passed during
provisioning.

## 6. Database isolation result

**PASS.** `phase14-database-safety.log`:
`SAFETY_GATE=PASS` — fail-closed assert (host `127.0.0.1`/`localhost` + path
contains `test`) before any destructive operation; fresh container per run;
no production connection touched.

## 7. Storage isolation result

**PASS.** Backend env scrubbed of Supabase credentials → `MemoryDocumentStore`
used; upload path exercised in-browser.

## 8. Solver result

**PASS — REAL SOLVER CALLED.** `/health` 200; wrong token → 401. The golden
path invoked the real solver via `POST /solve-domain`. Persisted evidence on
the E2E database:

```
solve_jobs: status=SUCCEEDED, solver_status=OPTIMAL, candidate_count=12,
            assigned_count=12, unassigned_count=0, solver_duration_ms=143
```

## 9. Browser harness result

**PASS.** `e2e/playwright.config.ts`, `e2e/helpers.ts`, and 3 spec files
(auth, role-gating, golden-path) installed; 7 tests compile.

## 10. Browser smoke result

**PASS** — folded into the E2E run (auth specs, 3 tests).

## 11. ADMIN E2E result

**PASS — GOLDEN PATH.** `golden-path.spec.ts`: upload PDF → 12 candidate rows →
resolve all 12 (MATCHED → VALIDATED via the Phase 15 surface) → generate (real
solver OPTIMAL) → plan shows "12 assigned, 0 unassigned" → approve → publish →
published plan visible. 7.2s. Evidence: `phase14-golden-path.log`.

## 12. STAFF boundary result

**PASS.** `role-gating.spec.ts`: STAFF UI hides admin surfaces and blocks admin
routes; STAFF can read candidates but resolve/generate are rejected server-side;
STAFF upload is rejected server-side (403). Evidence: `phase14-role-gating.log`.

## 13. Regression result

**PASS.** See `phase14-backend-regression.log`:

- Backend suite: **173 passed, 19 skipped** across 26 files. One suite
  (`exam-document.test.ts`) failed to LOAD with a transient Supabase pooler
  connection error; isolated re-run passed 16/16 (infrastructure flake, not a
  regression).
- Frontend suite: **97 passed** (8 files), exit 0 (`phase14-frontend-test.log`).
- Root typecheck: exit 0 (`phase14-typecheck.log`).
- Frontend typecheck: exit 0 (`phase14-frontend-typecheck.log`).
- Frontend production build: exit 0 (`phase14-build.log`).
- Frozen solver (`solver-service/app/`): clean (`phase14-solver-frozen-diff.log`).

## 14. Security result

- No production mutation: disposable local DB only; no credential rotation.
- No `.env` values copied into files; only variable names recorded.
- `SOLVER_INTERNAL_TOKEN` non-default (`e2e-internal-token`), fail-closed.
- No contaminated evidence artifacts.

## 15. Frozen solver result

`git diff --exit-code HEAD -- solver-service/app/` → **exit 0** (clean)
(`phase14-solver-frozen-diff.log`). The solver was invoked via HTTP only.

## 16. E2E-proven defects fixed in this phase (in-scope, honest)

1. **Percent-encoded generation ids never decoded (registry 404).** The
   frontend fetches `gen:<uuid>` through `encodeURIComponent`, so the backend
   registry lookup received `gen%3A...` and returned `GENERATION_NOT_FOUND`.
   Fixed with `decodePathSegment` (safe `decodeURIComponent`) on both
   `/exam-seating/generations/:id` and `/:id/seating` GET routes
   (`src/phase4/api.ts`). Regression test **Test H** added in
   `tests/phase5-auth.test.ts` (encoded id resolves; missing plan yields the
   intentional `PLAN_NOT_FOUND`).
2. **Plan serializer omitted assigned/unassigned counts.** `serializeGeneration`
   left `assignedCount`/`unassignedCount` out of the plan object that the
   frontend `GenerationPlanMeta` requires, so the generation page rendered
   " assigned, 0 unassigned". Fixed by adding both fields to the serialized plan.

Also hardened during setup (no production behavior change): golden fixture uses
real seeded register numbers; SPA deep links use the HashRouter `/#/...` form;
orchestrator spawns `node` directly on Windows (`spawn .cmd` = EINVAL) and probes
both `127.0.0.1` and `::1` for Vite readiness.

## 17. Evidence index (`docs/evidence/phase14/`)

- `phase14-phase15-git-precondition.log` — Phase 15/14 precondition (HEAD `433bdbf`).
- `phase14-preflight.log` — pre-flight gate (prior run).
- `phase14-environment-inventory.md` / `phase14-contract-gap-inventory.md` — survey + gap (prior run).
- `phase14-database-safety.log` — fail-closed DB isolation gate.
- `phase14-backend.log` / `phase14-frontend.log` / `phase14-solver-service.log` — service startup.
- `phase14-playwright-test.log` — full 7-test orchestrator run (`EXIT_CODE=0`).
- `phase14-auth-evidence.log` / `phase14-golden-path.log` / `phase14-role-gating.log` — per-suite excerpts.
- `phase14-backend-regression.log`, `phase14-frontend-test.log`, `phase14-typecheck.log`,
  `phase14-frontend-typecheck.log`, `phase14-build.log` — regression gate.
- `phase14-solver-frozen-diff.log`, `phase14-final-frozen-diff.log` — frozen-solver / tracked-diff.
- `phase14-final-head.log` / `phase14-final-origin-main.log` / `phase14-final-git-status.log` /
  `phase14-final-git-log.log` — closeout git state.
- `phase14-closeout.md` — this file.

## 18. Git provenance

- `HEAD` = `433bdbf0be504652b69f9a8b884aff2cdf6bfbbd`; `origin/main` = `4725288` (HEAD ahead by 1 — Phase 15 not pushed).
- No commits created by Phase 14; nothing pushed; no history rewritten.
- Tracked working-tree changes (intentional, awaiting approval to commit):
  `package.json`/`package-lock.json` (+`@playwright/test` devDep),
  `src/phase4/api.ts` (decode + serializer fixes), `tests/phase5-auth.test.ts` (Test H).
  No other tracked modifications.
- Frozen solver diff: exit 0.
- Pre-existing untracked artifacts (phase10/12/13, benchmarks, discovery, ingestion-e2e test)
  remain untouched; Phase 14 additions are new untracked `scripts/e2e/`, `e2e/`, `docs/evidence/phase14/`.

## 19. Classification

**CASE A — VERIFIED.** The full ADMIN journey and the STAFF boundary pass in a
real browser against the real backend and the real frozen solver on a
disposable, isolated, non-production environment. Schema unchanged; solver
untouched; regression gate green.

## 20. Deferred items (unchanged, out of scope)

1. **Phase 12 audit-read support** — remains deferred (closed `AuditAction`
   enum; requires a migration; separate reviewed backend task).
2. **Academic-year / class-context model** — remains deferred (no explicit
   selection surface beyond the seeded model).
3. Truly-unresolved-row resolution (rows that fail Student-Master matching) —
   separate larger task; the Phase 15 surface handles matched-but-unvalidated rows.

## 21. Exact next action

1. On approval, commit Phase 14 as a single scoped commit (E2E scaffold +
   `@playwright/test` devDep + the two `api.ts` defect fixes + Test H), then
   push Phase 15 + Phase 14 per normal policy. Until then, **no commit/push**.
