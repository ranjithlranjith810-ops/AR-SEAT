# Phase 10 — Frontend / Product Wiring Slice 1 Close-out

Status: COMPLETE (Slice 1). Nothing committed without explicit instruction.
Date: 2026-08-17
Phase: Phase 10 — Frontend/Product Surface (Slice 1: Exam ID -> PDF upload -> Ingestion status -> Candidate review)

## Scope delivered

A new `frontend/` Vite + React + TypeScript application that wires the product
flow onto the EXISTING Phase 9 backend. No backend contract, persistence model,
ingestion architecture, authentication model, or solver was changed.

User decisions locked for this slice:
- Frontend framework: **Vite + React + TypeScript** (HashRouter; tested with
  vitest + jsdom + Testing Library).
- Exam selection: **manual exam-ID entry**. The missing exam-list backend
  endpoint is recorded as a DEFERRED gap (see Future work) — no endpoint was
  invented.

## Routes wired (existing Phase 9 contracts only)

| Frontend surface | Backend endpoint | Permission |
| --- | --- | --- |
| Login / logout | `POST /auth/login`, `GET /auth/me` (cookie `ar_seat_session`) | public (login) |
| Upload form | `POST /exam-seating/documents?examId=<id>` (raw PDF) | ADMIN-only |
| Ingestion status | `GET /exam-seating/documents/:id` | authenticated (both roles) |
| Candidate review | `GET /exam-seating/documents/:id/candidates?limit&offset` | authenticated (both roles) |

No routes for Proforma / Approve / Publish were added (those are DEFERRED backend
features). A request to a route that exists on the backend only returns 404 from
the backend as today; the frontend links only to implemented surfaces.

## Product behavior implemented

- **Upload (UploadPage)**: exam-ID input + PDF file picker; client-side UX
  validation (empty exam ID, empty file, non-PDF, empty file, >20 MiB via
  `MAX_UPLOAD_BYTES`); phase machine empty/selected/uploading/processing/
  completed/needsReview/rejected/failed; duplicate-submit guard while a request
  is in flight; safe error mapping (`EXAM_NOT_FOUND`, `INVALID_FILE_TYPE`,
  `EMPTY_UPLOAD`, `PAYLOAD_TOO_LARGE`, `MISSING_EXAM_ID`, `UNAUTHORIZED`,
  `FORBIDDEN`, `NETWORK_ERROR`, generic otherwise — Rule 5, no internal
  details); duplicate upload surfaces an info alert linking the existing
  ingestion record.
- **NEEDS_REVIEW is first-class**: upload result with `finalParseStatus =
  NEEDS_REVIEW` renders a partial-processing state with the unresolved count
  taken ONLY from the backend-provided `counts.rejected`; the candidate view
  shows a partial-processing banner with only matched candidates.
- **Status (DocumentStatusPage)**: fetches `GET /exam-seating/documents/:id`;
  while the status is non-terminal it polls every 3s and stops at any terminal
  status or on unmount; FAILED renders a generic message and never renders
  `parseMetadata`; NEEDS_REVIEW unresolved count is derived only from numeric
  `issues` values in `parseMetadata` (never fabricated when absent); Retry
  action on error.
- **Candidates (CandidatePage)**: paginated via the backend offset/limit
  contract (page size 20), Previous/Next disabled at the boundaries; persists
  prior rows during a pending page fetch; explicit master-sourced messaging
  (names/academics come from the student master, not the PDF); safe error and
  empty states.
- **Auth**: `AuthContext` resolves the session on boot (`GET /auth/me`);
  `RequireAuth` redirects unauthenticated users to `/login` with a `from`
  state; `RequireAdmin` blocks STAFF from the upload surface with an Access
  denied view; already-authenticated users are redirected away from `/login`.

## Standing rules satisfied

- Backend contract untouched; frontend binds only to routes that exist.
- No invented API for unresolved candidates; counts come only from backend
  fields.
- Polling is lightweight (3s), stops at terminal states and on unmount, and
  issues no duplicate requests.
- Rule 5: no Prisma/stack/internal parser details ever reach the browser;
  error surfaces are purpose-built message strings.
