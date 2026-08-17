# Phase 14 — Contract-Gap Inventory: Candidate Reconciliation (MATCHED → VALIDATED)

- Date: 2026-08-17
- Status: **CASE B — DEFERRED / PRODUCT CONTRACT BLOCKER** (STOP applied per user direction)
- Companion files: `phase14-contract-gap.log` (raw verification),
  `phase14-environment-inventory.md` (environment survey), `phase14-closeout.md`.
- No production code was modified. No schema change. No commit. No push.

## 1. The exact service that performs MATCHED → VALIDATED

`transitionValidationStatus(id, to, actorId?)` — `src/services/candidate.service.ts:83`.

- Reuses the existing candidate service layer; no route or UI invokes it.
- Referenced only by tests (see `phase14-contract-gap.log` section 1).

## 2. Its input contract

- `id: string` — the `ExamCandidate.id` to transition.
- `to: CandidateValidationStatus` — target status.
- `actorId?: string` — the acting user id, forwarded to the audit log.
- Guarded by `getCandidate(id)` which throws
  `SeatingError("ExamCandidate not found", "CANDIDATE_NOT_FOUND")`.

## 3. Its output / state transition

- Enforces `VALIDATION_TRANSITIONS` (`candidate.service.ts:23`):
  - `UNVERIFIED → [MATCHED, REJECTED]`
  - `MATCHED → [VALIDATED, REJECTED]`
  - `VALIDATED → [REJECTED]`
  - `REJECTED → []` (terminal)
- `MATCHED → VALIDATED` is therefore legal **only** through this service.
- Illegal transitions throw
  `SeatingError("Invalid validation status transition: X -> Y", "INVALID_VALIDATION_STATUS_TRANSITION")`.
- Returns the updated candidate record.

## 4. Existing audit behavior

- On a successful transition, `transitionValidationStatus` logs an
  `AuditLog` row with `action: "CANDIDATE_RESOLVED"`,
  `entityType: "ExamCandidate"`, `entityId: id`, `actorId`,
  `metadata: { validationStatus: to }` (`candidate.service.ts:94-100`).
- `CANDIDATE_RESOLVED` exists in the `AuditAction` enum
  (`prisma/schema.prisma:92`).

## 5. Existing candidate status model

- `enum CandidateValidationStatus { UNVERIFIED MATCHED VALIDATED REJECTED }`
  (`prisma/schema.prisma:49`).
- `ExamCandidate.validationStatus` defaults to `UNVERIFIED`.
- The ingestion path (`ingest.ts` `upsertCandidate`, line 233) persists matched
  rows as `MATCHED`.
- **Unresolved rows are not persisted as candidates at all.** During ingestion,
  only `matched` outcomes are upserted; rows with blocking issues exist only in
  the `IngestReport` counts/`issuesByCode` and the document `parseMetadata`.

## 6. Existing candidate / reconciliation routes

- `GET /exam-seating/documents/:id/candidates` — read-only, paginated candidate
  view (api.ts:174-179, `handleGetDocumentCandidates`).
- `GET /exam-seating/documents/:id` — document record / parse status.
- `POST /exam-seating/generations` — triggers `reconcileExamForGeneration`
  (which requires all candidates `VALIDATED`) then solver dispatch.
- **No POST/PATCH/PUT candidate route exists.** `phase14-contract-gap.log`
  section 4 enumerates every candidate/document route in `api.ts`; none
  transitions candidate status.

## 7. Existing frontend candidate-review components

- `CandidatePage` (`frontend/src/components/CandidatePage.tsx`) — paginated
  candidate table (register number, student, class, department, subject code,
  `validationStatus`); `NEEDS_REVIEW` banner; ADMIN "Generate seating" button.
- `DocumentStatusPage` — parse status + unresolved-row counts (read-only).
- Neither component offers a validate/resolve action. Grep across
  `frontend/src` for `[Vv]alidat|[Rr]esolve|transitionValidationStatus` finds
  only copy/banner text, never an actionable control.

## 8. Whether any partial HTTP surface already exists

- **None.** The read surfaces (`GET .../candidates`, `GET .../documents/:id`)
  exist, but no write surface for candidate state. The service exists, the
  audit action exists, the UI shows MATCHED — but there is no HTTP bridge.

