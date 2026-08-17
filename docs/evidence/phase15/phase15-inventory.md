# Phase 15 — Candidate Reconciliation Surface: Contract Inventory

- Phase: 15 — Candidate Reconciliation Surface (Inventory-First Product/API Unblock)
- Date: 2026-08-17
- HEAD verified: `4725288fdb528274264e67c427a5967753ce97c7` (== origin/main)
- Status: INVENTORY COMPLETE — no production code changed yet.
- Reference: `docs/evidence/phase14/phase14-contract-gap-inventory.md`

## Purpose

Verify the Phase 14 minimum-unblock recommendation against the current HEAD,
then (after this inventory) implement only the `MATCHED → VALIDATED`
reconciliation surface through the ADMIN HTTP + frontend UI, reusing the
existing service and audit architecture.

## 1. Backend

### Candidate service (`src/services/candidate.service.ts`)

- `transitionValidationStatus(id, to, actorId?)` (line 83) — the operation.
  - Input: `id` (ExamCandidate.id), `to` (CandidateValidationStatus), `actorId?`.
  - Enforces `VALIDATION_TRANSITIONS` (line 23): `MATCHED → [VALIDATED, REJECTED]`.
  - `MATCHED → VALIDATED` is legal. `VALIDATED → VALIDATED` is illegal.
  - Throws `CANDIDATE_NOT_FOUND` (getCandidate) and
    `INVALID_VALIDATION_STATUS_TRANSITION`.
  - Audit: single `logAudit` with `action: "CANDIDATE_RESOLVED"`,
    `entityType: "ExamCandidate"`, `entityId: id`, `actorId`,
    `metadata: { validationStatus: to }` (lines 94-100).
- `getCandidate(id)` (line 77) — full record incl. `sourceDocumentId`,
  `examId`, and all snapshot fields.
- `createCandidate` (line 45) — test/fixture path; sets `UNVERIFIED`.

### Status model (`prisma/schema.prisma:49`)

- `enum CandidateValidationStatus { UNVERIFIED MATCHED VALIDATED REJECTED }`.
- `ExamCandidate.validationStatus` default `UNVERIFIED`.
- **No schema/migration change is required**: `MATCHED → VALIDATED` is already
  representable by the existing model and transition table.

### Route surface (`src/phase4/api.ts`)

- Route registration via `path.match(regex)` + `method` checks (node:http).
- Auth helpers: `requireAuth` (401), `requireAdmin` (403) — guards.ts.
- Existing candidate surface is **read-only**:
  `GET /exam-seating/documents/:id/candidates` (paginated, document-scoped via
  `{ examId, sourceDocumentId }`), `GET /exam-seating/documents/:id`.
- **No write route exists** for candidate status. Confirmed against HEAD.
- Error mapping convention: global catch maps specific `SeatingError` codes
  (`PLAN_NOT_FOUND`→404, `DOCUMENT_NOT_FOUND`→404, `ALREADY_APPROVED`/`ALREADY_PUBLISHED`/`INVALID_PLAN_STATUS_TRANSITION`→409); everything else falls
  through to sanitized 500 `INTERNAL_ERROR` (api.ts:228-229).
  → New route needs `CANDIDATE_NOT_FOUND`→404 and
  `INVALID_VALIDATION_STATUS_TRANSITION`→409 mappings added to the global catch.
- Serializer convention: inline field selection; single-resource responses use
  a wrapper object (`{ user }`, `{ plan }`, `{ document }`, `{ exams }`).

### Phase 14 assumptions — status

| Assumption | Verified at HEAD |
| --- | --- |
| `transitionValidationStatus` exists and handles MATCHED→VALIDATED | Yes (candidate.service.ts:83) |
| `CANDIDATE_RESOLVED` audit exists in service | Yes (schema.prisma:92, candidate.service.ts:95) |
| No HTTP resolution route | Yes (api.ts route inventory) |
| Generation requires VALIDATED | Yes (reconcile.ts:66; solverInput.service.ts:41,84) |
| Upload persists MATCHED | Yes (ingest.ts:233) |
| No schema change needed | Yes (enum supports the transition) |
| ADMIN-only recommended | No repository policy contradicts; upload/generate are ADMIN-only |

## 2. Frontend

- API client `frontend/src/lib/api.ts` centralizes `fetch` (credentials:
  "include"); `ApiError{status, code}` preserves intentional error codes.
- `Candidate` type (`frontend/src/lib/types.ts:73`) has `validationStatus` +
  snapshot fields; matches the GET candidates serializer fields.
- `CandidatePage.tsx`: paginated table (cols: Register number, Student, Class,
  Department, Subject code, Validation); ADMIN-only "Generate seating" button;
  `NEEDS_REVIEW` banner. No resolve/validate affordance exists.
- Role handling via `useAuth()` (`user?.role`); `isAdmin` already computed.
- Test harness: `renderRoutes`/`renderParamRoute` with `adminUser`/`staffUser`;
  `../lib/api` is mocked in CandidatePage.test.tsx.

## 3. Audit

- Reuse the existing single `CANDIDATE_RESOLVED` logAudit inside
  `transitionValidationStatus`. **No second audit path.**

## 4. STOP-condition check (§3)

- STOP A (transition missing): not triggered — service present at HEAD.
- STOP B (transition illegal): not triggered — MATCHED→VALIDATED legal.
- STOP C (audit incompatible): not triggered — CANDIDATE_RESOLVED present.
- STOP D (permission conflict): not triggered — no policy contradicts
  ADMIN-only; consistent with ADMIN-only upload/generate.
- STOP E (truly-unmatched rows mixed in): design keeps them out — the route
  only transitions persisted candidates from MATCHED→VALIDATED.
- STOP F (business logic in route): design calls the existing service only;
  ownership check is request-integrity, not reconciliation logic.

## 5. Minimum surface to implement (post-inventory)

- **Route:** `POST /exam-seating/documents/:documentId/candidates/:candidateId/resolve`
  - `requireAdmin` guard (401 unauthenticated / 403 STAFF).
  - Empty body (ignored, matching approve/publish convention).
  - `getCandidate(candidateId)`; if `candidate.sourceDocumentId !== documentId`
    → intentional `404 CANDIDATE_NOT_FOUND` (no existence leak).
  - `transitionValidationStatus(candidateId, "VALIDATED", actor.id)`.
  - Response `200 { candidate: <serialized candidate> }` using the same fields
    as the GET candidates view (no fabricated fields).
  - Global catch additions: `CANDIDATE_NOT_FOUND`→404,
    `INVALID_VALIDATION_STATUS_TRANSITION`→409.
- **Frontend API client:** `resolveCandidate(documentId, candidateId)`
  (POST, unwrap `{ candidate }`).
- **CandidatePage:** per-row ADMIN "Resolve" action for `MATCHED` candidates;
  in-flight disable; update row from backend response; sanitized error handling
  (409/404/401/403/NETWORK_ERROR).
- **Tests:** backend `tests/phase15-candidate-resolve.test.ts`; frontend
  CandidatePage.test.tsx + api.test.ts additions.

## 6. Explicitly out of scope

Truly-unmatched rows; E2E/environment scaffolding; Playwright; solver;
generation; seating; approve/publish; audit-read; academic-year/class schema;
Student Master creation; direct DB mutation from frontend; test-only HTTP
bypasses; any schema migration.
