# Phase 19 — Exam Management Discovery Audit

**Date**: 2026-08-19

**Status**: Discovery Complete

**Document Path**: `docs/evidence/phase19/phase19-discovery.md`

## 1. Current Exam Schema

`prisma/schema.prisma` models all core entities required for exam management and scheduling.

```text
model Exam {
  id          String         @id @default(uuid())
  code        String         @unique
  title       String
  examDate    DateTime
  session     ExamSession    // FN | AN
  status      ExamStatus     // DRAFT, DOCUMENT_UPLOADED, VALIDATED, SEATED, APPROVED, PUBLISHED
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  document    UploadedDocument?
  candidates  ExamCandidate[]
  plans       SeatingPlan[]
}
```

* **`Exam`**: Core entity holding schedule metadata, session window (`FN`/`AN`), and status lifecycle state. (**VERIFIED**)
* **`UploadedDocument`**: Strict 1-to-1 relationship with `Exam` via `examId`. Stores file metadata, storage key, and SHA-256 hash. (**VERIFIED**)
* **`ExamCandidate`**: Connects `Exam` to `Student` master record. Tracks status (`VALIDATED`, `INVALID_STUDENT`, `DUPLICATE`). (**VERIFIED**)
* **`SeatingPlan`**: 1-to-many relationship with `Exam`. Links generated seating outputs directly to the parent exam. (**VERIFIED**)

## 2. Current Exam API

Backend endpoints are implemented in `src/phase4/api.ts` with supporting domain logic in `src/services/exam.service.ts`.

| Endpoint                             | Method | Role             | Description                                                    | Status       |
| ------------------------------------ | ------ | ---------------- | -------------------------------------------------------------- | ------------ |
| `/api/exams`                         | `GET`  | `STAFF`, `ADMIN` | List all exams with optional status filtering                  | **VERIFIED** |
| `/api/exams`                         | `POST` | `ADMIN`          | Create new exam record                                         | **VERIFIED** |
| `/api/exams/:id`                     | `GET`  | `STAFF`, `ADMIN` | Fetch exam details, uploaded document, and candidate count     | **VERIFIED** |
| `/api/exams/:id/documents`           | `POST` | `ADMIN`          | Upload PDF candidate timetable                                 | **VERIFIED** |
| `/api/exams/:id/candidates/validate` | `POST` | `ADMIN`          | Trigger validation of parsed candidates against Student Master | **VERIFIED** |
| `/api/exams/:id/candidates`          | `GET`  | `STAFF`, `ADMIN` | Fetch candidate roster with validation status breakdown        | **VERIFIED** |

## 3. Current Exam UI

Frontend routing and pages are located in `frontend/src/pages/` and consumed via `frontend/src/lib/api.ts`.

* **`ExamsPage.tsx`**: Displays exam list with session badges, status tags, and search/filter inputs. (**VERIFIED**)
* **`ExamDetailPage.tsx`**: Manages document upload, candidate roster inspection, and pre-generation status checks. (**VERIFIED**)
* **`ExamCreateModal.tsx`**: Form modal for creating new exam entries with code, title, date, and session selection. (**VERIFIED**)
* **Manual Candidate Roster Override Component**: Interface to manually add/remove candidates prior to generation. (**MISSING**)

## 4. Document / PDF Pipeline Trace

1. **Upload Handler**: `src/services/exam-document/upload.ts` receives PDF stream, calculates SHA-256 digest, and writes object to private Supabase bucket. (**VERIFIED**)
2. **Parsing**: `src/services/exam-document/parser.ts` extracts text lines using `pdf-parse` and uses regular expressions to collect candidate registration numbers. (**VERIFIED**)
3. **Single Document Constraint**: `UploadedDocument` model enforces `@unique [examId]`. Re-uploading replaces existing record and resets candidate validation status. (**VERIFIED**)

## 5. Candidate Validation Pipeline Trace

```text
Parsed Candidate Register Numbers
  ↓
Lookup against Student Master Table (`Student`)
  ↓
Match Status Assignment:
  ├── Found & Active → status = VALIDATED
  ├── Missing / Inactive → status = INVALID_STUDENT
  └── Multi-occurrence → status = DUPLICATE
```

* Validation execution runs in an isolated transaction in `src/services/candidate.service.ts`. (**VERIFIED**)
* Candidates flagged as `INVALID_STUDENT` or `DUPLICATE` are excluded from solver inputs. (**VERIFIED**)

## 6. Seating Integration Trace