## 9. Whether ADMIN/STAFF permissions for reconciliation are defined

- Not defined. Auth primitives exist: `requireAuth` (401 `UNAUTHORIZED`),
  `requireRole` (403 `FORBIDDEN`), `requireAdmin`
  (`src/phase4/auth/guards.ts:19-35`).
- Upload and generation are ADMIN-only (`requireAdmin` in api.ts). Candidate
  resolution authorization is undecided; the recommendation below proposes
  ADMIN-only for consistency, but this must be an explicit product decision.

## 10. Whether reconciliation requires additional data from Student Master

- For `MATCHED → VALIDATED`: **no.** Identity was established at ingest time
  (`studentId`, snapshots master-sourced). `transitionValidationStatus` only
  flips state.
- For "resolve a truly unresolved row": **yes, a different operation.** Because
  unresolved rows are never persisted as candidates, resolving them would
  require creating a new `ExamCandidate` matched against the Student Master
  (e.g., via `createCandidate`/`updateCandidateSnapshot`) plus a VALIDATED
  transition. That is a larger feature and is explicitly **out of scope** for
  the minimum unblock.
- The Phase 14 E2E fixture intentionally contains one unmatched row to
  exercise `NEEDS_REVIEW`; because unmatched rows are not persisted, marking
  the matched candidates VALIDATED is sufficient for `reconcileExamForGeneration`
  to pass (it evaluates persisted candidates only).

## 11. Existing error codes and failure behavior

- Service: `CANDIDATE_NOT_FOUND` (SeatingError),
  `INVALID_VALIDATION_STATUS_TRANSITION` (SeatingError).
- API mapping today: api.ts maps `EXAM_NOT_FOUND`, `PLAN_NOT_FOUND`,
  `DOCUMENT_NOT_FOUND`, `ALREADY_APPROVED`, `ALREADY_PUBLISHED`,
  `INVALID_PLAN_STATUS_TRANSITION` to 4xx (api.ts:204-227). Any other
  SeatingError currently falls through to **500 INTERNAL_ERROR**
  (api.ts:228-229). A new resolution route must add explicit mappings for
  `CANDIDATE_NOT_FOUND` (404) and `INVALID_VALIDATION_STATUS_TRANSITION` (409)
  so they do not surface as 500s.
- Reconciliation failure at generation: `ERR_CANDIDATE_RECONCILIATION`
  (`src/phase4/reconcile.ts:17`), surfaced as generation state
  `FAILED_RECONCILIATION` (see `phase14-contract-gap.log` section 2/7).

## 12. Existing tests proving the service behavior

- `tests/candidate.test.ts` — `transitionValidationStatus` (MATCHED→VALIDATED);
  "only VALIDATED candidates enter the solver input".
- `tests/phase4-reconcile.test.ts` — reconciliation stops with
  `ERR_CANDIDATE_RECONCILIATION` when a candidate is not VALIDATED; snapshot
  divergence detection.
- `tests/phase4-ingestion-e2e.test.ts` — ingest → MATCHED →
  `transitionValidationStatus(..., "VALIDATED")` → reconcile ok.
- `tests/phase4-e2e.test.ts`, `tests/phase4-persistence.test.ts`,
  `tests/solve-job.test.ts`, `tests/phase10-plan-read.test.ts` — all set
  `validationStatus: "VALIDATED"` directly in test setup (the exact practice
  the E2E rules forbid during the browser journey).

## 13. Whether the missing surface can be exposed without changing the service contract

- **Yes.** A route can call `transitionValidationStatus(candidateId, "VALIDATED", actorId)`
  unchanged. The service already owns the transition rule, persistence, and
  `CANDIDATE_RESOLVED` audit. Only a route + auth + error mapping + response
  serializer are missing. No schema migration, no enum change, no service
  rewrite.

---

## Minimum separately-scoped product task (recommendation — NOT implemented)

> The route name follows the repository's existing `/exam-seating/...` surface
> and the document-scoped candidate read route.

### Endpoint

```
POST /exam-seating/documents/:documentId/candidates/:candidateId/resolve
```

