# Phase 3 Discovery

> Factual report of the current AR-SEAT state before Phase 3 (CP-SAT seating solver) is designed or implemented.
> Produced from direct repository inspection and local execution. No Phase 3 code was written.

## 1. Current Project Status

- Repository: https://github.com/ranjithlranjith810-ops/AR-SEAT.git
- Baseline: `c7b4bc9` (`feat: complete exam document ingestion phase`) on `main`
- Phase 2 (exam document ingestion): **COMPLETE / VERIFIED / FROZEN**
- Language/runtime: TypeScript (Node ≥ 20, ESM), Prisma ORM, Supabase (Postgres + Storage)
- No HTTP server exists. The project is a service-layer library consumed by scripts and tests.

## 2. Local Verification

All commands run against the real configured environment (`DATABASE_URL` = dev DB, test suite targets the isolated `exam_seating_test` DB).

| Command | Result |
|---|---|
| `npm install` | PASS (`up to date`, 0 vulnerabilities) |
| `npm run db:generate` | PASS (Prisma Client v6.19.3 generated) |
| `npm run db:migrate` | PASS (applied pending `20260813090000_exam_doc_dedup`; schema in sync) |
| `npm run db:seed` | PASS (idempotent upserts; seeded halls/classes/students) |
| `npm test` | PASS — **85 passed / 3 skipped** (12 files passed, 1 skipped = storage integration; ~5.4 min) |
| `npm run typecheck` | PASS (`tsc --noEmit` exit 0) |

Notes:

- `npm test` = `node scripts/run-tests.mjs` → setup test DB → `prisma migrate deploy` → seed → `vitest run`, all against `exam_seating_test`. The 3 skipped are the live-storage suite (requires explicit `STORAGE_INTEGRATION=1`).
- Results match the frozen Phase 2 evidence (`normal-run.log`).

## 3. Existing Student Data

`Student` model (`students`), verified in `prisma/schema.prisma`:

- `id` — uuid PK
- `name` — string
- `rollNumber` — string (indexed)
- `registerNumber` — string, **unique** (indexed)
- `gender` — enum `Gender` (MALE / FEMALE / OTHER)
- `classId` — FK to `Class` (indexed)
- `status` — enum `StudentStatus` (ACTIVE / INACTIVE / PASSED_OUT / TRANSFERRED), default ACTIVE (indexed)
- `createdAt` / `updatedAt`

Field review against the Phase 3 wish list:

- `id` **EXISTS**
- `registerNumber` **EXISTS** (unique)
- `rollNumber` **EXISTS**
- `name` **EXISTS**
- `gender` **EXISTS**
- `classId` **EXISTS**
- `departmentId` **MISSING** (department is reached indirectly: `Student → Class → Department`)
- `academicYear` **MISSING** (exists on `Class`, not on `Student`)

## 4. Existing Exam Data

`Exam` model (`exams`):

- `id` — uuid PK
- `examDate` — DateTime
- `session` — enum `ExamSession` (FN / AN)
- `examType` — enum `ExamType` (UNIVERSITY / INTERNAL / MODEL), default UNIVERSITY
- `status` — enum `ExamStatus` (DRAFT / READY / GENERATING / GENERATED / APPROVED / PUBLISHED / CANCELLED), default DRAFT (indexed)
- `createdAt` / `updatedAt`
- Relations: `candidates`, `documents`, `seatingPlans`, `solveJobs`

Full status state machine in `src/services/exam.service.ts` (`DRAFT → READY → GENERATING → GENERATED → APPROVED → PUBLISHED`).

## 5. Existing Exam Candidates

`ExamCandidate` model (`exam_candidates`) **EXISTS**:

- `id` — uuid PK
- `examId` — FK (indexed)
- `studentId` — FK (indexed)
- `sourceDocumentId` — optional FK to `UploadedExamDocument`
- `registerNumberSnapshot` — string (indexed)
- `studentNameSnapshot` — string
- `departmentSnapshot` — string (dept code at match time)
- `genderSnapshot` — enum `Gender`
- `classSnapshot` — string
- `subjectCode` / `subjectName` — string
- `validationStatus` — enum `CandidateValidationStatus` (UNVERIFIED / MATCHED / VALIDATED / REJECTED), default UNVERIFIED (indexed)
- `createdAt` / `updatedAt`
- **Unique constraints:** `(examId, registerNumberSnapshot)`, `(examId, studentId)`

Validation flow (`src/services/candidate.service.ts`):

- State machine `UNVERIFIED → MATCHED → VALIDATED`, any → `REJECTED`
- `createCandidate` snapshots student fields at match time
- Snapshot immutability enforced once a candidate is in a **PUBLISHED** plan (`assertSnapshotMutable` → `SNAPSHOT_LOCKED`)
- The **VALIDATED gate** is enforced in the solver-input builder (see §6) — do not weaken or bypass it.

