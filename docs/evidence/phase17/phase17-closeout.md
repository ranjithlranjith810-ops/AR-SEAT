# Phase 17 — Student Master Management

## Summary

Delivered the Phase 17 **Student Master Management** product surface end-to-end:
backend REST API over the existing Student/Department/Class domain, a
STAFF/ADMIN browser UI, audit coverage for all writes, RBAC gating, and full
verification (backend suite, frontend suite/build, E2E). No student deletion —
status-based deactivation only, preserving the existing no-hard-delete policy.
Nothing committed or pushed.

## Scope Delivered

### Backend (`src/phase4/api.ts` + services)

- 11 routes under `/exam-seating`:
  - `GET/POST /students`, `GET/PATCH /students/:id`, `PATCH /students/:id/status`
  - `GET /departments`, `POST /departments`, `PATCH /departments/:id`
  - `GET /classes`, `POST /classes`, `PATCH /classes/:id`
- RBAC: student routes + dept/class **list** = `requireAuth`; dept/class
  **writes** = `requireAdmin`.
- Error mapping: `STUDENT_NOT_FOUND`/`DEPARTMENT_NOT_FOUND`/`CLASS_NOT_FOUND` →
  404; `STUDENT_ALREADY_EXISTS`/`DEPARTMENT_ALREADY_EXISTS`/`CLASS_ALREADY_EXISTS`
  → 409; `INVALID_INPUT` → 400; `INVALID_PAGINATION` → 400; unknown-route 404.
- Audit rows written for every write: `DEPARTMENT_CREATED`/`DEPARTMENT_UPDATED`,
  `CLASS_CREATED`/`CLASS_UPDATED`, `STUDENT_CREATED`/`STUDENT_UPDATED`/
  `STUDENT_STATUS_CHANGED` (actor = authenticated user; no-op students keep
  history-free deactivation).
- Fix required during test work: `createDepartment` in
  `src/services/department.service.ts` did not translate the unique-code
  violation (P2002) into `DEPARTMENT_ALREADY_EXISTS`; it leaked a Prisma error
  as a sanitized 500. Now returns 409. (`updateDepartment` already handled it.)
- New `src/services/class.service.ts` (Phase 17), used by the class routes.

### Schema (`prisma/schema.prisma` + migration)

- Only change: 7 new `AuditAction` enum values for student-master audit events.
- Hand-authored migration
  `prisma/migrations/20260818000000_add_student_master_audit_actions/migration.sql`
  (7× `ALTER TYPE ... ADD VALUE`); `prisma validate`/`generate` pass; applied to
  the test DB (`4 migrations found, no pending`).
- Student/Department/Class models were already complete — no model changes.

### Frontend (`frontend/`)

- `StudentsPage.tsx` — search (name/register/roll), department/class/status
  filters, paginated table (20/page), loading/empty/error+Retry states, Add/Edit
  form, per-row status change, success/danger notices, safe error mapping.
- `StudentForm.tsx` — create/edit with dependent department→class selects,
  client validation, duplicate-register error mapping, save/cancel.
- Wiring: `/students` route in `App.tsx`, "Students" NavLink in `Layout.tsx`
  (visible to both STAFF and ADMIN).
- `lib/types.ts` + `lib/api.ts` + `lib/api.test.ts` — student/department/class
  client functions and types with test coverage.

## Tests

### Backend — `tests/phase17-student-master.test.ts` (11 tests)

RBAC 401/403, dept CRUD + audit, duplicate/missing-field 409/400, unknown 404,
class CRUD + audit + duplicate/missing-department 409/400/404, student
CRUD/status + audit, duplicate-register/invalid-input, unknown-student 404 +
`INVALID_PAGINATION`, and a **real-PDF ingestion** test that creates a student
via the HTTP API and proves PDF ingestion MATCHES it to a candidate.

Result: **11/11 PASS** (`phase17-backend-tests.log`, 58.49s).

### Frontend — `StudentsPage.test.tsx` (12) + api client tests

Result: **127/127 PASS** across 10 files (`phase17-frontend-tests.log`).

### E2E — `e2e/specs/students.spec.ts` (7 tests)