(Repo-architectural alternative: a flat
`POST /exam-seating/candidates/:candidateId/resolve`. Prefer the
document-scoped form because the read surface is already
`GET /exam-seating/documents/:id/candidates`.)

### Requirements

- **Authentication:** required session (`requireAuth`) — HttpOnly cookie.
- **Authorization:** **ADMIN-only** (`requireAdmin`) to match upload/generate;
  STAFF must receive 403 `FORBIDDEN`. (Product must ratify this decision; the
  STAFF boundary test will assert it.)
- **Request body:** empty; target is fixed to `VALIDATED` for the minimum
  unblock. (Optional future: `{ "status": "REJECTED" }` for explicit rejection
  — out of scope here.)
- **Response shape:** 200 with the serialized candidate, reusing the exact
  fields of the existing `handleGetDocumentCandidates` serializer
  (`id, registerNumberSnapshot, studentNameSnapshot, departmentSnapshot,
  genderSnapshot, classSnapshot, subjectCode, subjectName, validationStatus`)
  — **no fabricated academic-year/class fields**.
- **Candidate state transition:** delegate to
  `transitionValidationStatus(candidateId, "VALIDATED", actorId)` — do not
  duplicate the transition table in the route.
- **Validation rules:**
  - Candidate must exist → 404 `CANDIDATE_NOT_FOUND`.
  - Candidate must belong to `documentId`'s exam → 404 (or 400) on mismatch.
  - Legal only from `MATCHED` (and `UNVERIFIED` if such rows are ever exposed)
    → otherwise 409 `INVALID_VALIDATION_STATUS_TRANSITION`.
- **Audit behavior:** reuse the existing `CANDIDATE_RESOLVED` audit inside the
  service; no new audit path.
- **Error codes:** 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404
  `CANDIDATE_NOT_FOUND`, 409 `INVALID_VALIDATION_STATUS_TRANSITION`. Add these
  to api.ts's SeatingError→HTTP mapping so they never become 500s.
- **Unresolved → resolved semantics:** the route resolves **already-matched**
  rows (`MATCHED → VALIDATED`). Truly unmatched rows (never persisted) are NOT
  addressable by this route; handling those (create + match + validate) is a
  separate larger task and must not be silently merged into this one.
- **Bulk resolution:** **not required** for the minimum unblock. Single-candidate
  route only; batch can be a later iteration.
- **Student Master identity:** not needed for this route (identity already set
  at ingest); do not add Student Master lookups or new identity fields.
- **Tests required:**
  - Backend route tests (phase11-style): 401, 403 (STAFF), 404 (missing
    candidate / wrong document), 409 (illegal transition), 200 (MATCHED→VALIDATED)
    with audit `CANDIDATE_RESOLVED` asserted; then generation reconciliation
    passes.
  - Frontend component tests: CandidatePage shows a per-row resolve action for
    ADMIN only; on success the row reflects `VALIDATED`; STAFF sees no action.
- **Frontend UI required for the real browser journey:**
  - `CandidatePage`: per-row "Resolve / Validate" button (ADMIN only) calling
    the new route; success updates the row to `VALIDATED`; disabled after
    resolve; the ADMIN "Generate seating" button then proceeds past
    reconciliation.
  - After all rows are `VALIDATED`, the browser journey can legitimately
    progress Upload → Candidate Review → Generate → COMPLETED → View → Approve
    → Publish.

---

## CASE B vs CASE D distinction

- **CASE D — ENVIRONMENTAL FAILURE:** not the current condition. The environment
  is **achievable** (verified: Docker 29.6.1 for a disposable local Postgres;
  storage isolated via the existing `MemoryDocumentStore` fallback by env
  scoping; solver runnable from the existing `solver-service/.venv` with
  ortools 9.15; Playwright installable). No infra dependency is missing that
  blocks the journey.
- **CASE B — PRODUCT / CONTRACT BLOCKER:** the current condition. The existing
  product does not expose the `MATCHED → VALIDATED` reconciliation operation
  (`transitionValidationStatus`) through HTTP, so the real browser journey
  cannot honestly progress from Candidate Review → Generate. The block is a
  product-surface gap, not an environment gap.
