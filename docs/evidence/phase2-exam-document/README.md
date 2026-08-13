# Phase 2 — Exam Document Ingestion

## Evidence-Based Closure Report

Collected from raw command output. See `evidence-manifest.md` for the claim-to-artifact mapping
and the `*.log` files in this directory for the raw data.

## Status

**COMPLETE / VERIFIED / FROZEN**

## Verification Matrix

| Requirement | Result | Evidence |
|---|---|---|
| Normal test suite | PASS | normal-run.log (exit 0) |
| Storage integration skipped normally | PASS | normal-run.log (storage-integration.test.ts: 3 skipped) |
| Real storage integration | PASS | integration-run.log (exit 0, 3/3) |
| Missing credential failure | PASS | missing-credentials.log (literal `EXIT CODE: 1`, names all missing vars) |
| Private bucket | PASS | integration-run.log (anonymous test) |
| Anonymous access = 403 | PASS | integration-run.log |
| Signed URL | PASS | integration-run.log (fetched, SHA-256 matched) |
| Delete | PASS | integration-run.log |
| Post-delete exists=false | PASS | integration-run.log (both tests + failure-path test) |
| Cleanup on failure path | PASS | integration-run.log ("cleans up ... assertion fails mid-test") |
| Final bucket sweep | PASS | storage-integration-list.log (`[]` for both prefixes) |
| TypeScript | PASS | tsc.log (literal `EXIT CODE: 0`, no diagnostics) |
| Prisma validation | PASS | prisma-validate.log (literal `EXIT CODE: 0`, schema valid) |
| Deduplication | PASS | dedup-migration.log (actual SQL: UNIQUE exam_id+file_hash) + dedup tests in normal-run.log |
| Repository scope | PASS | git-status.log, git-diff-stat.log, changed-files.log |
| Explicit opt-in gate | PASS | storage-integration.ts + normal/integration logs |
| `.env` safety (no persisted flag) | PASS | env-audit.log (`STORAGE_INTEGRATION_PRESENT: NO`) + `.env.example` |

## Commands Executed

- `git rev-parse --abbrev-ref HEAD` -> `main` (no commits yet)
- `npx tsc --noEmit` -> `EXIT CODE: 0` (literal line in tsc.log)
- `npx prisma validate` -> `EXIT CODE: 0` (literal line in prisma-validate.log)
- `npm test` (no flag) -> exit 0
- `STORAGE_INTEGRATION=1 npm test` -> exit 0
- missing-credentials harness (`STORAGE_INTEGRATION=1`, credentials emptied) -> `EXIT CODE: 1` (literal line in missing-credentials.log)
- storage prefix sweep (after final run) -> exit 0
- `.env` audit -> `STORAGE_INTEGRATION_PRESENT: NO` (literal line in env-audit.log)
- migration read -> actual SQL captured verbatim in dedup-migration.log

## Evidence Artifacts

- `normal-run.log` — full normal suite output (85 passed, 3 skipped; storage suite skipped)
- `integration-run.log` — full explicit integration run (88 passed; 3 real storage tests)
- `missing-credentials.log` — exit-1 config failure (literal `EXIT CODE: 1`), no secrets
- `env-audit.log` — `.env` integration-flag audit (`STORAGE_INTEGRATION_PRESENT: NO`)
- `dedup-migration.log` — actual dedup migration SQL (UNIQUE exam_id + file_hash) + schema reference
- `storage-integration-list.log` — post-run bucket listing of test prefixes
- `tsc.log` — no diagnostics, literal `EXIT CODE: 0`
- `prisma-validate.log` — schema valid, literal `EXIT CODE: 0`
- `git-status.log` / `git-diff-stat.log` / `changed-files.log` — repo scope
- `evidence-manifest.md` — claim-to-artifact mapping

## Files Changed (Phase 2 scope)

- `src/services/exam-document/storage-integration.ts` — explicit gate (run/skip/fail)
- `tests/storage-integration.test.ts` — gated real-storage suite, unique `integration-tests/<id>/`
  namespace, verified cleanup, failure-path cleanup test (added during this evidence task)
- `tests/storage-integration-gate.test.ts` — gate unit tests
- `tests/exam-document.test.ts` — dedup Case B test; E2E pins `MemoryDocumentStore`
- `.env.example` — `STORAGE_INTEGRATION=""` runtime-only opt-in documentation
- `docs/evidence/phase2-exam-document/*` — this evidence package (new)

No changes were made to Phase 1 foundation, Phase 3, EA System / SchoolOS, or unrelated models.

## Tests Added/Changed

- `tests/storage-integration.test.ts` (reworked + failure-path test)
- `tests/storage-integration-gate.test.ts` (new, 4 tests)
- `tests/exam-document.test.ts` (+1 Case B dedup test)

## Migrations

- `prisma/migrations/20260813090000_exam_doc_dedup` — confirmed `UNIQUE (exam_id, file_hash)`.
  Unchanged: scope is intentional (same PDF across different exams is allowed).

## Remaining Issues

None.

## Final Decision

All criteria are supported by raw artifacts captured from the final state. Normal runs never touch
live Supabase; storage access requires an explicit `STORAGE_INTEGRATION=1`; integration, missing-credential
failure, cleanup, garbage collection, TypeScript, Prisma, dedup and scope evidence all PASS.

**PHASE 2 — EXAM DOCUMENT INGESTION: COMPLETE / VERIFIED / FROZEN**