STAFF browse/search/filter/paginate, student-master API auth + STAFF 403 on
dept/class writes, ADMIN creates dept + class + duplicate-class 409, STAFF
create/edit/deactivate a student through the real browser, duplicate-register
form error. Run against a fresh local Docker `*_test` DB with scrubbed env via
`scripts/e2e/run-e2e.mjs`.

Result: **17/17 PASS** across all 5 spec files (7 new + 10 pre-existing, no
regressions) (`phase17-e2e.log`).

## Verification Gates

| Gate | Result |
|---|---|
| Phase 17 backend tests (isolated) | 11/11 PASS |
| Full backend suite (Supabase `exam_seating_test`) | 216 passed / 1 failed / 12 skipped (see regression note) |
| Root typecheck (`npx tsc --noEmit`) | PASS |
| Frontend test suite | 127/127 PASS (10 files) |
| Frontend typecheck (`tsc -b`) | PASS |
| Frontend production build (`tsc -b && vite build`) | PASS |
| E2E Playwright (fresh local Docker `*_test` DB) | 17/17 PASS |

## Regression Note (pre-existing, not Phase 17)

The full-suite run hit a single timeout in the pre-existing
`tests/phase4-persistence.test.ts` (the 30s default `testTimeout` is now
marginal against the remote Supabase pooler; the failing case takes ~29.9s).
No Phase 17 code touches that path (files unmodified). In isolation with a 120s
timeout the test file passes 3/3, and `candidate.test.ts` (file-level skipped
once in the full run) passes 9/9 in isolation. Full analysis:
`docs/evidence/phase17/phase17-regression.md`.

## Security / Architecture

- No auth bypass, no RBAC weakening (STAFF denied 403 on dept/class writes;
  student reads/writes remain authenticated; no admin-only surfaces leaked).
- No RLS changes, no tenant-isolation changes.
- No student hard-delete surface added; deactivation only, consistent with the
  existing no-hard-delete policy (RDBMS guards on exam-history-bearing students
  preserved).
- No unrelated refactoring of the verified seating/PDF/auth backbone.
- Tests/E2E run only against the guard-verified `exam_seating_test` DB and a
  fresh local Docker `*_test` DB with scrubbed env.

## Files (Phase 17)

New:
- `tests/phase17-student-master.test.ts`
- `frontend/src/components/StudentsPage.tsx`, `StudentForm.tsx`,
  `StudentsPage.test.tsx`
- `e2e/specs/students.spec.ts`
- `src/services/class.service.ts`
- `prisma/migrations/20260818000000_add_student_master_audit_actions/`
- `docs/evidence/phase17/` (this closeout + logs)

Modified (Phase 17 changes on top of pre-existing uncommitted state):
- `src/phase4/api.ts` (11 student/department/class routes + handlers)
- `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`
- `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`,
  `frontend/src/lib/api.test.ts`
- `frontend/src/styles.css` (status badge + table polish)
- `prisma/schema.prisma` (AuditAction enum values)
- `src/services/department.service.ts` (createDepartment 409 fix; file was
  already untracked)

Pre-existing uncommitted work (NOT Phase 17, still uncommitted): frontend auth
Fast-Refresh fix (`auth-context.ts`, `AuthContext.tsx`, `harness.tsx`,
`AuthAndLogin.test.tsx`, `UploadPage.test.tsx`), `e2e/specs/auth.spec.ts` +
`e2e/helpers.ts`, `scripts/dev-all.mjs` + `package.json`, Phase 16 surface
(`AuditPage.tsx`/`.test.tsx`, `tests/phase16-audit-read.test.ts`,
`e2e/specs/audit-read.spec.ts`, `scripts/e2e/seed.mjs`,
`tests/phase4-ingestion-e2e.test.ts`), earlier evidence dirs
(`phase12/13/16/7a/8b/phase3/4-benchmarks`, etc.), `test-results/`,
`phase10-verified-bundle.zip`, stray `eating prototype•` dir.

## Git State

```text
committed: NO
pushed: NO
HEAD: d3b6d5696b9e7f962f72b4862ec6e41f10722ae4 (feat: add Phase 14 E2E browser harness)
Phase 17 work: uncommitted (new + modified files above)
```

## Final Status

```text
PHASE 17 — COMPLETE
```