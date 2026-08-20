# AR-SEAT Test Inventory

Compiled from root `tests/` (29 files), `e2e/specs/` (4 files), frontend test files, and prior gate evidence. **No full-suite re-run performed during this gate** (inventory-only); the authoritative recent runs are from Phase 16 closeout and the auth-fix verification.

## Backend unit/integration (`tests/`, vitest)

**Count:** ~218 tests across 29 root files (Phase 16 closeout: **215 passed / 3 skipped**, 690.19 s, 28 files executed + 1 storage-integration file skipped without `STORAGE_INTEGRATION=1`; targeted phase16 run 26/26).

Coverage areas (source-aligned):
- `tests/phase1/` auth/session/password hashing
- `tests/phase2/` candidate/exam-document validation, extract, normalize
- `tests/phase3/` partition/guard/validation/orchestration (deterministic)
- `tests/phase4/` generation service, solver input, persistence, API surface, E2E-ish ingestion (`phase4-ingestion-e2e.test.ts`), audit-read (`phase16-audit-read.test.ts`)
- `tests/` root: student, hall, department, class, candidate, exam-document, solver-input, seating-plan, seat-assignment, candidate-reconcile, exam-service, solver tests, solve-job
- Storage-integration suite: 3 tests, **skipped by default** (require `STORAGE_INTEGRATION=1` + Supabase env)

**Solver (Python):** `solver-service/` pytest suites (referenced in `docs/evidence/phase3-benchmarks/partitioned-pytest.log`).

## Frontend (vitest)

**Count:** 106/106 passing (auth-fix verification), 8 test files. Covers: AuthAndLogin, UploadPage, AuditPage, api client, layout/nav, routes. Typecheck + build pass.

## E2E (Playwright, `e2e/specs/`, against local Docker DB + real solver + real backend)

**Count:** 10/10 passing (Phase 16 closeout).

| Spec | Tests | Scope |
|---|---|---|
| `auth.spec.ts` | 3 | login/logout/me + STAFF login |
| `audit-read.spec.ts` | 3 | ADMIN audit log page, sanitization, paging |
| `golden-path.spec.ts` | 1 | upload → parse → resolve → generate → approve → publish (full happy path) |
| `role-gating.spec.ts` | 3 | STAFF blocked from ADMIN routes |

## Test-DB safety (VERIFIED)

- `scripts/run-tests.mjs` refuses when dev and test DBs are identical; must contain "test".
- `tests/helpers.ts` `verifyTestDatabase`: requires `RUN_TESTS=1` and DB name containing `exam_seating_test`.
- E2E runs against a fail-closed disposable local Docker postgres on `127.0.0.1:55432` (`ar-seat-e2e-db`), seeded by `scripts/e2e/seed.mjs`, destroyed by `run-e2e.mjs` teardown.

## Evidence catalog (prior gates, uncommitted but present)

- `docs/evidence/phase3-benchmarks/` — partitioned closeout logs, pytest log, legacy comparison, scaling checks
- `docs/evidence/phase4-benchmarks/` — generation benchmarks
- `docs/evidence/phase5-auth/` … `phase8b/`, `phase10-verified-bundle.zip`, `phase12/`, `phase13/`
- `docs/evidence/phase16/` — root-cause, closeout, targeted-run logs (**215/3** full suite evidence)
- `docs/evidence/auth-fix/` — frontend Fast Refresh fix evidence (**106/106**, HMR clean, Playwright)

## Gaps in test coverage (mirrors feature gaps)

- No tests for student/department/class/hall CRUD (no such surface).
- No tests for exam creation via API (no route).
- No tests for seating-PDF download (no route).
- No gender-split tests (feature absent).
- No multi-tenant/RLS tests (single-tenant by design).
- Frontend has no tests for ExamsPage/GenerationPage/SeatingPlanPage UI specifics beyond what exists (core pages covered; admin-only surfaces via E2E).