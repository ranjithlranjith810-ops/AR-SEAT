# Phase 15 — Candidate Reconciliation Surface: Closeout

- Phase: 15 — Candidate Reconciliation Surface (Inventory-First Product/API Unblock)
- Date: 2026-08-17
- HEAD verified: `4725288fdb528274264e67c427a5967753ce97c7` (== origin/main)
- Status: COMPLETE
- Classification: **CASE A — VERIFIED**

## Objective recap

Expose the existing `MATCHED → VALIDATED` candidate transition through the
ADMIN HTTP + frontend UI surface, reusing `transitionValidationStatus()` and
its single `CANDIDATE_RESOLVED` audit event, without touching the solver,
generation, seating, upload, or schema.

## Changes delivered

### Backend — `src/phase4/api.ts`
- New ADMIN-only route:
  `POST /exam-seating/documents/:documentId/candidates/:candidateId/resolve`.
- `handleResolveCandidate`: loads the candidate, enforces the document-ownership
  check (`sourceDocumentId === documentId`; mismatch → intentional
  `404 CANDIDATE_NOT_FOUND`, no existence leak), then calls the existing
  `transitionValidationStatus(candidateId, "VALIDATED", actor.id)`.
- `serializeCandidate`: same field set as the GET candidates view
  (`id, registerNumberSnapshot, studentNameSnapshot, departmentSnapshot,
  genderSnapshot, classSnapshot, subjectCode, subjectName, validationStatus`).
- Global error mapping additions: `CANDIDATE_NOT_FOUND` → 404,
  `INVALID_VALIDATION_STATUS_TRANSITION` → 409 (previously fell through to 500).
- No business logic duplicated in the route; no schema change; no DB mutation
  outside the service.

### Frontend
- `frontend/src/lib/api.ts`: `resolveCandidate(documentId, candidateId)` —
  POST, no body, unwraps `{ candidate }`.
- `frontend/src/components/CandidatePage.tsx`: per-row ADMIN "Resolve" action
  shown only for `MATCHED` candidates; in-flight disable + "Resolving..." label;
  row updated from the backend response; sanitized error messages for
  409/404/401/403/network; role gating is UX-only (backend enforces).

### Tests
- `tests/phase15-candidate-resolve.test.ts` (7): unauthenticated 401; STAFF 403
  with status unchanged; ADMIN 200 MATCHED→VALIDATED with full serialized body
  (and no fabricated `academicYear`); repeated resolve 409 with no internals;
  unknown candidate intentional 404; cross-document candidate intentional 404;
  exactly one `CANDIDATE_RESOLVED` audit with the ADMIN actor and
  `metadata.validationStatus = "VALIDATED"`.
- `frontend/src/lib/api.test.ts` (+4): resolve POST path, id encoding, 409 and
  404 propagation.
- `frontend/src/components/CandidatePage.test.tsx` (+6): ADMIN sees Resolve for
  MATCHED rows; STAFF does not; click calls `resolveCandidate("doc-1", id)` and
  updates the row to VALIDATED; in-flight double-click guard (single call);
  repeated-resolution 409 message without changing rows; missing-candidate 404
  message without leaks.

## Verifier answers (§24)

| Check | Result |
| --- | --- |
| Route exists, requires ADMIN, returns 200 only for a legal MATCHED→VALIDATED | Verified by tests (401/403/200) |
| 404 intentional for unknown + cross-document candidate, no internals | Verified by tests (raw-body marker scan) |
| 409 for repeated/illegal transition, no internals | Verified by tests (raw-body marker scan) |
| Reuses existing service; no duplicated transition/audit logic | Verified by code review; service diff = 0 |
| Single `CANDIDATE_RESOLVED` audit per resolution with ADMIN actor | Verified by test (exactly 1, actor = admin) |
| Frontend calls the documented route; updates rows from backend response | Verified by component + api tests |
| Frontend errors sanitized; no internal markers surfaced | Verified by component tests (safe messages) |
| No schema/migration change; solver frozen | Verified: `git diff --exit-code HEAD -- solver-service/app/` exit 0 |
| No E2E, no Docker/Playwright, no direct-DB frontend path | Verified by scope (none added) |
| No untracked unrelated artifacts staged; staged set exact | Verified by `--cached --name-only` / `--check` logs |

## Evidence

- `phase15-inventory.md` — contract inventory (reconciled with HEAD).
- `phase15-backend-test.log` — focused backend regression (39 tests: 7 new + 32
  existing candidate/phase11/sanitization/auth), exit 0.
- `phase15-frontend-test.log` — full frontend suite (97 tests), exit 0.
- `phase15-backend-typecheck.log` / `phase15-root-typecheck.log` — root `tsc --noEmit`, exit 0.
- `phase15-frontend-typecheck.log` — frontend `tsc --noEmit`, exit 0.
- `phase15-frontend-build.log` — `vite build`, exit 0.
- `phase15-frozen-file-diff.log` — solver frozen diff, exit 0.
- `phase15-git-status.log`, `phase15-git-staged-name-only.log`,
  `phase15-git-diff-check.log` — provenance and staged-file gate.

## Deviations from plan

- Audit assertion tightened after first run: setup's `UNVERIFIED→MATCHED` uses
  the same service and therefore also writes a `CANDIDATE_RESOLVED` audit
  (actor "test-actor", metadata MATCHED). The test now asserts exactly one
  `VALIDATED` audit by the ADMIN (resolvedByAdmin length 1) rather than a
  global count of 1. Production behavior is unchanged and correct.
- Frontend resolve tests scoped button clicks to the row via `within()` because
  multiple MATCHED rows render multiple "Resolve" buttons.

## Classification

**CASE A — VERIFIED.** All functional checks pass; all typechecks/build green;
solver frozen; staged set exact; no production/schema changes beyond the
intended surface. No commit/push made (awaiting explicit instruction).

## Deferred (unchanged, outside scope)

Truly-unmatched-row resolution (rows are never persisted); academic-year/class
context; audit-read surface; Phase 14 scaffolding (Docker + Playwright E2E)
resumes after this phase is committed.
