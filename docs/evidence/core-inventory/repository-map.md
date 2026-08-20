# AR-SEAT Repository Map

Ground-truth layout of `D:\Startup\prototype\AR-SEAT` at HEAD `d3b6d56`. Structure captured from directory listing + source reads.

## Top-level

| Path | Purpose |
|---|---|
| `src/` | TypeScript backend (Fastify app, services, phase4 surface) |
| `solver-service/` | **Frozen** Python CP-SAT solver (own FastAPI app) |
| `frontend/` | React + Vite + TanStack Query + react-router SPA |
| `prisma/` | Schema + 3 migrations + seed + generated client |
| `scripts/` | Dev/DB/test tooling (`dev-all.mjs`, `run-tests.mjs`, `setup-test-db.mjs`, `e2e/*`) |
| `tests/` | Backend vitest suites (29 root files) |
| `e2e/` | Playwright specs (`auth`, `audit-read`, `golden-path`, `role-gating`) + helpers |
| `docs/` | Design docs + `evidence/` gate deliverables |
| `docker/` | Dockerfiles (frontend, solver, root) + seed dockerfile |
| `.env.example` | Documented environment surface |

## Backend (`src/`)

| File | Role |
|---|---|
| `index.ts`, `app.ts` | Fastify bootstrap + plugin registration |
| `db.ts` | Prisma client singleton |
| `errors.ts` | `SeatingError` + codes |
| `auth/` | Password hashing (argon2), session service, cookie handling, `requireAuth`/`requireAdmin` guards |
| `services/exam.service.ts` | `createExam`/`getExam`/`listExams`/`transitionExamStatus` (+ `ALLOWED_TRANSITIONS`) |
| `services/hall.service.ts` | `createHall`, `deriveHallCapacity`, `getHallSeat`, `setHallSeatActive`, `seatPositionsFor` |
| `services/candidate.service.ts` | `createCandidate` (snapshot derivation from Student master), `transitionValidationStatus` |
| `services/seatAssignment.service.ts` | `assignCandidateSeat` (plan/candidate/seat validation) |
| `services/audit.service.ts` | `logAudit` + `SEATING_AUDIT_ACTIONS` whitelist + sanitizer |
| `services/solveJob.service.ts` | `completeSolve`/`failSolve`/`markInfeasible` lifecycle |
| `services/solverInput.service.ts` | `buildSolverInput` (VALIDATED candidates + active halls) |
| `services/exam-document/` | `ingest.ts`, `extract.ts` (ANNA_UNIVERSITY_TEXT_TABLE_CONFIG), `normalize.ts`, `validate.ts` — real PDF pipeline |
| `phase4/` | The only HTTP surface: `api.ts` (15 routes), `generation.service.ts`, `partition.ts`, `persist.ts`, `validateMerge.ts`, `workerPool.ts`, `reconcile.ts`, `integration.ts`, `topology.ts`, `types.ts`, `config.ts` |
| `phase4/proforma.ts` | Real Proforma-1 PDF generator (pdf-lib) — **not route-exposed** |

## Solver (`solver-service/app/`)

`main.py` (FastAPI `/health`, `/solve`, `/solve-domain`; `X-Internal-Token`), `models.py` (contract), `constraints.py` (8-neighbourhood adjacency), `seatlabel.py`, `partition.py`, `graph.py`, `oracle.py`, `validation.py`, `assign.py`, `guards.py`, `config.py`. No solver changes are permitted (frozen baseline).

## Frontend (`frontend/src/`)

`App.tsx` (routes + Layout + AuthProvider), `main.tsx`, `styles.css`, `lib/api.ts` (fetch client), `lib/types.ts`, `lib/queryClient.ts`, `auth/AuthContext.tsx` + `auth/auth-context.ts` (Fast Refresh fix), `test/harness.tsx`. Components: `Layout`, `LoginPage`, `HomePage`, `ExamsPage`, `UploadPage`, `DocumentStatusPage`, `CandidatePage`, `GenerationPage`, `SeatingPlanPage`, `AuditPage`, `AppRoutes`-related. See `feature-matrix.md`.

## Config / tooling

`package.json` (root scripts), `tsconfig.json`, `vite.config.ts`, `frontend/package.json`, `docker/*`, `scripts/`. `scripts/dev-all.mjs` (uncommitted) coordinates postgres + backend + solver + frontend.

## Noteworthy untracked/uncommitted state

- **Uncommitted (intended):** Phase 16 audit-read API + tests + E2E, auth Fast Refresh fix, `scripts/dev-all.mjs`, `tests/phase4-ingestion-e2e.test.ts`, evidence dirs (`auth-fix/`, `phase16/`, `phase12/`, `phase13/`, `phase7a/`, `phase8b/`, `phase4-benchmarks/`, `phase3-benchmarks/`), `test-results/`.
- **Oddity:** stray untracked file `eating prototype•` (junk; flagged for cleanup, not part of the gate).
- No `docker-compose.yml` exists (services started individually or via `dev-all.mjs`).