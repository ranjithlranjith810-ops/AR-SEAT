# Phase 9 — PDF-Content Validation Review (Upload Feature Threat-Model Controls)

Status: PARTIALLY VERIFIED — see per-control records. STOP applied per Phase 9 §5/§13.4: the upload slice is BLOCKED pending resolution of the `fileName` control gap and explicit product permission decisions.
Date: 2026-08-16
Method: source review of the ACTUAL ingestion path (`src/services/exam-document/*`, `src/services/candidate.service.ts`, schema), plus grep over `src` for each control. No control is marked complete from documentation alone.

## Controls

### 1. Field-length limits — PARTIALLY VERIFIED

- `registerNumberSnapshot` (persisted from the PDF): bounded in practice. Extraction canonical regex `^(DEMO-[A-Z]{2,4}-\d{3,5}|\d{6,14})$` (`extractorConfig.ts`); validation regex `/^[A-Za-z0-9-]+$/` + `STUDENT_NOT_FOUND` blocking (`validate.ts`) mean only master-looked-up rows persist. Effective bound ≤ 14 chars, ASCII.
- Name (persisted): NOT PDF-derived — `studentNameSnapshot`/`departmentSnapshot`/`genderSnapshot`/`classSnapshot` come from the student master (`ingest.ts` `upsertCandidate`). Raw PDF name is only used for the `NAME_MISMATCH` comparison and never persisted, so unbounded PDF names cannot grow the DB.
- `fileName` (persisted from the client upload): **NOT ENFORCED — GAP.** `UploadedExamDocument.fileName` stores the raw client-supplied name (`document.service.ts:57`); the sanitized form is used only for the storage KEY (`buildStoragePath`). No length cap, no character sanitization on the persisted display field. Schema columns are TEXT (no VARCHAR caps), so there is no DB-level bound.
- `subjectCode` / `subjectName`: bounded by header regexes or `"UNKNOWN"`.
- Verdict for the upload feature: the fileName path is the outstanding gap.

### 2. Control-character handling — PARTIALLY VERIFIED

- Register numbers containing control characters → `INVALID_REGISTER_NUMBER` → REJECTED (not persisted).
- Extracted text: `collapseWhitespace` (`\s+`) and `normalizeName` handle `\s`-class control characters but do NOT strip all C0/C1 controls (only the `\s` subset). Raw PDF names are not persisted, so control chars in names do not reach the DB; they can only produce false `NAME_MISMATCH` comparisons.
- `fileName`: **no control-character stripping on the persisted field — GAP.**

### 3. Bidi-character handling — NOT IMPLEMENTED

- Grep over `src` for bidi handling: no matches. No bidi sanitization exists.
- Mitigations that happen to contain the risk for student data: register numbers with bidi characters fail the `[A-Za-z0-9-]` validation regex (rejected); names are master-sourced (not PDF-derived).
- `fileName`: can carry bidi characters into a persisted + audit-logged display field (rendering/spoofing concern for the new upload surface) — **GAP.**

### 4. Unicode normalization — NOT IMPLEMENTED

- No `.normalize("NFC"/"NFD")` anywhere in `src` (grep: no matches). No Unicode normalization applied to PDF-derived text.
- Impact today is limited: persisted register numbers must match the master and pass `[A-Za-z0-9-]`; names are master-sourced. Note JS `\d` in the extractor regexes matches Unicode decimal digits (e.g. Arabic-Indic); such rows are rejected downstream by `[A-Za-z0-9-]`, so this is a safe-but-implicit boundary. If hardening is wanted, switch extractor `\d` to `[0-9]` and add NFC normalization.

### 5. Formula-injection protection / escaping — NOT APPLICABLE (correctly absent)

- No spreadsheet-like export path exists: grep over `src` for csv/xlsx/spreadsheet/export produced no matches. Proforma 1 output is a PDF (`src/phase4/proforma.ts`), not CSV/Excel.
- Recorded as a FUTURE requirement: escaping/formula-injection guards (leading `= + - @`, tab/CR injection, quoting) MUST be added on the day a CSV/Excel export is introduced. This control is NOT marked complete.

## Overall assessment

- Student data reaching `ExamCandidate` is well constrained by (a) master-lookup blocking, (b) the `[A-Za-z0-9-]` register-number validation, and (c) master-sourced snapshot fields. The five threat-model controls are therefore PARTIALLY satisfied for the persisted student dataset without explicit code.
- The one genuine control gap on the exact upload path is the **raw client `fileName`** persisted into `UploadedExamDocument.fileName` (control chars, bidi, unbounded length, audit-log rendering).
- STOP (Phase 9 §13.4): the upload feature is not implemented while a required control gap exists on the path it exposes.

## Required resolution before Slice 1

1. Sanitize/normalize `fileName` for persistence before `registerDocument` is called (strip C0/C1 and bidi controls; cap length; optional NFC). The storage KEY already sanitizes; the persisted display field must too.
2. Optional hardening (recommended): explicit `[0-9]` in extractor regexes and NFC normalization.
3. Upload route must add size limits and content-type checks (magic-byte sniffing) — none exist today, and they are API-level controls for the new surface (Phase 9 §6).

## Evidence pointers

- Ingestion path: `src/services/exam-document/{upload,ingest,extract,pdf,normalize,validate,document.service}.ts`
- Persisted snapshot sourcing: `ingest.ts:200-250` (master values)
- fileName persistence: `document.service.ts:40-73`; storage-key sanitization only: `ingest.ts:186-188`
- Schema (TEXT columns, no caps): `prisma/schema.prisma:175-224`
- Auth/roles: `src/phase4/auth/{guards,users,session}.ts`