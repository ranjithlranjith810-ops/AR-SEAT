# Phase 19 — Implementation Notes

Ground truth: `docs/evidence/phase19/phase19-discovery.md` (kept verbatim; contradiction analysis below).
Phase 18 prompt revisions: `docs/phase18-prompt-revised.md`.
Phase 18 evidence baseline: `docs/evidence/phase18/`.

## Objective

Implement "Exam Management" as specified by the Phase 19 directive, grounded in the actual
repository model. No commit, no push. Frozen solver + solver-input boundaries untouched.

## Material contradictions found during discovery

The discovery doc was written verbatim (all 15 sections + Final Status) and is preserved
unchanged. Where the specification text contradicted the actual repository, the implementation
follows the repository and the contradiction is recorded here:

| # | Spec/directive statement | Actual repository |
|---|--------------------------|-------------------|
| 1 | `ExamStatus` includes `DOCUMENT_UPLOADED / VALIDATED / SEATED` | Actual: `DRAFT, READY, GENERATING, GENERATED, APPROVED, PUBLISHED, CANCELLED` |
| 2 | `CandidateValidationStatus` includes `INVALID_STUDENT / DUPLICATE` | Actual: `UNVERIFIED, MATCHED, VALIDATED, REJECTED`. Duplicates are `IssueCode` values (`DUPLICATE_IN_EXAM`), not statuses |
| 3 | Exam has `code` and `title` fields | Actual: Exam has `examType`; no `code`/`title` |
| 4 | `UploadedExamDocument` one-per-exam with `examId @@unique` | Actual: dedup is `@@unique([examId, fileHash])`; multiple documents per exam allowed |
| 5 | API prefix `/api/exams` | Actual: `/exam-seating/...` |
| 6 | POST create-exam route exists | Actual: no POST create-exam route; exams come from seed (`createExam` service exists) |
| 7 | UI in `frontend/src/pages/` | Actual: components in `frontend/src/components/` |
| 8 | Service paths `src/services/exam.service.ts` + `candidate.service.ts` | Actual: those exist; plus `solverInput.service.ts` + `seatingPlan.service.ts` (used for cancelExam guard + conflict support) |
| 9 | Tests `tests/exam.test.ts` / `candidate-validation.test.ts` | Actual: `phase10-exams.test.ts`, `phase10-plan-read.test.ts`, `exam-document.test.ts`, `candidate.test.ts` |
| 10 | E2E `e2e/specs/exam-management.spec.ts` does not exist | New spec created this phase |
| 11 | Audit action names | Actual names e.g. `PDF_UPLOADED`, `CANDIDATE_MATCHED`, `SOLVE_*`, `PLAN_*`; five new Phase 19 actions added to the enum |

Decision (user-approved): implement against the actual repository model; discovery doc stays verbatim.

## Runtime fact recorded during discovery

Nothing in the codebase sets `GENERATING`/`GENERATED` at runtime today (they only appear in the
transition map). Exams remain `DRAFT` until cancelled. All mutability/cancellation guards are
therefore defensive and future-proof.

## Scope decisions

- **Conflict detection** is delivered as a pre-flight endpoint (`GET /exam-seating/exams/:id/conflicts`).
  The generation orchestrator is NOT modified; the administrator decides to exclude conflicted
  candidates before generation.
- **Resolve** is intentionally NOT added to the exam-management page: resolution is document-scoped
  and manual candidates have `sourceDocumentId: null`. Manual candidates enter as `MATCHED` and are
  validated through the existing document flow or via future phase work.
- **CSV import** is out of scope (implementation directive is authoritative).

## What was implemented

### Schema (Prisma)
- `prisma/schema.prisma` — `AuditAction` enum extended with:
  `EXAM_CANCELLED`, `EXAM_CONFLICT_CHECKED`, `EXAM_CANDIDATE_ADDED`,
  `EXAM_CANDIDATE_EXCLUDED`, `EXAM_CANDIDATE_REINSTATED`.
