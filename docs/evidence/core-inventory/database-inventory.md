# AR-SEAT Database Inventory

Ground truth: `prisma/schema.prisma` (committed at HEAD) + `prisma/migrations/` (only 3 SQL migrations). No runtime migrations added.

## Migrations (exact)

1. `20260812132538_init` — all core models (see below)
2. `20260813090000_exam_doc_dedup` — exam-document dedup (`[examId, fileHash]` unique)
3. `20260815170000_add_auth` — `User` + `AuthSession`

## Enums

| Enum | Values |
|---|---|
| `Gender` | MALE, FEMALE, OTHER |
| `StudentStatus` | ACTIVE, INACTIVE, PASSED_OUT, TRANSFERRED |
| `ExamSession` | FN, AN |
| `ExamType` | UNIVERSITY, INTERNAL, MODEL (fixed — not extensible without migration) |
| `ExamStatus` | DRAFT, READY, GENERATING, GENERATED, APPROVED, PUBLISHED, CANCELLED |
| `CandidateValidationStatus` | UNVERIFIED, MATCHED, VALIDATED, REJECTED |
| `DocumentParseStatus` | PARSED, NEEDS_REVIEW, REJECTED |
| `SeatingPlanStatus` | DRAFT, APPROVED, PUBLISHED, SUPERSEDED, CANCELLED |
| `SolveJobStatus` | QUEUED, RUNNING, SUCCEEDED, FAILED, INFEASIBLE, CANCELLED |
| `SolverStatus` | OPTIMAL, FEASIBLE |
| `AuditAction` | 11 values (PDF_UPLOADED, CANDIDATE_MATCHED, CANDIDATE_RESOLVED, PLAN_SUPERSEDED, SOLVE_STARTED, SOLVE_SUCCEEDED, SOLVE_FAILED, GENERATION_FAILED, GENERATION_INFEASIBLE, PLAN_APPROVED, PLAN_PUBLISHED) |
| `UserRole` | ADMIN, STAFF |

Note: `StudentStatus` has **no HAS_ARREAR / DISCONTINUED**; `ExamStatus` has transitions defined only in `exam.service.ALLOWED_TRANSITIONS` (no production caller for most).

## Models

| Model | Key constraints | Notes |
|---|---|---|
| `Department` | — | name; 4 seeded (CSE/ECE/EEE/MECH) |
| `Class` | FK departmentId | name; 5 seeded (CSE-A/CSE-B/ECE-A/EEE-A/MECH-A, year 3); `academicYear` string |
| `Student` | **unique `registerNumber`**; FK classId | **The Student Master (STATE A)** — name, gender, status, rollNumber. No CRUD surface. |
| `Exam` | unique ref; session; date/time; type; status | creation seed/test-only |
| `ExamCandidate` | unique `[examId, registerNumberSnapshot]`, `[examId, studentId]` | immutable snapshots: registerNumber/studentName/department/gender/class + subjectCode/year; validationStatus; FK exam, student, uploadedDocument |
| `UploadedExamDocument` | unique `[examId, fileHash]` | filename, fileHash, parseStatus, storageKey |
| `Hall` | — | hallNumber, rows, columns, capacity (derived) |
| `HallSeat` | unique `[hallId, seatPosition]`; FK hall | seatPosition `A1..A{rows}x{columns}`, row, column, active |
| `SeatingPlan` | unique `[examId, version]`; supersedesPlanId self-FK | versioned DRAFT→APPROVED→PUBLISHED/SUPERSEDED |
| `SeatAssignment` | unique `[seatingPlanId, examCandidateId]`, `[seatingPlanId, hallId, hallSeatId]` | the two uniqueness constraints prevent duplicate candidate and duplicate seat |
| `SolveJob` | FK exam; solverStatus; counts; duration | lifecycle QUEUED→RUNNING→SUCCEEDED/FAILED/INFEASIBLE |
| `AuditLog` | indexes entityType+entityId, action, actorId, createdAt | immutable writes |
| `User` | unique username | passwordHash (argon2), role |
| `AuthSession` | FK user; expiresAt | cookie-backed |

## Transactions & write paths

- `persist.ts` `persistValidatedGeneration`: one `$transaction` — find latest plan for exam → SUPERSEDE non-superseded latest (+ `PLAN_SUPERSEDED` audit) → create new DRAFT `SeatingPlan` (version+1) → `createMany` seat assignments → commit. **Only after commit** does `completeSolve` mark the SolveJob SUCCEEDED. Failure rolls back; job never falsely succeeds.
- `SeatAssignment` double-unique constraint (`[plan,candidate]` + `[plan,hall,hallSeat]`) is the DB-level guarantee against duplicate students or seats; `validateMerge.ts` enforces it earlier.
- Audit writes (`logAudit`) are transactional with their owning mutation (e.g., PDF upload, resolve, approve, publish, supersede).

## Data hygiene

- Seeds: `prisma/seed.ts` upserts 4 departments, 5 classes, 6 students/class (30 students), academic year 2025–2026. No exam/hall seeds in prod seed (halls created in E2E seed).
- `tests/helpers.ts` `verifyTestDatabase` refuses to run unless `RUN_TESTS=1` and DB name contains `exam_seating_test`; `run-tests.mjs` gates test DB ≠ dev DB.
- No tenant/school column anywhere (single-tenant). No RLS policies in any migration (app-layer auth only).