# Phase 10 Slice 3 — Generation Flow HTTP Inventory (empirically verified)

Date: 2026-08-17
Slice 3 task: Generation Flow (Candidate Review -> Generate Seating -> Generation Status -> View Seating).

Status: **STOPPED then unblocked** — a required piece of the HTTP surface was
missing for the objective flow. The exact gap was recorded below and resolved by
a separately commissioned backend task (`GET /exam-seating/plans/:seatingPlanId`,
see §5 and §8). This inventory documents the surface and the gap.

## 1. Rules applied

- Inventory-first rule (`phase10-slice3` spec §1): every route below was verified
  against `src/phase4/api.ts` and the existing backend test suites before any
  implementation.
- Existing architecture is authoritative (§2). No backend changes were made (§23).
- No code changes, no new files other than this inventory and the closeout report.
- Frozen solver boundary untouched.

## 2. Route inventory

### 2.1 Generate Seating — EXISTS (usable)

- **Route:** `POST /exam-seating/generations` (`src/phase4/api.ts:108-112`)
- **Authentication:** ADMIN only (`requireAdmin`) -> 401 unauthenticated, 403 non-admin.
- **Request body:** `{ examId, timeLimitSeconds?, maxParallelDomains? }`
- **Responses:**
  - `200` when the synchronous generation completes in a terminal state
    (`COMPLETED`, `FAILED_*`, `CANCELLED`): `{ generationId, state, plan, error, ... }`
  - `202` when the state is still in-progress: `{ generationId, state, pollUrl, jobId }`
  - `400 MISSING_EXAM_ID`, `409 ERR_JOB_ALREADY_ACTIVE` (duplicate generation for an
    exam with an active job), `401`, `403`
- **Behavior:** `runSeatingGeneration` runs inline against the real solver, then
  `persistValidatedGeneration` (`src/phase4/persist.ts:52-92`) creates a `SeatingPlan`
  with **`status: "DRAFT"`** (`src/services/seatingPlan.service.ts:61`).
- **Empirical basis:** `tests/phase9-upload.test.ts` (Test C, 200/202 contract),
  `tests/phase5-auth.test.ts` (Test C, 401/403), `src/phase4/api.ts` source.

### 2.2 Generation Status — EXISTS (usable)

- **Route:** `GET /exam-seating/generations/:id` (`src/phase4/api.ts:114-125`)
- **Authentication:** authenticated (both roles) -> 401 unauthenticated.
- **Responses:** `200` with the serialized `GenerationResult` (state, domain stats,
  `plan: { seatingPlanId, version, solverStatus } | null`, `error`), `404 GENERATION_NOT_FOUND`.
- **Caveat (non-blocking, documented):** the status route reads an **in-memory
  registry** (`options.registry`), not `SolveJob` rows. After a server restart the
  registry is empty and a previously-created generation id returns
  `404 GENERATION_NOT_FOUND`. Within a live session the flow is correct.
- **Empirical basis:** `tests/api-error-sanitization.test.ts` (404 contract),
  `tests/plan-not-found.test.ts` (401/404), `src/phase4/api.ts` source.

### 2.3 View Seating — EXISTS as a route, BLOCKED for this slice's flow

- **Route:** `GET /exam-seating/generations/:id/seating` (`src/phase4/api.ts:127-139`)
- **Authentication:** authenticated (both roles) -> 401 unauthenticated.
- **Responses:**
  - `200 { plan }` ONLY when a **PUBLISHED** seating plan exists for the generation's exam
  - `404 PLAN_NOT_FOUND` otherwise
  - `404 GENERATION_NOT_FOUND` for an unknown generation id
- **Empirical basis:** `tests/plan-not-found.test.ts:131-161` — "existing published
  plan -> 200", "missing published plan -> intentional 404 PLAN_NOT_FOUND".

## 3. The blocking gap (STOP condition, §22)

The objective flow "Generate Seating -> Generation Status -> View Seating" cannot
display the just-generated seating through the existing contract:

1. `persistValidatedGeneration` creates plans with **`status: "DRAFT"`**
   (`src/phase4/persist.ts:52-92`).
2. The only seating-retrieval route resolves the plan via
   `getSeatingPlanForExam` (`src/phase4/persist.ts:150-175`), which filters
   `status: "PUBLISHED"` and otherwise throws `PLAN_NOT_FOUND`.
