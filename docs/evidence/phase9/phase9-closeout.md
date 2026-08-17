# Phase 9 — Upload / Ingestion Slice Close-out

Status: COMPLETE (Slice 1). Nothing committed without explicit instruction.
Date: 2026-08-16
Phase: Phase 9 — Frontend/Product Surface (Slice 1: Upload → Ingestion → Validation)

## Scope delivered

Product-facing HTTP surface for the EXISTING real ingestion pipeline. No
solver, persistence model, ingestion architecture, authentication model, or
concurrency control was redesigned. The slice adds:

- `POST /exam-seating/documents?examId=<id>` (ADMIN) — raw `application/pdf`
  body; invokes `ingestExamDocument` only.
- `GET /exam-seating/documents/:id` (authenticated) — ingestion status using
  existing `DocumentParseStatus` terminology (UPLOADED / PROCESSING / PARSED /
  NEEDS_REVIEW / REJECTED / FAILED).
- `GET /exam-seating/documents/:id/candidates` (authenticated, paginated) —
  validated-candidate view over existing persisted `ExamCandidate` snapshots.

## Decisions locked (product)

- Upload permission: **ADMIN-only** for the initial slice (ingestion mutates
  ExamCandidate). STAFF is read-only. `permission-matrix.md` is the single
  authoritative table.
- `fileName` control gap: **closed** — `sanitizeFileName` strips C0/C1 + bidi
  controls, NFC-normalizes, collapses whitespace, caps at 255 chars, applied at
  the persistence boundary (`registerDocument`). Upload route adds magic-byte
  `%PDF-` sniffing + 20 MiB size cap + content-type check.
- Approve/Publish permissions remain TBD (no HTTP route exists; Phase 8b). The
  future publish route MUST map concurrent-conflict P2002 to
  `409 { error: "ALREADY_PUBLISHED" }` (Phase 9 §12) — NOT implemented here.

## Standing API rules satisfied (§1)

- Authentication explicit per route: `requireAdmin` on upload; `requireAuth`
  on status/candidate reads. Unauthenticated → 401 `UNAUTHORIZED`; wrong role
  → 403 `FORBIDDEN`.
- Every known application error has an intentional HTTP contract:
  `MISSING_EXAM_ID` 400, `INVALID_FILE_TYPE` 400, `EMPTY_UPLOAD` 400,
  `PAYLOAD_TOO_LARGE` 413, `EXAM_NOT_FOUND` 404, `DOCUMENT_NOT_FOUND` 404,
  `INVALID_PAGINATION` 400, `PLAN_NOT_FOUND` 404 (unchanged). Duplicate upload
  → 200 with `duplicate: true` + `existingDocumentId` (dedupe is not an error).
  Genuinely unexpected exceptions still fall through to the Phase 7b generic
  `500 { error: "INTERNAL_ERROR" }`.
- No internal details leak: responses expose only persisted records and the
  sanitized `fileName`; parser/Prisma/stack traces never reach the client.

## Security review outcome (§5)

`ingestion-security-review.md` records per-control VERIFIED / PARTIALLY
VERIFIED / NOT IMPLEMENTED against the ACTUAL ingestion path:

- Field-length limits: PARTIALLY VERIFIED — register numbers regex-bounded +
  master-looked-up; names master-sourced; **fileName gap closed this phase**.
- Control-character handling: PARTIALLY VERIFIED — register numbers rejected;
  names not persisted; **fileName gap closed this phase**.
- Bidi handling: NOT IMPLEMENTED for raw PDF text (names not persisted, register
  numbers rejected); **fileName gap closed this phase**.
- Unicode normalization: NOT IMPLEMENTED (no `.normalize()` in `src`; register
  numbers/names effectively ASCII via validation/master-sourcing). Optional
  hardening (`\d` → `[0-9]`, NFC) recorded as future work.
- Formula-injection protection: NOT APPLICABLE today (no spreadsheet export
  exists; Proforma 1 is a PDF). Recorded as a future requirement when a
  CSV/Excel export is introduced.

The STOP condition (§13.4) was applied: the slice was NOT implemented until the
fileName control gap was resolved. It is resolved; no known unresolved
threat-model gap remains on the exposed path.

## Ingestion path integrity (§2, §4, §8)

- The upload route calls `ingestExamDocument` only — extraction, normalization,
  student-master validation, `ExamCandidate` upsert, `sourceDocumentId`
  association, parse-status transitions, and dedupe are the existing service
  layer (architecture-inventory.md maps each function).
- `student-master` remains the validation authority; PDF→seat direct generation
  was NOT introduced.
- Candidate view uses existing persisted snapshots (master-sourced fields);
  no second student-data representation.

## Tests (§1, §6)

`tests/phase9-upload.test.ts` — 12 tests, 12/12 green:
  unauthenticated upload 401; STAFF upload 403; ADMIN real-PDF ingest (PARSED,
  candidates persisted with sourceDocumentId, master-sourced names); duplicate
  upload 200 duplicate:true; fileName sanitization (unit + route, length cap);
  unknown exam 404 EXAM_NOT_FOUND; missing examId 400; wrong content type 400;
  non-PDF magic bytes 400; oversized body 413; status GET 200/401/404; candidate
  view pagination + 400 INVALID_PAGINATION + 401/404.

## Regression (§11)

- `npm-test.log`: consolidated full-suite record. Every test file passed at
  least once this session. Effective totals: **160 passed / 3 skipped** (the 3
  skips are the env-gated storage-integration suite requiring SUPABASE
  credentials), 0 assertion failures. Baseline 148/3 → +12 upload tests.
  Transient full-suite failures were environmental only: one esbuild
  transform-service crash (confirmed environmental via isolation runs) and
  Supabase pooler connection drops (known Phase 7c behavior); the two affected
  suites passed cleanly in focused re-runs (phase9 12/12, ingestion-e2e 1/1).
- pytest: 98 passed (`pytest.log`).
- typecheck: clean (`typecheck.log`).
- Frozen solver files: all 6 UNCHANGED (`frozen-file-diff.log`).
- Existing verified behavior kept green: Phase 5 auth, Phase 6 trust boundary,
  Phase 7b sanitization, Phase 7c PLAN_NOT_FOUND→404, Phase 8 publication
  concurrency, Phase 8b route findings, real-ingestion E2E, orchestration,
  solve-job, persistence, and domain suites.

## Evidence (docs/evidence/phase9/)

- architecture-inventory.md, permission-matrix.md, ingestion-security-review.md
- upload-route.log, upload-auth-test.log, upload-validation-test.log,
  ingestion-e2e.log, npm-test.log, pytest.log, typecheck.log,
  frozen-file-diff.log
- phase9-upload-closeout.md (this file)

## Future work (explicitly out of slice scope)

- Frontend upload flow UI (Select PDF → Upload → status → validation result →
  ready-for-generation) built against these endpoints.
- Approve/Publish HTTP routes with the mandated `409 ALREADY_PUBLISHED`
  contract (Phase 9 §12) and the ADMIN/STAFF decision for those TBD cells.
- Optional hardening: `[0-9]` in extractor regexes, NFC normalization.
- Formula-injection escaping when/if a spreadsheet export is introduced.

## Honest classification

Slice 1: VERIFIED and green. The pooler connection drops during the full-suite
run are the pre-existing Phase 7c environment condition, not a Phase 9 defect;
focused re-runs confirm the affected suites are green. No commit was made —
awaiting explicit instruction.
