# Phase 14 — Environment Inventory (NO CODE CHANGES)

- Date: 2026-08-17
- Status: INVENTORY COMPLETE — no production or source changes made.
- This file captures the raw findings from the environment survey (Phase 14 §3).

## 1. Backend

- HTTP surface is a single `node:http` server built by
  `createPhase4Server(options)` in `src/phase4/api.ts:78`.
- Required options: `Phase4ApiOptions extends GenerateOptions` with
  `{ registry: GenerationRegistry; requestedBy?; timeLimitSeconds;
    maxParallelDomains; solverConfig; dispatch }`.
- Routes: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
  `POST /exam-seating/generations`, `GET /exam-seating/exams`,
  `GET /exam-seating/generations/:id`, `GET /exam-seating/generations/:id/seating`,
  `GET /exam-seating/plans/:seatingPlanId`, `POST .../approve`,
  `POST .../publish`, `POST /exam-seating/documents?examId=`,
  `GET /exam-seating/documents/:id`, `GET /exam-seating/documents/:id/candidates`.
- DB: `new PrismaClient()` in `src/db.ts` (reads `DATABASE_URL`).
- Storage: `src/services/exam-document/upload.ts` — `MemoryDocumentStore` or
  `SupabaseDocumentStore` selected by `resolveStore()` in `ingest.ts:190`:
  Supabase is chosen ONLY when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are
  both present; otherwise the in-memory store is used (the exact path the
  existing test suite already exercises).
- Auth: `src/phase4/auth/` — custom username/password sessions
  (`ar_seat_session` HttpOnly cookie), `UserRole ADMIN|STAFF`,
  `createUser`/`verifyCredentials`, `requireAuth`/`requireAdmin`.
- **There is NO production entry point.** `createPhase4Server` is invoked only
  by tests. No `index.ts`/`server.ts`/`main.ts`/`.listen(` exists in `src`.
  (Pre-existing, documented in phase6-tb3 and phase7a closeouts.)
- No Express/Hono; `node:http` only.

## 2. Frontend

- `frontend/package.json`: `dev` = `vite` (default port 5173),
  `build` = `tsc -b && vite build`, `test` = `vitest run`.
- Vite proxy (`frontend/vite.config.ts`): `/auth` and `/exam-seating` →
  `VITE_API_TARGET` (default `http://localhost:8787`). Same-origin cookies flow
  through the proxy, so the HttpOnly session cookie works.
- Router (`frontend/src/App.tsx`): HashRouter. `/login`, `/exams` (ADMIN),
  `/upload` (ADMIN), `/documents/:documentId`, `/documents/:documentId/candidates`,
  `/generations/:generationId`, `/seating/:seatingPlanId`.
- Auth: `AuthContext` calls `GET /auth/me`; login posts username+password.
- Pages surfaced by the journey: LoginPage, ExamSelectionPage, UploadPage,
  DocumentStatusPage, CandidatePage (Generate), GenerationStatusPage (poll
  2.5 s), SeatingPage (Approve/Publish for ADMIN).
- No E2E/browser-automation tooling is installed (no Playwright/Puppeteer/
  Cypress/Webdriver in either package.json).

## 3. Database

- Prisma datasource: `provider = "postgresql"`, `url = env("DATABASE_URL")`,
  `directUrl = env("DIRECT_URL")` (`prisma/schema.prisma:1`).
- `.env` (values redacted, only names recorded): `DATABASE_URL`,
  `DIRECT_URL`, `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`.
  All are configured. The configured DB/storage are **live Supabase**.
- Migrations: `prisma/migrations/` has `20260812132538_init`,
  `20260813090000_exam_doc_dedup`, `20260815170000_add_auth`.
- Seed: `prisma/seed.ts` — departments (CSE/ECE/EEE/MECH), 5 classes (year 3,
  academicYear `2025-2026`), 30 students (register numbers `DEMO-CSE-001`…,
  6 per class), one hall `LH09` (5 rows × 5 columns = 25 seats).
- Test DB conventions: `scripts/setup-test-db.mjs` creates a DB derived from
  `TEST_DATABASE_URL`; `scripts/run-tests.mjs` requires the test DB name to
  contain `test` and the test URL to differ from dev; `tests/helpers.ts`
  guards on `RUN_TESTS=1` + DB name containing `exam_seating_test` and resets
  via TRUNCATE...CASCADE.
- Local/disposable option: **Docker 29.6.1 is available** (verified). No local
  Postgres service, no psql, no Supabase CLI. A disposable `postgres:16`
  container is the minimal path to a safe local DB.

## 4. Authentication

- Not BetterAuth; a minimal custom layer (`src/phase4/auth/`): `User` table
  (`username`, `email?`, `passwordHash`, `role`), `AuthSession` table
  (token hash + expiry), bcrypt-style `hashPassword`/`verifyPassword`.