3. Publishing is **out of scope for this slice** (deferred per earlier phase
   planning); `publishPlan` exists as a service (`src/services/seatingPlan.service.ts:85`)
   but is **not exposed as an HTTP route**.
4. There is **no route anywhere** that reads a `DRAFT`/`APPROVED` plan's
   assignments. A frontend generation flow would therefore receive
   `404 PLAN_NOT_FOUND` immediately after a successful generation and cannot render
   the generated seating.

`src/phase4/proforma.ts:281` also reads only from `getSeatingPlanForExam`
(PUBLISHED-only), confirming there is no second read path.

## 4. Frontend client status

`frontend/src/lib/api.ts` has **no** generation/status/seating client functions
(only documents/candidates/exams from earlier slices). A frontend implementation
would be new code, but it is blocked by the §3 gap.

## 5. Exact missing surface (proposed separate backend task)

A small, reviewed backend task is required before this slice can proceed:

- **Recommended:** expose a read of a plan's assignments by plan id, authenticated
  to both roles, e.g. `GET /exam-seating/plans/:seatingPlanId` returning
  `{ plan }` with its `assignments`, `hall`s, and `hallSeat`s regardless of plan
  status (`DRAFT`/`APPROVED`/`PUBLISHED`). The generation-status response already
  exposes `plan.seatingPlanId`, so the frontend could navigate
  status -> plan by id without inventing ids.
- Leave the existing `GET /exam-seating/generations/:id/seating` contract
  (PUBLISHED-only) untouched so the Phase 7c `PLAN_NOT_FOUND` semantics are preserved.

## 6. Rules and security constraints already satisfied

- Generation/status/seating routes are ADMIN-only or both-role as documented; error
  responses are intentional codes (`MISSING_EXAM_ID`, `ERR_JOB_ALREADY_ACTIVE`,
  `GENERATION_NOT_FOUND`, `PLAN_NOT_FOUND`, `INTERNAL_ERROR`) with no internal
  details (proven by `tests/api-error-sanitization.test.ts` and
  `tests/plan-not-found.test.ts`).
- The frozen solver boundary was not touched.

## 8. Resolution — commissioned backend task (implemented)

The recommended route was implemented and verified:

- **Route:** `GET /exam-seating/plans/:seatingPlanId` (`src/phase4/api.ts`)
- **Authentication:** authenticated, both roles (mirrors the status and seating routes)
- **Behavior:** returns `{ plan }` via the existing `serializeSeating`, with
  assignments + `examCandidate`/`hall`/`hallSeat` snapshots, for a plan of **any
  status** (`DRAFT`/`APPROVED`/`PUBLISHED`). Unknown id -> intentional `404
  PLAN_NOT_FOUND` (no internal details).
- **Implementation:** `getSeatingPlanById` in `src/phase4/persist.ts`, sharing the
  exact `SEATING_PLAN_INCLUDE` used by the PUBLISHED-only `getSeatingPlanForExam`,
  so the two reads cannot drift.
- **Tests:** `tests/phase10-plan-read.test.ts` (5) — 401 unauthenticated, ADMIN 200
  with assignment snapshots for a DRAFT plan, STAFF 200, unknown id 404
  `PLAN_NOT_FOUND`, and a guard asserting the DRAFT plan is readable here while
  `GET /exam-seating/generations/:id/seating` still returns 404 for it.
- **Verification:** focused regression 37/37 (phase10-plan-read 5, plan-not-found 5,
  api-error-sanitization 4, phase5-auth 7, phase9-upload 12, phase10-exams 4);
  root `tsc --noEmit` clean; frozen solver diff exit 0.

## 9. Evidence references

- `src/phase4/api.ts` lines 11, 29, 108-139, 178-179 (routes + error mapping)
- `src/phase4/persist.ts` lines 52-92, 150-175 (DRAFT persistence; PUBLISHED-only read)
- `src/services/seatingPlan.service.ts` lines 6-11, 36-67, 85-116 (status model; publish is service-only)
- `prisma/schema.prisma` lines 65-86 (SeatingPlanStatus/SolveJobStatus/SolverStatus), 260-330 (models)
- `tests/plan-not-found.test.ts`, `tests/api-error-sanitization.test.ts`,
  `tests/phase9-upload.test.ts`, `tests/phase5-auth.test.ts` (contract proofs)
- `tests/phase10-plan-read.test.ts` (new plan-by-id route proofs)