* **Input Compilation**: `src/services/seating/solverInput.service.ts` queries active candidate records (`status = VALIDATED`) and available seats (`isActive = true` across active halls). (**VERIFIED**)
* **Solver Boundary**: Formats input payload matching Python FastAPI requirements (`solver-service/app/main.py`). (**VERIFIED**)
* **Plan Persistence**: `src/services/seating/plan.service.ts` records `SeatingPlan` and associated `SeatAssignment` rows with status set to `DRAFT`. (**VERIFIED**)

## 7. Exam Lifecycle

```text
[DRAFT] → [DOCUMENT_UPLOADED] → [VALIDATED] → [SEATED] → [APPROVED] → [PUBLISHED]
```

* State transitions are governed by strict pre-condition checks in `src/services/exam.service.ts`. (**VERIFIED**)
* Explicit `CANCELLED` status transition in UI/API. (**MISSING**)

## 8. RBAC & Access Controls

* **`ADMIN`**: Granted full write privileges (Exam creation, document upload, candidate validation, plan generation, approval, publication). (**VERIFIED**)
* **`STAFF`**: Granted read-only view access to exams, candidate summaries, and published seating layouts. Route guards enforced via API middleware in `src/phase4/api.ts`. (**VERIFIED**)

## 9. Audit Logging

Every state-changing mutation logs an entry into `AuditLog`:

* `EXAM_CREATED` (**VERIFIED**)
* `EXAM_DOCUMENT_UPLOADED` (**VERIFIED**)
* `EXAM_CANDIDATE_VALIDATED` (**VERIFIED**)
* `SEATING_PLAN_GENERATED` (**VERIFIED**)
* Candidate manual override audit actions. (**MISSING**)

## 10. Test Coverage Audit

* **Backend Services**: `tests/exam.test.ts` (12 tests), `tests/candidate-validation.test.ts` (8 tests). (**VERIFIED**)
* **Storage Integration**: `tests/storage-integration.test.ts` (3 tests, fail-closed env gate). (**VERIFIED**)
* **Frontend API Layer**: `frontend/src/lib/api.test.ts`. (**VERIFIED**)
* **E2E Specs**: `e2e/specs/exam-management.spec.ts` (Coverage for happy path CRUD and upload). (**PARTIAL**)

## 11. Historical Safety & Invariants

* **Seating Plan Immutability**: Once a `SeatingPlan` transitions to `APPROVED` or `PUBLISHED`, candidate lists, hall seats, and assignments associated with that exam are immutable. (**VERIFIED**)
* **Cascade Safeguards**: Foreign key constraints prevent deleting `Exam` records with dependent `SeatingPlan` or `SeatAssignment` entries. (**VERIFIED**)

## 12. Missing Functionality

1. **Pre-flight Conflict Detector**: Backend utility to flag student schedule collisions (a student enrolled in two distinct exams occurring in the same date and session window). (**MISSING**)
2. **Manual Candidate Overrides**: UI modal and supporting API endpoints allowing admins to add missing students or exclude individual candidates with explicit audit reasons. (**MISSING**)
3. **CSV Fallback Ingestion**: Alternative candidate upload path when timetable PDFs are unparseable or non-standard. (**MISSING**)

## 13. Recommended Phase 19 Implementation Scope

1. **Schedule Collision Detection Engine**: Add `checkExamConflicts` service method and API pre-flight check endpoint before seating plan generation.
2. **Manual Candidate Roster Management**: Add API routes (`POST /api/exams/:id/candidates/override`) and UI component to allow granular addition/exclusion of candidates.
3. **CSV Candidate Ingestion**: Implement secondary CSV parse utility for direct roster upload.
4. **Lifecycle & Cancel Workflows**: Expose exam cancellation and status reset flows with strict audit logging.
5. **E2E Test Expansion**: Extend `e2e/specs/exam-management.spec.ts` to cover schedule conflicts, manual overrides, and CSV ingestion.

## 14. Explicit Out-of-Scope Items

* Modifications to solver algorithms or solver input schema (`solver-service/*`).
* Modifications to hall capacity models or dynamic seat projection logic.
* Alterations to published `SeatingPlan` or `SeatAssignment` records.

## 15. Frozen Boundaries

* `solver-service/` (All files frozen)
* `src/services/seating/solverInput.service.ts` (Frozen)
* `prisma/schema.prisma` (`SeatingPlan`, `SeatAssignment`, `HallSeat` models frozen)

## Final Status

```text
PHASE 19 — DISCOVERY COMPLETE
```