- `scripts/bootstrap-admin.mjs` creates an ADMIN from `ADMIN_USERNAME`/
  `ADMIN_PASSWORD` (fails if the user already exists). No STAFF bootstrap
  helper exists.
- Deterministic disposable users can be created against the LOCAL DB with a
  small bootstrap script using the existing `createUser`; no second auth
  mechanism needed.

## 5. Storage

- PDFs upload via `POST /exam-seating/documents` → `ingestExamDocument` →
  `resolveStore` (`ingest.ts:190`).
- Two existing stores: `MemoryDocumentStore` (in-process, test-proven) and
  `SupabaseDocumentStore` (live bucket).
- **Isolation is achievable without any source change:** run the backend
  process WITHOUT `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in its env, and
  `resolveStore` falls back to `MemoryDocumentStore`. No live bucket is ever
  touched. (Verify: `resolveStore` constructs `SupabaseDocumentStore` only
  when both vars are set.)

## 6. Solver

- `solver-service/` — Python FastAPI CP-SAT service (`app/main.py`).
- Endpoints: `GET /health` (open), `POST /solve`, `POST /solve-domain`
  (guarded by `X-Internal-Token`; fail-closed via `app/config.py` —
  token must be set and not `dev-internal-token`).
- Config via `SOLVER_` env prefix (env_file `.env`); port defaults to 8000.
- **Local venv is ready** (`solver-service/.venv`): `uvicorn.exe`,
  `fastapi.exe`, `pytest`, and `ortools 9.15.6755` verified importable.
- Node dispatch: `src/phase4/solverClient.ts` POSTs to
  `${SOLVER_BASE_URL ?? http://127.0.0.1:8000}/solve-domain` with
  `X-Internal-Token` = `SOLVER_INTERNAL_TOKEN`; it REFUSES to call without a
  token and rejects the known default `dev-internal-token`.
- `.env` does NOT currently define `SOLVER_BASE_URL`/`SOLVER_INTERNAL_TOKEN`.

## 7. Browser automation

- None installed. Minimal approved harness per Phase 14: **Playwright**
  (`@playwright/test` + Chromium). No other browser framework should be added.
- Test data / fixture tooling already exists: `tests/fixture-pdf.ts`
  (`annaFixtureLines`, `buildPdf`, `buildMultiPagePdf`) using `pdf-lib`;
  extractor config `ANNA_UNIVERSITY_TEXT_TABLE_CONFIG`
  (`src/services/exam-document/extractorConfig.ts`) accepts rows of
  `SL.NO  REGISTER NUMBER  CANDIDATE NAME` with register numbers matching
  `^(DEMO-[A-Z]{2,4}-\d{3,5}|\d{6,14})$`.

## 8. Isolation decision (Phase 14 §4)

- Live Supabase is the ONLY currently configured DB/storage.
- **Docker is available** → a disposable local `postgres:16` container can
  provide an isolated DB (`exam_seating_dev` + `exam_seating_test`).
- Storage can be isolated via the existing `MemoryDocumentStore` fallback by
  env scoping (no source change).
- Solver runs locally from the existing venv.
- Browser runs locally via Playwright/Chromium.
- Conclusion: **Isolation is achievable (Case A candidate)** — NOT YET
  provisioned; nothing has been created, seeded, uploaded, or installed.
- Hard safety rule preserved: no live Supabase DB/storage mutation; no
  credentials copied; no `.env` committed.

## 9. Contract-gap discovery (STOP condition — Phase 14 §1.3)

Deterministic, source-verified gap blocking the full ADMIN journey:

- Upload persists candidates with `validationStatus: "MATCHED"`
  (`src/services/exam-document/ingest.ts:233`, upsertCandidate).
- Generation requires every candidate to be `VALIDATED`:
  - `src/phase4/reconcile.ts:66` (`validationStatus !== "VALIDATED"` →
    nonValidated → `ok=false` → `ERR_CANDIDATE_RECONCILIATION`);
  - `src/services/solverInput.service.ts:41,84` (solver input selects only
    `validationStatus: "VALIDATED"`);
  - `src/services/solveJob.service.ts:49` (candidate count filters VALIDATED).
- The transition `MATCHED → VALIDATED` EXISTS as a service
  (`src/services/candidate.service.ts:83` `transitionValidationStatus`, audit
  action `CANDIDATE_RESOLVED`) but is **never exposed**:
  - no HTTP route in `src/phase4/api.ts`; and
  - no UI affordance in the frontend (CandidatePage has no validate/resolve
    action).
- Existing tests work around this by writing `validationStatus: "VALIDATED"`
  directly in test setup (e.g. `tests/phase10-plan-read.test.ts:111`), which
  Phase 14 §1.2 forbids during the acceptance journey.
- Consequence: through the real UI with the real backend, the journey blocks
  deterministically at **Generate → FAILED_RECONCILIATION
  (ERR_CANDIDATE_RECONCILIATION)**; APPROVED/PUBLISHED are unreachable
  without a product change, which Phase 14 §1.3 forbids.
