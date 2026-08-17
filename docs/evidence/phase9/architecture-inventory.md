# Phase 9 — Architecture Inventory

Status: INVESTIGATION COMPLETE (opening deliverable; Slice 1 not implemented)
Date: 2026-08-16
Scope: existing real ingestion pipeline and product-facing HTTP surface, mapped for the Phase 9 upload/ingestion slice.

---

## 1. PDF upload / storage

- `src/services/exam-document/upload.ts`
  - `MemoryDocumentStore` — in-memory store; used by tests/CI/local development.
  - `SupabaseDocumentStore` — writes into a private Supabase bucket (default `exam-documents`) via the service-role client; `contentType: application/pdf`, `upsert: true`; also `signedUrl`, `get`, `metadata`, `exists`, `delete`.
  - `sha256`, `metadataSha256` helpers.
- `src/services/exam-document/ingest.ts:190-198` `resolveStore(mimeType)` — picks `SupabaseDocumentStore` only if `mimeType === "application/pdf"` AND both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set; otherwise `MemoryDocumentStore`. Production upload requires those two env vars.
- `src/services/exam-document/ingest.ts:186-188` `buildStoragePath(examId, fileName)` — storage key `exams/{examId}/{Date.now()}-{fileName}` where `fileName` is sanitized with `fileName.replace(/[^a-zA-Z0-9._-]/g, "_")`. Sanitization applies to the storage KEY only, not the persisted display field.
- `src/services/exam-document/document.service.ts:40-73` `registerDocument` — computes `fileHash` (sha256), dedupes via the `examId_fileHash` unique constraint, persists the `UploadedExamDocument` row (`fileName` = RAW client-supplied name, `mimeType`, `fileSize`, `fileHash`, `parseStatus: "UPLOADED"`, `uploadedBy`), and logs `PDF_UPLOADED` audit.

## 2. PDF extraction

- `src/services/exam-document/pdf.ts` `extractPdfText` — pdfjs-dist (legacy build); per-page text content; line reconstruction by baseline y with `LINE_TOLERANCE = 2`; page ordering by descending y.
- `src/services/exam-document/extract.ts` `extractRowsFromText` — pattern-driven extraction: `collapseWhitespace` per line; `detectHeader` via `metadataPatterns` (institution / regulation / subjectCode / subjectName / date / session); register-token detection via `registerNumberPattern`; stop-token filtering; name tokens (register token and serial-like tokens filtered out). Emits `PAGE_HEADER_SKIPPED` / `UNMATCHED_LINE` warnings.
- `src/services/exam-document/extractorConfig.ts` — `ANNA_UNIVERSITY_TEXT_TABLE_CONFIG` (default) and `GENERIC_TEXT_TABLE_CONFIG`; `DEFAULT_EXTRACTOR_CONFIG`.

## 3. Student-master lookup / validation

- `src/services/exam-document/validate.ts`
  - `lookupStudents` — `student.findMany` by `registerNumber in [...]`; select id/name/registerNumber/status.
  - `validateCandidate` — issues: `MISSING_REGISTER_NUMBER`, `MISSING_NAME`, `INVALID_REGISTER_NUMBER` (regex `/^[A-Za-z0-9-]+$/`), `STUDENT_NOT_FOUND`, `NAME_MISMATCH` (via `normalizeNameKey`), `STUDENT_INACTIVE`.
  - `hasBlockingIssue` — blocking set: MISSING_REGISTER_NUMBER, MISSING_NAME, INVALID_REGISTER_NUMBER, STUDENT_NOT_FOUND.
  - `dedupeCandidates` — `DUPLICATE_IN_DOCUMENT`.
  - `normalizeInput` — validation + dedupe over normalized rows.
- `src/services/exam-document/normalize.ts` — `normalizeRow` / `normalizeRegisterNumber` (uppercase + canonical match) / `normalizeName` (join tokens, collapse whitespace, uppercase). No Unicode normalization.

## 4. ExamCandidate creation / update

- `src/services/exam-document/ingest.ts:200-250` `upsertCandidate` — upsert by `examId_registerNumberSnapshot`; create sets:
  - `registerNumberSnapshot` — from the PDF (validated + master-looked-up),
  - `studentNameSnapshot` / `departmentSnapshot` / `genderSnapshot` / `classSnapshot` — from the STUDENT MASTER (not the PDF),
  - `subjectCode` / `subjectName` — from the extraction header or `"UNKNOWN"`,
  - `validationStatus: "MATCHED"`, `sourceDocumentId: document.id`.
  - update sets `sourceDocumentId` + `MATCHED`. Logs `CANDIDATE_MATCHED` audit.
