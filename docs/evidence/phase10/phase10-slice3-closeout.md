# Phase 10 Slice 3 — Closeout (COMPLETED)

Date: 2026-08-17
Classification: **COMPLETED** — began with an inventory-driven STOP, unblocked by a
separately commissioned backend read route, then the frontend generation flow was
implemented on top of it.

## 1. Initial finding (STOP condition, §22)

Verified that `POST /exam-seating/generations` (ADMIN) and
`GET /exam-seating/generations/:id` (authenticated) exist, but the only seating
retrieval route (`GET /exam-seating/generations/:id/seating`) returns **PUBLISHED
plans only**, while generation persists **DRAFT** plans and publish is out of
scope. No route returned a DRAFT/APPROVED plan's assignments. Full inventory in
`phase10-slice3-generation-inventory.md`.

## 2. Backend task (commissioned by user, implemented, verified)

- **New route:** `GET /exam-seating/plans/:seatingPlanId` (authenticated, both
  roles) -> `{ plan }` with assignments, any plan status. Unknown id -> intentional
  `404 PLAN_NOT_FOUND` (no internal details).
- `getSeatingPlanById` in `src/phase4/persist.ts`, sharing the exact
  `SEATING_PLAN_INCLUDE` as the PUBLISHED-only read (no drift).
- `tests/phase10-plan-read.test.ts` (5): 401, ADMIN DRAFT read with assignment
  snapshots, STAFF read, unknown-id 404, and a guard that the PUBLISHED-only route
  still 404s for the same DRAFT plan.

## 3. Frontend slice (implemented, verified)

- **API client** (`frontend/src/lib/api.ts` + types): `generateSeating(examId)`,
  `getGenerationStatus(generationId)`, `getSeatingPlan(seatingPlanId)`; typed
  `GenerationState`/`GenerationStatus`/`GenerationCreated`/`SeatingPlan` matching
  the backend serializers.
- **CandidatePage:** ADMIN-only "Generate seating" action, in-flight disablement
  (duplicate-click guard), 409 `ERR_JOB_ALREADY_ACTIVE` surfaced as
  "already in progress" without navigating; STAFF sees no action. Uses the backend
  document's `examId` (refresh-safe).
- **GenerationStatusPage** (`/generations/:generationId`): status + minimal polling
  (2.5s, stops at terminal/error, cleared on unmount), COMPLETED/FAILED/CANCELLED
  rendering, only the backend error **code** is shown (no raw message -> no
  internal leak), "View seating plan" -> `/seating/:seatingPlanId`.
- **SeatingPage** (`/seating/:seatingPlanId`): renders the backend plan directly
  (id, exam, version, status, assignments grouped by hall with seat/register/
  student/class); empty and 404 `PLAN_NOT_FOUND` states; DRAFT shown honestly.
- **App routes** wired under RequireAuth; no fabricated fields anywhere.

## 4. Tests and verification

- Backend focused regression: **41/41** across 7 suites — phase10-plan-read 5,
  plan-not-found 5, api-error-sanitization 4, phase5-auth 7, phase9-upload 12,
  phase10-exams 4, publication-race 4.
- Frontend: **79/79** across 8 files (api 15, CandidatePage 12, DocumentStatusPage 9,
  ExamSelectionPage 6, GenerationStatusPage 8, SeatingPage 6, UploadPage 14,
  AuthAndLogin 9). Frontend `tsc --noEmit` clean. Production build OK (48 modules,
  ~198.6 kB JS / 7.02 kB CSS pre-gzip).
- Root `tsc --noEmit` clean. Frozen solver diff `git diff --exit-code HEAD --
  solver-service/app/` exit 0.
- pytest: not run (no solver changes).
- Full `npm test` (entire backend suite in one invocation): NOT run; the Slice 3
  regression list was executed as focused per-file runs against the isolated test
  database (honest classification).

## 5. Error-safety assertions

Browser-visible strings were asserted to exclude `Prisma`, `schema.prisma`, `D:\`,
`stack`, `SQL`, `CP-SAT`, `traceback` in the generation status, seating, and
candidate generation tests. The generation status page renders only backend error
codes, never raw error messages.

## 6. Staging / commit state

- No commit, no push.
- Slice 3 files are intentionally NOT staged: the index already holds the 16
  previously-staged Slice 2 files whose commit is still awaiting an explicit
  instruction. Mixing would collapse the two slices into one commit; composition
  (Slice 2 commit, then Slice 3 commit) is deferred to the explicit instruction.
- Pre-existing untracked artifacts remain untouched.

## 7. Files

Backend:
- `src/phase4/persist.ts` (getSeatingPlanById + shared include), `src/phase4/api.ts`
  (route), `tests/phase10-plan-read.test.ts`.

Frontend:
- `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`, `frontend/src/App.tsx`,
  `frontend/src/components/CandidatePage.tsx`, new
  `frontend/src/components/GenerationStatusPage.tsx`, new
  `frontend/src/components/SeatingPage.tsx`, and tests
  (`CandidatePage.test.tsx`, `api.test.ts`, `GenerationStatusPage.test.tsx`,
  `SeatingPage.test.tsx`).

Docs:
- `docs/evidence/phase10/phase10-slice3-generation-inventory.md`,
  `docs/evidence/phase10/phase10-slice3-closeout.md`.