## 6. Existing Solver Input Contract

`src/services/solverInput.service.ts` **EXISTS** — this is the frozen Phase 2 → Phase 3 boundary.

```ts
interface SolverCandidate {
  id, registerNumberSnapshot, studentNameSnapshot,
  departmentSnapshot, classSnapshot, genderSnapshot: "MALE"|"FEMALE"|"OTHER",
  subjectCode, subjectName
}
interface SolverHallSeat { id, seatPosition, row, column }
interface SolverHall { id, hallNumber, name, building, rows, columns, capacity, seats: SolverHallSeat[] }
interface SolverInput {
  candidates: SolverCandidate[];
  candidateCount: number;
  halls: SolverHall[];
  availableSeatCount: number;
}
```

`buildSolverInput(examId)`:

- Only `validationStatus === "VALIDATED"` candidates
- Only `isActive` halls and `isActive` seats
- Computes hall `capacity` = count of active seats and `availableSeatCount`
- Ordered by register number / hall number

Also exposed: `buildSolverCandidateList(examId)`.

**This contract already provides everything the solver needs to consume. No schema change is required for the input side.**

## 7. Existing Hall/Seat Infrastructure

**EXISTS.** `Hall` and `HallSeat` models plus `src/services/hall.service.ts`:

- `Hall` (`halls`): `hallNumber` (unique), `name`, `building?`, `rows`, `columns`, `isActive`
- `HallSeat` (`hall_seats`): `hallId` FK, `seatPosition` (e.g. `A1`), `row` (letter), `column` (int), `isActive`; **unique `(hallId, seatPosition)`**
- `createHall` auto-generates seats from rows × columns (`A1..`, `B1..`, …)
- `deriveHallCapacity(hallId)` = count of active seats
- `getHallSeat(hallId, seatPosition)`, `setHallSeatActive(hallId, seatPosition, bool)`
- Seeded hall: `LH09` (Main Block, 5 rows × 5 cols = 25 seats)

## 8. Existing Seating Plan Infrastructure

**EXISTS.** `SeatingPlan` model (`seating_plans`) + `src/services/seatingPlan.service.ts`:

- Fields: `id`, `examId` FK, `version` (int), `status` (`SeatingPlanStatus`: DRAFT / APPROVED / PUBLISHED / SUPERSEDED), `supersedesPlanId?` (self-FK), `createdBy?`, `approvedBy?`, `publishedBy?`, `createdAt`, `approvedAt?`, `publishedAt?`, `updatedAt`
- **Unique `(examId, version)`**; only one PUBLISHED plan per exam enforced
- Lifecycle: `createPlan` (auto-increments version, supersedes prior active), `approvePlan`, `publishPlan` (supersedes any other published), `supersedePlan`
- Historical versions are retained (never overwritten), linked via `supersedesPlanId`

## 9. Existing Solve Job Infrastructure

**EXISTS.** `SolveJob` model (`solve_jobs`) + `src/services/solveJob.service.ts`:

- Fields: `id`, `examId` FK, `status` (`SolveJobStatus`: QUEUED / RUNNING / SUCCEEDED / INFEASIBLE / FAILED / CANCELLED), `solverStatus?` (OPTIMAL / FEASIBLE / INFEASIBLE / ERROR), `requestedBy?`, `startedAt?`, `completedAt?`, `heartbeatAt?`, `candidateCount`, `hallCount`, `assignedCount`, `unassignedCount`, `solverDurationMs?`, `timeLimitSeconds?`, `errorCode?`, `errorMessage?`, `infeasibilityReason?`
- State machine: `QUEUED → RUNNING → {SUCCEEDED, INFEASIBLE, FAILED, CANCELLED}`
- `requestSolve` prevents duplicate active jobs per exam
- `heartbeat` only allowed while RUNNING
- `reapStaleJobs` marks RUNNING jobs with stale/missing heartbeats → FAILED (`WORKER_TIMEOUT`)
- `completeSolve` requires OPTIMAL or FEASIBLE
- Audit events: SOLVE_REQUESTED / SOLVE_STARTED / SOLVE_COMPLETED / SOLVE_FAILED

**The worker orchestrator contract (request → start → heartbeat → complete/fail/infeasible) is fully implemented and tested.** Only the actual solving step is missing.

## 10. Phase 2 → Phase 3 Boundary

Frozen Phase 2 contract:

- `buildSolverInput(examId)` → `SolverInput` (VALIDATED candidates + active halls/seats + capacity)
- Persistence contract consumed by Phase 3: `SolveJob` lifecycle, `SeatingPlan` lifecycle, `SeatAssignment` rows, `AuditLog` events.