- New migration `prisma/migrations/20260819160000_add_phase19_audit_actions/migration.sql`
  (five `ALTER TYPE "AuditAction" ADD VALUE` statements). Prisma client regenerated; migration
  applied to the test database.

### Backend services
- `src/services/exam.service.ts`
  - `assertExamCandidatesMutable(examId)` → throws `EXAM_NOT_MUTABLE` when exam status is
    `GENERATING / APPROVED / PUBLISHED / CANCELLED`.
  - `cancelExam(examId, { reason, actorId })` → asserts transition `{ ... } -> CANCELLED`,
    blocks cancellation while a `QUEUED`/`RUNNING` solve job exists for the exam
    (`EXAM_CANCELLATION_BLOCKED_ACTIVE_GENERATION`), writes an `EXAM_CANCELLED` audit entry
    with the reason.
- `src/services/candidate.service.ts`
  - Transition map extended: `REJECTED: ["MATCHED"]` (reinstate re-enters the validate path).
  - `addCandidateFromMaster(examId, studentId, { reason?, subjectCode?, actorId? })` →
    validates exam mutability, rejects unknown student (`STUDENT_NOT_FOUND`), rejects duplicate
    student per exam (`STUDENT_ALREADY_CANDIDATE`), creates candidate with master snapshots,
    `validationStatus = MATCHED`, `subjectCode` default `"MANUAL"`, `sourceDocumentId = null`;
    writes `EXAM_CANDIDATE_ADDED` audit entry.
  - `excludeCandidate(examId, candidateId, reason, actorId)` → requires non-empty reason
    (`INVALID_INPUT`), mutability guard, validates `VALIDATED/MATCHED -> REJECTED`, writes
    `EXAM_CANDIDATE_EXCLUDED` with reason + previous status.
  - `reinstateCandidate(examId, candidateId, actorId)` → validates `REJECTED -> MATCHED`,
    writes `EXAM_CANDIDATE_REINSTATED`.
- `src/services/conflict.service.ts` (new) — `checkExamConflicts(examId)`:
  - loads the exam, all non-REJECTED candidates of the exam, and all exams whose candidates share
    a student with this exam;
  - conflict rule: same UTC calendar day + same session;
  - groups per student, orders by register number, returns `{ examId, examDate, session, conflicts }`
    where each conflict lists `conflictingExams` (ExamCandidateRef rows).
  - rejects unknown exams with `EXAM_NOT_FOUND`.

### Backend API (`src/phase4/api.ts`)
New routes (all ADMIN-gated):
- `GET /exam-seating/exams/:id/conflicts` → 200 conflict report; writes `EXAM_CONFLICT_CHECKED` audit.
- `GET /exam-seating/exams/:id/candidates?limit&offset` → 200 `{ examId, total, offset, limit, candidates }`.
- `POST /exam-seating/exams/:id/candidates` `{ studentId, reason? }` → 201/200 added candidate.
- `POST /exam-seating/exams/:id/candidates/:candidateId/exclude` `{ reason }`.
- `POST /exam-seating/exams/:id/candidates/:candidateId/reinstate`.
- `POST /exam-seating/exams/:id/cancel` `{ reason? }` → 200 updated exam.
New error mappings → 409 CONFLICT: `EXAM_NOT_MUTABLE`, `STUDENT_ALREADY_CANDIDATE`,
`EXAM_CANCELLATION_BLOCKED_ACTIVE_GENERATION`. Handlers + `serializeConflictReport` added.
Header comment updated with the new routes.

### Backend tests (new, 38 tests)
- `tests/phase19-conflict.test.ts` (12) — empty exam, same date+session, symmetric reporting,
  single-exam no-flag, REJECTED-ignored, different day/session, same-day-different-clock-time,
  grouping/ordering, STAFF 403, ADMIN 200 + audit, unknown exam 404.
