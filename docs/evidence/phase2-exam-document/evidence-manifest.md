# Phase 2 Evidence Manifest

Repository: standalone Exam Seating Arrangement Prototype (branch `main`, no commits yet).
Every closure claim maps to a raw artifact below. No claims are made without an artifact.

Source of truth for the gate: `src/services/exam-document/storage-integration.ts`.

## Normal test suite

- Evidence: `normal-run.log`
- Proves:
  - normal `npm test` (no `STORAGE_INTEGRATION` flag) exits 0
  - `tests/storage-integration.test.ts` is SKIPPED (3 skipped)
  - counts: 12 test files passed, 1 skipped; 85 tests passed, 3 skipped
  - duration 268.00s; final message "All database integrity tests passed"
  - dedup test lines present: "first upload is created", "a different PDF for the same exam is allowed",
    "the same PDF uploaded for a different exam is allowed (case B)"

## Real storage integration

- Evidence: `integration-run.log`
- Proves:
  - explicit `STORAGE_INTEGRATION=1 npm test` exits 0
  - `tests/storage-integration.test.ts` (3 tests) RAN against the real Supabase private bucket
  - individual tests: stores/downloads/SHA-256/signed-URL/delete/exists=false (2791ms);
    anonymous public URL rejected (1395ms); cleanup-on-failure path (936ms)
  - counts: 13/13 test files passed; 88/88 tests passed
- Test source: `tests/storage-integration.test.ts` (real `SupabaseDocumentStore`, no `MemoryDocumentStore` fallback)

## Missing credentials

- Evidence: `missing-credentials.log`
- Proves:
  - integration EXPLICITLY requested (`STORAGE_INTEGRATION=1`) with empty
    `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`
  - process exits 1; "Failed Suites 1"
  - literal `EXIT CODE: 1` line at the end of the log
  - error names exactly: `SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET`
  - no service-role secret strings and no database connection-string literals in the log (no secret leakage)
  - the 3 tests are reported skipped inside the FAILED suite (exit 1 = not a silent pass)

## Storage cleanup

- Evidence: `storage-integration-list.log`
- Proves (listing captured AFTER the final real integration run):
  - `integration-tests/`
    `[]`
  - `__intg__/`
    `[]`

## TypeScript

- Evidence: `tsc.log`
- Proves: `npx tsc --noEmit` produced no diagnostics and the log's final line is literally
  `EXIT CODE: 0`

## Prisma

- Evidence: `prisma-validate.log`
- Proves: `npx prisma validate` output ("The schema at prisma\schema.prisma is valid")
  and the log's final line is literally `EXIT CODE: 0`

## Repository scope

- Evidence: `git-status.log`, `git-diff-stat.log`, `changed-files.log`
- Proves:
  - `git status --short`: every top-level entry untracked (branch `main` has NO commits);
    .env is gitignored and not listed
  - `git diff --stat`: 0 bytes (no tracked baseline exists)
  - working-tree inventory categorized in `changed-files.log`
  - out-of-scope scan: no CP-SAT implementation, FastAPI, SchoolOS, or EA-System artifacts;
    the only "CP-SAT" string is an asserted error message in the pre-existing Phase 1
    `tests/solve-job.test.ts`
  - scope caveat: because the repo has no baseline commit, scope is established by
    inventory, not by `git diff`

## Deduplication

- Evidence: `dedup-migration.log`, schema `@@unique([examId, fileHash])`,
  test results in `normal-run.log`
- Proves (actual SQL read verbatim from the migration file):
  `CREATE UNIQUE INDEX "uploaded_exam_documents_exam_id_file_hash_key" ON "uploaded_exam_documents"("exam_id", "file_hash");`
- Semantics:
  - same PDF + same exam -> duplicate (test "same PDF uploaded again for the same exam is a duplicate")
  - same bytes + renamed filename + same exam -> duplicate
  - same PDF + different exam -> allowed (test "case B")
  - different PDF + same exam -> allowed (test "a different PDF for the same exam is allowed")

## Environment safety

- Evidence: `env-audit.log`
- Proves: the audit log's final lines are literally
  `STORAGE_INTEGRATION_ENABLED_1: NO` and `STORAGE_INTEGRATION_PRESENT: NO`
- `.env.example`: `STORAGE_INTEGRATION=""` documented as a runtime-only opt-in (never `=1`)
- normal `npm test` cannot reach `SupabaseDocumentStore` without the explicit flag
  (gate logic in `src/services/exam-document/storage-integration.ts`; suite skipped; `integration-run.log` shows the only live run)