- Student Master remains authoritative in UI copy and data flow; the PDF is
  never treated as a student database.

## Tests & verification

Frontend (`frontend/`, vitest + jsdom):
- `frontend-test.log` — 5 test files, **47/47 passed** (api client; UploadPage
  12; DocumentStatusPage 9; CandidatePage 7; AuthAndLogin 9).
- `frontend-typecheck.log` — clean (`tsc --noEmit`).
- `frontend-build.log` — production build OK (45 modules, ~187 kB JS / 7 kB CSS
  pre-gzip).
- Test-env fix: jsdom does not implement `Blob.prototype.arrayBuffer`; a
  FileReader-based polyfill in `src/test/setup.ts` makes the upload path
  testable. Ambiguous status-text queries were pinned to full sentences to keep
  assertions unambiguous, and a duplicate row text assertion uses `getAllByText`.

Backend regression (Phase 10 §19 — focused runs per the Phase 9 pooler-
transient protocol; see note below):
- `phase9-focused.log` — `tests/phase9-upload.test.ts` **12/12 passed**
  (the exact contract the frontend consumes).
- `backend-regression.log` — 10 suites, **82/82 passed**: phase5-auth,
  api-error-sanitization (Phase 7b), plan-not-found (Phase 7c), publication-race
  (Phase 8), phase4-ingestion-e2e, solve-job, phase4-orchestration,
  phase4-persistence, phase4-reconcile, exam-document.
- `pytest.log` — **98 passed** (solver-service).
- `typecheck.log` — root `tsc --noEmit` clean.
- `frozen-file-diff.log` — `git diff --exit-code HEAD -- solver-service/app/`
  exit 0: all 6 frozen solver files byte-identical to HEAD (confirmed via git,
  accounting for core.autocrlf).

Full-suite note (honest): a full `npm test` was started but **aborted by the
user** during the DB-backed run (`npm-test.log` is a partial record). The
completed portion showed no assertion failures. In line with the Phase 9 §11
precedent (pooler-transient environment), regression is evidenced by the focused
suites above, which cover every affected area the slice touches.

## Honest classification

| Item | Classification |
| --- | --- |
| Frontend exam-ID -> upload -> status -> candidate flow | VERIFIED (47/47 frontend, 12/12 phase9 contract) |
| Backend contract stability (no changes) | VERIFIED (frozen solver diff clean; no backend files modified) |
| NEEDS_REVIEW first-class UI | VERIFIED |
| Duplicate-upload UX | VERIFIED |
| Polling lifecycle | VERIFIED |
| Rule 5 (no internal details to browser) | VERIFIED |
| Full-suite `npm test` end-to-end | NOT VERIFIED this session (aborted; focused regression substitutes per §11 protocol) |
| Exam-list backend endpoint (missing) | DEFERRED (recorded; no invented route) |
| Proforma / Approve / Publish routes | DEFERRED (Phase 8b/9 §12; none implemented) |
| Formula-injection export hardening | NOT APPLICABLE today (no spreadsheet export) |

## Future work (explicitly out of slice scope)

- Backend exam-list endpoint (`GET /exams`) to replace manual exam-ID entry —
  DEFERRED gap requiring a reviewed backend change.
- Approve/Publish HTTP routes with the mandated `409 ALREADY_PUBLISHED`
  contract and the ADMIN/STAFF decision for those TBD permission cells.
- Hosting/deploy wiring for the built `frontend/dist` (reverse proxy to the
  backend, cookie SameSite) — operations concern, out of slice scope.
- Frontend `npm audit` findings (4 vulnerabilities: 3 moderate, 1 high in
  transitive deps) — recorded, not auto-fixed, no known exploitable path via
  this app surface.

## Evidence (docs/evidence/phase10/)

- phase10-closeout.md (this file)
- frontend-test.log, frontend-typecheck.log, frontend-build.log
- phase9-focused.log, backend-regression.log, pytest.log, typecheck.log,
  frozen-file-diff.log, git-status.log, git-diff-name-only.log, git-log.log
- npm-test.log (partial; aborted full-suite attempt)