- `tests/phase19-candidate-management.test.ts` (26) — addCandidateFromMaster (snapshots, duplicate,
  unknown student, APPROVED/CANCELLED lock, solver gate), exclude/reinstate (reason required,
  APPROVED lock, already-excluded, reinstate, never-excluded), cancelExam (DRAFT ok, PUBLISHED
  refused, active-generation refused), API surface (ADMIN-only, 400/404/409s, round-trip).

### Frontend
- `frontend/src/lib/types.ts` — new `AUDIT_ACTIONS` values; `ExamCandidateRef`, `ExamConflict`,
  `ExamConflictReport`, `ExamCandidatePage`.
- `frontend/src/lib/api.ts` — `getExamConflicts`, `getExamCandidates`, `addExamCandidate`,
  `excludeExamCandidate`, `reinstateExamCandidate`, `cancelExam`.
- `frontend/src/components/ExamCandidatesPage.tsx` (new) — exam summary, schedule-conflicts panel
  (Check conflicts + result table), add-candidate-from-master (student search via `listStudents`,
  select, reason), paginated roster with per-row exclusion-reason input and Exclude/Reinstate,
  cancel-exam section, Back link, error mappers for all new error codes.
  Styling follows existing conventions only (`.panel`, `.panel--subsection`, `.field`,
  `.button`, `.button--primary`, `.button--ghost`, `.table-wrap`, `.pagination`, `.detail-list`).
- `frontend/src/App.tsx` — route `/exams/:examId/candidates` (ADMIN via `RequireAdmin`).
- `frontend/src/components/ExamSelectionPage.tsx` — "Manage candidates" link per exam row.
- `frontend/src/components/CandidatePage.tsx` — "Manage all candidates for this exam" link (ADMIN).
- `frontend/src/components/ExamCandidatesPage.test.tsx` (new, 10 tests).

### E2E
- `scripts/e2e/seed.mjs` — added `conflictExam` (2026-05-12 FN; DEMO-CSE-005/006 ingested MATCHED),
  `manageExam` (2026-05-12 FN; the add/exclude/reinstate target), `cancelExam` (2026-05-14 AN);
  all added to `E2E_SEED_STATE`.
- `e2e/helpers.ts` — `SeedState` extended.
- `e2e/specs/exam-management.spec.ts` (new, 3 tests) — admin adds a candidate, detects the
  conflict with `conflictExam`, excludes with a reason (no conflicts afterwards), reinstates;
  admin cancels `cancelExam` with a reason; STAFF is denied the page.

## Files touched (Phase 19 scope only)

Backend: `prisma/schema.prisma`, `prisma/migrations/20260819160000_add_phase19_audit_actions/`,
`src/services/exam.service.ts`, `src/services/candidate.service.ts`, `src/services/conflict.service.ts`,
`src/phase4/api.ts`, `tests/phase19-conflict.test.ts`, `tests/phase19-candidate-management.test.ts`.
Frontend: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`,
`frontend/src/components/ExamCandidatesPage.tsx`, `frontend/src/components/ExamCandidatesPage.test.tsx`,
`frontend/src/App.tsx`, `frontend/src/components/ExamSelectionPage.tsx`,
`frontend/src/components/CandidatePage.tsx`.
E2E: `scripts/e2e/seed.mjs`, `e2e/helpers.ts`, `e2e/specs/exam-management.spec.ts`.

Frozen boundaries verified unchanged (SHA-256 recorded in `phase19-frozen-hashes.log`).

## Verification summary

See `phase19-verification.md`. Backend 275 tests green; frontend 149/149 green; E2E 24/24 green.
One pre-existing backend integration test (`phase4-persistence`) is borderline vs the 30s global
testTimeout under Supabase pooler latency; it passed at 18.8–25.9s in later runs and is unrelated
to Phase 19 (file untouched; phase changes are additive). Four part-2 failures were transient
"Can't reach database server" pooler connectivity errors and passed cleanly on immediate retry.