- Manual path `src/services/candidate.service.ts`: `createCandidate` (status `UNVERIFIED`), `transitionValidationStatus` (UNVERIFIED → MATCHED → VALIDATED / REJECTED machine), `assertSnapshotMutable` (`SNAPSHOT_LOCKED` when part of a PUBLISHED plan), `updateCandidateSnapshot`.
- Schema `prisma/schema.prisma:175-202` — `ExamCandidate`: `@@unique([examId, registerNumberSnapshot])`, `@@unique([examId, studentId])`; all string columns are TEXT (no VARCHAR caps).

## 5. sourceDocumentId association

- Set on create AND update in `upsertCandidate` (ingest.ts:225, 236); the manual `createCandidate` accepts an optional `sourceDocumentId`.
- E2E-verified: every ExamCandidate row created by the real ingestion path carries `sourceDocumentId === document.id`.

## 6. Ingestion status / error handling

- `src/services/exam-document/document.service.ts`
  - `DocumentParseStatus` machine: `UPLOADED → PROCESSING → {PARSED, NEEDS_REVIEW, REJECTED, FAILED}`; `PARSED/NEEDS_REVIEW → PROCESSING` reparse allowed. `assertParseTransition` throws `INVALID_PARSE_STATUS_TRANSITION`.
  - `markProcessing` / `markParsed` / `markNeedsReview` / `markRejected` / `markFailed` persist `parseMetadata`.
  - `getDocument` → `DOCUMENT_NOT_FOUND`.
- `src/services/exam-document/ingest.ts`
  - Duplicate path: `findDuplicateDocument(examId, sha256)` → returns report with `duplicate: true`, `existingDocumentId`.
  - `resolveFinalStatus`: extraction warnings → `NEEDS_REVIEW`; `matched === 0` → `REJECTED`; `extractedRows > matched` → `NEEDS_REVIEW`; else `PARSED`.
  - `commitParseStatus` persists status + `issuesByCode` + warnings in `parseMetadata`.
  - Catch block: any error after registration → `markFailed(document.id, message)` then rethrow; `DOCUMENT_NOT_FOUND` rethrown unchanged.
- Audit trail via `src/services/audit.service.ts` `logAudit`.

## 7. Existing real-ingestion E2E test

- `tests/phase4-ingestion-e2e.test.ts` — builds a PDF (`tests/fixture-pdf.ts`: `buildPdf`, `annaFixtureLines`); drives `ingestExamDocument` → asserts PARSED + counts; asserts every ExamCandidate row has `sourceDocumentId` and `MATCHED`; `transitionValidationStatus` → VALIDATED; `reconcileExamForGeneration`; `runSeatingGeneration` (stub dispatch); transactional plan (DRAFT, version 1, one assignment per candidate); `solveJob` SUCCEEDED; Proforma 1 PDF round-trip (register numbers match). 240 s timeout, green.

## 8. HTTP surface today (`src/phase4/api.ts`)

- `POST /auth/login` (public), `POST /auth/logout`, `GET /auth/me` (`requireAuth`).
- `POST /exam-seating/generations` (`requireAdmin`).
- `GET /exam-seating/generations/:id` (`requireAuth`), `GET /exam-seating/generations/:id/seating` (`requireAuth`).
- Fallthrough → `404 { error: "NOT_FOUND", ... }`.
- NO upload / document / candidate route exists (consistent with Phase 8b finding: no publication route either).
- Auth guards `src/phase4/auth/guards.ts`: `requireAuth` → 401 `UNAUTHORIZED`; `requireRole` → 403 `FORBIDDEN`; roles `ADMIN`/`STAFF` (`UserRole` enum, schema.prisma:102).
- Error boundary: `AuthError` → its status/code; `SeatingError PLAN_NOT_FOUND` → 404; otherwise generic 500 `INTERNAL_ERROR` (Phase 7b). Known errors must be mapped before reaching this boundary (Phase 9 §1).

## 9. Slice 1 boundary (no duplicated logic)

- The product upload endpoint must invoke `ingestExamDocument` only — extraction, validation, and ExamCandidate sync must NOT be re-implemented in the route or frontend.
- Production storage requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (and the bucket, default `exam-documents`). The route must also add file-type and size limits (see `ingestion-security-review.md`; no size cap exists today).