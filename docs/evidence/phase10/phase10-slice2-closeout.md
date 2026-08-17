# Phase 10 — Frontend / Product Wiring Slice 2 Close-out

Status: COMPLETE (Slice 2). Commit is staged via the gate below and held for the
explicit finalization instruction.
Date: 2026-08-17
Phase: Phase 10 — Frontend/Product Surface (Slice 2: Select exam -> Upload -> Processing -> Candidate review, NEEDS_REVIEW first-class)

## Scope delivered

Slice 2 turns the ADMIN workflow into a backend-guided flow:
`Select exam -> Upload -> Processing -> Candidate review`, with `NEEDS_REVIEW`
presented as a first-class informative state. Generation wiring is intentionally
NOT part of this slice.

User decisions locked for this slice:
1. Add a minimal **`GET /exam-seating/exams`** backend unit (the previously
   DEFERRED exam-list gap) as a small reviewed change.
2. Defer generation UI/plumbing to **Slice 3** (endpoints already exist and are
   API-tested; Slice 3 will reconfirm at its opening).
3. Frontend renders **only backend-returned exam context**; the Exam record has
   no academic-year or class-context field, and that gap is recorded as a
   DEFERRED backend note rather than fabricated client-side.

## Routes wired

| Frontend surface | Backend endpoint | Permission | Change |
| --- | --- | --- | --- |
| Exam selection (`/exams`) | **`GET /exam-seating/exams`** (NEW) | ADMIN-only | added |
| Upload form | `POST /exam-seating/documents?examId=<id>` | ADMIN-only | unchanged |
| Ingestion status | `GET /exam-seating/documents/:id` | authenticated | unchanged |
| Candidate review | `GET /exam-seating/documents/:id/candidates` | authenticated | unchanged |

The new endpoint reuses the existing `Exam` service module (`listExams()` in
`src/services/exam.service.ts`) and a serializer in `src/phase4/api.ts` that
returns only backend-owned fields (`id`, `examDate`, `session`, `examType`,
`status`, `createdAt`, `updatedAt`), ordered by `examDate desc`. It carries an
explicit `requireAdmin` guard — consistent with the ADMIN-only upload and
generation surfaces — so unauthenticated and non-ADMIN requests both get an
intentional response (401 / 403), matching the standing rule that every route
has an explicit auth check with 401 **and** 403 tests in the same change.

## Product behavior implemented

- **ExamSelectionPage (`/exams`, ADMIN)**: fetches the backend exam list; shows
  loading, empty, and safe-error + Retry states; each row presents exam context
  exactly as returned (date, session, examType, status). Selecting an exam
  navigates to `/upload` passing `{ examId, exam }` via router state.
- **UploadPage**: consumes the selection — a "Selected exam" panel shows the
  backend-returned context, the Exam ID field is locked with a "Change exam"
  link back to `/exams`, and the submit uses the preselected exam ID. Manual
  exam-ID entry remains as a fallback for direct navigation (unchanged contract).
- **DocumentStatusPage NEEDS_REVIEW is first-class**: a dedicated
  `NEEDS_REVIEW` summary block renders `Matched candidates` (from
  `GET .../candidates?limit=1&offset=0` total — a lightweight one-row page used
  only for the count) and `Unresolved rows` (from numeric `issues` values in
  `parseMetadata`, never fabricated), an explanatory sentence referencing the
  Student Master, and a `View {n} candidates` action. If either count is
  unknown the block degrades gracefully (no fabricated number, plain
  "View candidates").
- **HomePage / Layout**: ADMIN entry point now leads to exam selection; nav adds
  an ADMIN-only "Exams" item. STAFF guidance unchanged.
- **Route protection**: `/exams` is wrapped in `RequireAdmin` (frontend role
  gating is UX only; the real boundary is the backend 401/403 guard).

## Standing rules satisfied

- Explicit auth on the new route; 401 + 403 tests in the same change.
- No invented academic-year/class context — the record does not have those
  fields, and the response does not fabricate them (test asserts their absence).
- No Publish / Approve / Generate surfaces added.
- Rule 5: no internal/stack details reach the browser; all new error surfaces
  are purpose-built message strings.
- NEEDS_REVIEW counts come only from backend fields (candidates `total` and
  numeric `issues` values).
- Frozen solver files untouched (diff clean, see verification).

## Tests & verification

Frontend (`frontend/`, vitest + jsdom) — `frontend-slice2-test.log`:
- **6 files, 56/56 passed**: api client 11; ExamSelectionPage 6; UploadPage 14;
  DocumentStatusPage 9; CandidatePage 7; AuthAndLogin 9.
- New coverage this slice: `getExams` client contract; ExamSelectionPage loading/
  list/empty/error-retry/select-navigates/route-protection; UploadPage
  preselected-exam prefill + locked field + submit-with-preselected-id;
  DocumentStatusPage NEEDS_REVIEW matched/unresolved counts + `View {n}
  candidates` + no-fabrication degradation.
- `frontend-slice2-typecheck.log` — clean (`tsc --noEmit`).
- `frontend-slice2-build.log` — production build OK (46 modules, ~190.9 kB JS /
  7.02 kB CSS pre-gzip).

Backend (focused regression per the Phase 9 §11 pooler-transient protocol) —
`slice2-backend-regression.log`:
- **5 suites, 32/32 passed**: phase10-exams 4 (new), phase9-upload 12
  (the exact contract the frontend consumes), phase5-auth 7,
  api-error-sanitization 4, plan-not-found 5.
- `slice2-typecheck.log` — root `tsc --noEmit` clean.
- `frozen-file-diff.log` — `git diff --exit-code HEAD -- solver-service/app/`
  exit 0 (byte-identical, accounting for core.autocrlf).

## Honest classification

| Item | Classification |
| --- | --- |
| `GET /exam-seating/exams` backend unit (401/403/200, ordered, no fabricated context) | VERIFIED (4/4) |
| Frontend exam-selection -> upload -> status -> candidate flow | VERIFIED (56/56 frontend; 12/12 phase9 contract) |
| NEEDS_REVIEW first-class status UI (matched/unresolved + View N candidates) | VERIFIED |
| Backend contract stability elsewhere | VERIFIED (frozen solver diff clean; only additive route/service) |
| Rule 5 (no internal details to browser) | VERIFIED |
| Full-suite `npm test` end-to-end | NOT VERIFIED this session (focused regression substitutes per §11 protocol) |
| Exam academic-year / class-context fields | DEFERRED backend note (Exam model has neither; no fabrication) |
| Generation UI + wiring | DEFERRED to Slice 3 (endpoints exist and are API-tested) |
| Proforma / Approve / Publish routes | DEFERRED (none implemented) |
| Formula-injection export hardening | NOT APPLICABLE today (no spreadsheet export) |

## Future work (explicitly out of slice scope)

- Backend model for exam academic-year / class context so the selection surface
  can display them (requires a reviewed schema + endpoint change; recorded as
  DEFERRED, not fabricated).
- Slice 3: wire the existing generation contract
  (`POST /exam-seating/generations`, poll, seating) onto this flow.
- Approve/Publish HTTP routes with the mandated `409 ALREADY_PUBLISHED` contract
  and TBD ADMIN/STAFF permission cells.

## Evidence (docs/evidence/phase10/)

- phase10-slice2-closeout.md (this file)
- frontend-slice2-test.log, frontend-slice2-typecheck.log,
  frontend-slice2-build.log
- slice2-backend-regression.log, slice2-typecheck.log, frozen-file-diff.log
- git-status.log, git-diff-name-only.log, git-staged-name-only.log (gate),
  git-log.log