Phase 3 responsibility (not yet built):

1. Claim a job (`requestSolve`, `startSolve`, `heartbeat`)
2. Fetch `SolverInput`
3. Run the solver to map candidates → seats
4. Persist via `assignCandidateSeat` per assignment
5. Close the job via `completeSolve` (OPTIMAL/FEASIBLE) or `markInfeasible` / `failSolve`

## 11. Missing Phase 3 Components

- **The solver engine itself** — no OR-Tools, no CP-SAT, no FastAPI, no Python, no algorithm code (grep across repo: zero matches)
- **A worker/orchestrator** that executes the job lifecycle above (request → start → heartbeat → complete)
- **Assignment generation** — `assignCandidateSeat` exists only as a validated low-level insert; nothing decides *who sits where*
- **Solver rules / configuration** — adjacency, gender separation, department mixing, seat-exclusion policy (none exist)
- **Any API surface** — there are no HTTP endpoints anywhere in the repo

The **database schema is complete** — no new tables are needed for Phase 3 unless rule-specific data (e.g. candidate exclusion, plan-level constraint metadata) is required.

## 12. Product Decisions Required

Not decided — these must be agreed before the specification is written:

1. **Same-class adjacency rule** — must same-class candidates be kept apart? How far (same row / same column / anywhere)?
2. **Department mixing** — required or optional? Preferred ordering of departments within a hall?
3. **Gender separation** — required? Row/column/alternate-seat level?
4. **Hall allocation** — how candidates are distributed across halls (fill one hall first, or balance across halls)?
5. **Seat numbering / assignment order** — topology exists (`A1..`), but the assignment policy is open
6. **Optimization objective** — what is minimized? (adjacent-same-class count, hall fragmentation, etc.)
7. **Solver runtime** — OR-Tools CP-SAT is Python-only; the FastAPI + Python service decision, or an alternative (e.g. custom greedy/ILP in TS)
8. **Scale/time limits** — target sizes (100 / 500 / 1000 / 4000 / 10000) and per-size time limits for `timeLimitSeconds`
9. **Worker deployment** — heartbeat interval and stale-job timeout interplay (`reapStaleJobs` default 60 s)

## 13. Recommended Phase 3 Vertical Slice

Architecture only — **not implemented**.

```text
Validated candidates (ExamCandidate.validationStatus = VALIDATED)
        │
        ▼
Solve request (requestSolve) → job QUEUED
        │
        ▼
Worker (FastAPI + OR-Tools CP-SAT):
    startSolve (RUNNING) + heartbeat loop
        │
        ▼
buildSolverInput(examId)  ← frozen Phase 2 contract
        │
        ▼
CP-SAT model:
    candidates × active seats
    hard: one seat per candidate, one candidate per seat
    soft: separation rules (per agreed product decisions)
        │
        ▼
Assignments → SeatAssignment rows (assignCandidateSeat)
        │
        ▼
Validation (every candidate has a seat; no duplicate seats; capacity respected)
        │
        ▼
completeSolve (OPTIMAL / FEASIBLE) or markInfeasible / failSolve
        │
        ▼
SeatingPlan persisted (createPlan → assignments → approvePlan → publishPlan)
```

Recommended starting benchmark before scaling:

- **100 students** (VALIDATED candidates)
- **2 halls** (e.g. LH09 5×5 and one more generated hall)
- Known seat layout (rows × columns)
- One simple separation constraint (e.g. same-class candidates not adjacent)
- Then scale: 500 → 1000 → 4000 → 10000

## 14. Risks / Unknowns

- **OR-Tools CP-SAT has no official Node.js binding** — a Python (FastAPI) sidecar/service is the pragmatic path; this is an architectural decision, not an implementation detail.
- **Solve duration at 4000–10000 candidates** — CP-SAT with separation constraints may need explicit `timeLimitSeconds` and gap stopping; performance not yet measured.
- **`timeLimitSeconds` / heartbeat** — worker must heartbeat faster than `reapStaleJobs` timeout or it will be reaped.
- **Test suite runtime ~5.4 min** — long but stable; all results match frozen evidence.
- **Snapshot immutability** — once a plan is PUBLISHED, candidate snapshots are locked (`SNAPSHOT_LOCKED`); solver inputs must be rebuilt on new plan versions.

## 15. Recommendation

Proceed to write the Phase 3 specification using the existing schema and service layer as the contract:

1. The persistence + lifecycle layers (solve jobs, plans, halls, seats, assignments, audit) are **complete and tested**.
2. The **input contract is frozen** (`buildSolverInput`, VALIDATED-only).
3. The **only greenfield work** is the solver engine (FastAPI + OR-Tools CP-SAT) and its worker orchestration.

Resolve §12 (product decisions) before writing solver code. No repository changes are required to begin.