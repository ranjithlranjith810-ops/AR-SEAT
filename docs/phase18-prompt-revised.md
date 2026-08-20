# Phase 18 — Hall & Bench Management Specification

> Authoritative, self-contained prompt for the next OpenCode session.
> This document contains every requirement for Phase 18. There is no separate
> base prompt to consult; if a requirement is not stated here, it is not part
> of this phase.
>
> This phase builds on the Phase 17 completion state (student/department/class
> master surface, audit surface, full verification evidence under
> `docs/evidence/phase17/`). The six frozen solver files are the immutable
> ground truth for generation. The existing generation input path must be
> understood before any Hall/Bench code is written.

---

## 1. Mission

Deliver a complete **Hall & Bench Management** domain for AR-SEAT: a backend
REST surface and a STAFF/ADMIN browser UI to manage examination halls and the
benches within them, with correct capacity and positioning semantics, RBAC,
audit coverage, and full verification — without modifying the verified
seating/PDF/auth backbone and without changing the six frozen solver files.

The phase must first establish the real relationship between the Hall/Bench
domain and the generation pipeline. It must not assume that Hall/Bench data
feeds the solver; it must trace and prove where solver seats and capacity
actually come from today, and only then build the management layer around the
truth it finds.

## 2. Phase 17 provenance checkpoint (before any implementation)

Before writing any Hall/Bench code, verify and record the provenance of the
Phase 17 work that this phase builds on. Do not trust narrative claims.

### 2.1 Stale-evidence investigation

Do not rely solely on the previous agent's narrative. Collect raw filesystem
evidence:

```text
ls -la --time-style=full-iso docs/evidence/phase17/
```

Record relevant file mtimes/sizes before and after any evidence capture.

If an evidence-generation/capture script exists:

- inspect its mtime
- inspect its contents
- inspect git diff/status
- determine its actual output directory

If possible, compare file hashes between the old and newly captured evidence.

The conclusion must be supported by filesystem/script evidence, not prose
alone. Record findings in `docs/evidence/phase18/phase18-provenance.md`.

### 2.2 `student.service.ts` provenance and coverage

Determine whether `src/services/student.service.ts` is imported by shipped
Phase 17 routes (`src/phase4/api.ts`). If it is load-bearing, determine whether
its behavior was directly covered by the Phase 17 backend test suite
(`tests/phase17-student-master.test.ts`).

If it is load-bearing but lacks direct/meaningful coverage, record:

```text
PHASE 17 TEST-COVERAGE GAP
```

Do not silently fix it during the provenance checkpoint unless explicitly
required by Phase 18.

### 2.3 Provenance checkpoint ordering

1. Solver-input trace (Section 3) — before any Hall/Bench code.
2. Frozen-file pre-hashes (Section 4) — before any implementation.
3. Stale-evidence proof (Section 2.1) with filesystem/script evidence.
4. `student.service.ts` coverage check (Section 2.2).
5. Hall/Bench implementation.
6. Capacity concurrency model + tests (Section 9).
7. Frozen-file post-hashes + byte comparison + explicit unchanged/changed
   report (Section 4).
8. Phase 18 closeout stating the concurrency/capacity consistency model
   (Section 29).

## 3. Pre-implementation solver-input trace

**Before writing any Hall/Bench code, trace the complete current generation
input path.** Do not assume Hall/Bench integration is hypothetical.

Inspect `src/services/solverInput.service.ts` (and the callers that consume its
output: `src/phase4/generation.service.ts`, `src/phase4/integration.ts`,
`src/phase4/solverClient.ts`) and determine:

1. What represents the current seat set?
2. Where does seat capacity come from?
3. Where do seat labels/positions come from?
4. Is the input schema-backed, derived, hardcoded, synthetic, or mocked?
5. Which database models currently supply it?
6. Which Phase 4/10/11 tests prove the current behavior?
7. Does the current generator already consume Hall/Bench data?
8. If not, identify exactly where the integration boundary must change.

**Classification requirement:** explicitly classify the current solver input
as one of: schema-backed, derived, hardcoded, synthetic, or mocked — with
code-path evidence.

**Confirmed integration requirement:** if the current solver input is
synthetic or hardcoded, classify that as a **confirmed Phase 18 integration
requirement** before implementing Hall/Bench CRUD, and state the exact
integration boundary that must change (file, function, and data shape).

Record the full findings in a new evidence file
`docs/evidence/phase18/phase18-solver-input-trace.md`. This is produced before
any implementation.

### Ground-truth note (verify, do not assume)

The repo currently builds solver input from the `Hall` and `HallSeat` tables:
active halls, active seats ordered by row/column, capacity computed as
`seats.length` per hall, summed into `availableSeatCount`. The `Hall` model
carries `rows`/`columns` plus a `HallSeat` child set with
`@@unique([hallId, seatPosition])`. `SeatAssignment` references `hallId` and
`hallSeatId`. There is no `Bench` model today. Confirm these facts by reading
the code before relying on them.

## 4. Frozen solver files — byte-for-byte verification

The six frozen solver files are immutable:

1. `solver-service/app/seatlabel.py`
2. `solver-service/app/solver.py`
3. `solver-service/app/graph.py`
4. `solver-service/app/partition.py`
5. `solver-service/app/guards.py`
6. `solver-service/app/validation.py`

**Before implementation:**

- record SHA-256 of all six frozen solver files

**After implementation:**

- record SHA-256 again
- compare byte-for-byte
- explicitly report unchanged/changed

Write the results to a new evidence file `phase18-frozen-file-verification.log`
under `docs/evidence/phase18/`. The log must explicitly state, for each of the
six files, whether it remained unchanged, and conclude with a line for all six.

Passing tests alone is NOT evidence that the frozen solver files remained
unchanged.

## 5. Repository safety

- Do NOT modify any file under `solver-service/`.
- Do NOT modify the verified seating/PDF/auth backbone outside the Hall/Bench
  surface.
- No dependency upgrades.
- No unrelated refactoring; record any tempting refactor as a future-phase
  note instead.
- No destructive git commands: never run `git reset --hard`, `git clean -fd`,
  `git checkout .`, or `git restore .`.
- No commit. No push. (See Section 24.)
- Do not truncate or destructively edit existing `docs/evidence/` content;
  add Phase 18 evidence alongside it.

## 6. Existing schema inspection

Inspect `prisma/schema.prisma` models `Hall`, `HallSeat`, and `SeatAssignment`
before designing the Bench domain. Record:

- current Hall/HallSeat semantics and constraints
- how `SeatAssignment` references halls and seats
- how the seed (`prisma/seed.ts`) and the E2E seed (`scripts/e2e/seed.mjs`)
  create halls and seats today
- which existing tests cover Hall/HallSeat behavior
  (`tests/hall.test.ts`, `tests/seat-assignment.test.ts`)

This inspection feeds the Bench-domain design and the solver-input trace.

## 7. Hall domain

Preserve and, where needed, complete the Hall domain:

- Hall has a unique `hallNumber`, name, optional building, `rows`/`columns`
  dimensions, and an active flag.
- Halls expose a seat set (`HallSeat`) and derived capacity from active seats.
- Hall CRUD must keep every existing constraint that the seating engine and
  tests depend on (active-hall/active-seat filtering in solver input, seat
  assignment references, no-hard-delete policy).

New Hall writes must not orphan or invalidate existing `SeatAssignment` rows.

## 8. Bench domain

Introduce the Bench domain as the physical, position-bearing unit inside a
hall. Design decisions must be grounded in the Section 3 trace and the Section
6 inspection. At minimum, specify:

- the Bench model (or equivalent) and its relationship to `Hall` and
  `HallSeat`
- whether a bench replaces or coexists with the `HallSeat` row/column grid
- how bench seats map to the `seatPosition`/`row`/`column` shape the solver
  input and `SeatAssignment` consume
- how the seed and E2E seed must change to create benches
- migration plan (Section 21)

The Bench design must be chosen so that the generation pipeline's actual input
shape (Section 3) continues to be produced correctly after the change.

## 9. Hall capacity — concurrency-consistency model

Determine whether hall capacity is:

1. derived from benches at read/generation time,
2. transactionally recalculated,
3. cached and synchronized,
4. or independently stored.

If capacity is derived, prefer deriving it from the authoritative bench state
rather than maintaining a separately synchronized cached value.

If capacity is stored, prove that concurrent bench mutations cannot leave
hall capacity inconsistent.

Explicitly test or reason about concurrent edits to different benches in the
same hall.

The Phase 18 closeout MUST state the concurrency/capacity consistency model
chosen and why it is safe.

## 10. Hall CRUD

Implement Hall CRUD:

- `POST /exam-seating/halls` — create a hall (admin-only)
- `GET /exam-seating/halls` — list halls (authenticated), including capacity
  and bench summary
- `GET /exam-seating/halls/:id` — get a hall with its benches/seats
- `PATCH /exam-seating/halls/:id` — update hall metadata (admin-only)
- No hard delete; hall lifecycle uses the active flag, consistent with the
  existing no-hard-delete policy.

Duplicate `hallNumber` → 409 `HALL_ALREADY_EXISTS`. Unknown hall → 404
`HALL_NOT_FOUND`. Invalid input → 400 `INVALID_INPUT`. Invalid pagination →
400 `INVALID_PAGINATION`. Unknown route → 404.

## 11. Bench management

Implement bench management under a hall:

- `POST /exam-seating/halls/:hallId/benches` — create a bench (admin-only)
- `GET /exam-seating/halls/:hallId/benches` — list benches for a hall
  (authenticated)
- `PATCH /exam-seating/benches/:id` — update a bench (admin-only)
- No hard delete; bench lifecycle uses an active/decommissioned flag,
  consistent with the no-hard-delete policy.

Bench mutations must be safe under the capacity model chosen in Section 9.

## 12. Positioning

Positioning rules for benches and their seats:

- every bench position is expressed in the existing seat shape
  (`seatPosition`, `row`, `column`) so the solver input and
  `SeatAssignment` contracts remain valid
- positions must validate against the hall's dimensions/grid where the hall
  grid remains authoritative
- a bench's seats must be assignable through the existing `HallSeat`
  reference in `SeatAssignment`

## 13. Validation

- Hall number format validation (non-empty, bounded length, allowed
  characters), mirroring the department-code validation pattern in
  `src/services/department.service.ts`.
- Bench name/position validation.
- Capacity/position consistency validation: bench seat count and positions
  must be coherent with the hall and with the capacity model (Section 9).
- All validation errors map to sanitized HTTP errors (Section 10 codes) with
  no internal details leaked.

## 14. RBAC

- Authenticated users (`requireAuth`): read halls, read benches, read
  hall/bench lists.
- Administrators (`requireAdmin`): create, update halls and benches.
- STAFF must receive 403 on every Hall/Bench write.
- Unauthenticated requests receive 401.
- The frontend must hide Hall/Bench admin controls from STAFF, consistent
  with the existing `RequireAuth`/`RequireAdmin` guards.

## 15. Audit

Add the required `AuditAction` enum values for Hall/Bench events (e.g.
`HALL_CREATED`, `HALL_UPDATED`, `BENCH_CREATED`, `BENCH_UPDATED`,
`BENCH_DEACTIVATED`) via a hand-authored migration (7-style `ALTER TYPE ...
ADD VALUE`, mirroring
`prisma/migrations/20260818000000_add_student_master_audit_actions/`).

Every Hall/Bench write records an audit row with the acting user via
`src/services/audit.service.ts` (`logAudit`), with `entityType` and `entityId`
set, and minimal metadata. Audit rows must remain readable by the existing
Phase 16 audit-read surface.

## 16. Seating-engine integration

Based on the Section 3 trace, integrate (or explicitly leave intact) the
Hall/Bench data with the generation pipeline:

- if the trace proved the current input is already schema-backed from
  Hall/HallSeat, ensure the Bench change keeps that contract intact and
  correctly sourced
- if the trace proved the current input is synthetic/hardcoded, implement the
  confirmed integration requirement so the solver input is sourced from the
  authoritative Hall/Bench state

The integration must be demonstrated by tests that prove solver input is
built from real Hall/Bench data (not mocks).

## 17. CP-SAT protection

- The six frozen solver files must remain byte-for-byte unchanged (Section 4).
- Solver invocation must continue to go through the existing HTTP boundary
  (`src/phase4/solverClient.ts`) with the internal token, never by importing
  solver code into the Node process.
- No change to the solver request/response contract
  (`/solve`, `/solve-domain`, `/health`).

## 18. Generation capacity validation

Verify that generation capacity validation still holds with the Hall/Bench
change:

- solver input `availableSeatCount` is computed from the authoritative bench
  state per Section 9
- pre-dispatch capacity guards (the `INSUFFICIENT_CAPACITY` behavior proven in
  Phase 4 benchmarks) still fire correctly
- the Phase 4/10/11 generation tests that cover capacity behavior must pass
  unchanged or be updated only where the trace (Section 3) requires it, with
  the update documented

## 19. Historical-data safety

- Existing published/approved seating plans and their `SeatAssignment` rows
  must remain readable and unaltered.
- Existing halls/seats referenced by historical assignments must not be
  hard-deleted.
- The no-hard-delete RDBMS triggers must remain in force (do not weaken or
  remove them).
- Snapshot immutability rules for candidates in PUBLISHED plans must remain
  intact.

## 20. API surface

Full route inventory for Phase 18 (all under `/exam-seating`):

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/halls` | ADMIN | create hall |
| GET | `/halls` | auth | list halls |
| GET | `/halls/:id` | auth | get hall + benches/seats |
| PATCH | `/halls/:id` | ADMIN | update hall |
| POST | `/halls/:hallId/benches` | ADMIN | create bench |
| GET | `/halls/:hallId/benches` | auth | list benches |
| PATCH | `/benches/:id` | ADMIN | update bench |

Response shapes must follow the existing `json(res, status, body)` convention
in `src/phase4/api.ts`, with wrapped objects (`{ hall }`, `{ halls }`,
`{ bench }`, `{ benches }`) and pagination mirroring the students surface
(limit/offset, `INVALID_PAGINATION`).

## 21. Migrations

- Hand-author one migration for the schema change (Bench + any Hall changes +
  AuditAction additions), following the existing migration naming and style.
- `prisma validate` and `prisma generate` must pass.
- The migration must be applied to the test database before tests run
  (`scripts/run-tests.mjs` / `run-one-test.mjs` flows) and to the E2E Docker
  database via `prisma migrate deploy` in `scripts/e2e/run-e2e.mjs`.
- No destructive migration steps; no data loss for existing halls/seats/
  assignments.

## 22. Frontend Hall Management

- Add a Hall Management page (STAFF/ADMIN read; ADMIN write) with:
  - hall list (name, number, building, capacity, bench count, active status)
  - hall create/edit form (admin-only)
  - per-hall bench list with capacity and position summary
  - bench create/edit form (admin-only)
  - loading/empty/error+Retry states and success/danger notices matching the
    StudentsPage patterns
- Route + nav wiring in `frontend/src/App.tsx` and `frontend/src/components/
  Layout.tsx`, consistent with the existing "Students" pattern.
- Client API + types in `frontend/src/lib/api.ts` and
  `frontend/src/lib/types.ts` with tests in `frontend/src/lib/api.test.ts`.

## 23. Hall/Bench UI

- Follow the existing component conventions (`panel`, `audit-filters`,
  `table-wrap`, `status-badge`, `form-actions`, `field`) and error-mapping
  helpers (safe-error functions mapping API codes to user messages).
- Admin-only controls are hidden from STAFF; STAFF sees read-only hall/bench
  views.
- Forms validate client-side before submit and surface backend errors
  (duplicate hall number, invalid positions) without leaking internals.

## 24. Tests

### Backend

- New test file(s), e.g. `tests/phase18-hall-bench.test.ts`, covering:
  - RBAC 401/403 for every route
  - hall CRUD + duplicate/404/400/`INVALID_PAGINATION`
  - bench CRUD + duplicate-position rule (Section 12/Section 26) + 404/400
  - audit rows for every write
  - capacity derivation/consistency per Section 9
  - concurrent edits to different benches in the same hall (per Section 9)
  - solver input is built from real Hall/Bench state (proves integration)
  - generation capacity validation still fires
- Run via `scripts/run-one-test.mjs` and the full `scripts/run-tests.mjs`
  against the Supabase `exam_seating_test` database (guard-verified).

### Frontend

- Component tests for the Hall Management page and form (create, edit,
  validation errors, RBAC-visibility) following `StudentsPage.test.tsx`
  conventions.
- Client API/type tests in `api.test.ts`.
- All 127 existing frontend tests must still pass.

## 25. E2E

- Add `e2e/specs/hall-bench.spec.ts` following `e2e/specs/students.spec.ts`
  conventions: STAFF reads hall/bench but cannot write; ADMIN creates a hall,
  adds benches, verifies capacity and positions in the real browser; API-level
  401/403/200 checks; duplicate-hall 409.
- Update `scripts/e2e/seed.mjs` if the Hall/Bench domain changes the seed
  shape.
- Run the full gate via `node scripts/e2e/run-e2e.mjs` against the fresh local
  Docker `exam_seating_e2e_test` database with scrubbed env.
- All 17 existing E2E tests must still pass.

## 26. Duplicate bench positions

Duplicate bench positions within the same hall are forbidden.

This is a hard invariant unless the Section 3 inspection finds explicit
repository evidence that the domain intentionally supports shared/paired
positions.

If shared positions are found to be intentional, document:

- the model semantics
- the solver semantics
- the relevant existing tests
- why duplicate positions are safe

Do not silently relax this invariant.

## 27. Test database safety

- Backend tests run only against the guard-verified `exam_seating_test`
  database (the `tests/helpers.ts` guard that requires the DB name to contain
  `exam_seating_test`).
- E2E runs only against the fresh local Docker `exam_seating_e2e_test`
  database with scrubbed env (no Supabase credentials).
- Never run migrations, seeds, or tests against a production/development
  database.
- The RDBMS hard-delete guards and truncation-reset behavior in
  `tests/setup.ts` must remain respected; tests must not hard-delete
  protected rows.

## 28. Performance / N+1

- Hall list and bench list must not exhibit N+1 queries: use Prisma `include`
  / `select` with relation joins, and pagination, mirroring
  `src/services/student.service.ts`.
- Capacity must not require a per-hall query loop; derive it in the same
  query or via an aggregation consistent with Section 9.
- Record the query plan or an explicit note in the evidence if a large-hall
  case is exercised (e.g. 1000 seats) and confirm no regression vs the
  Phase 4 benchmark expectations.

## 29. Evidence

Create `docs/evidence/phase18/` with at least:

- `phase18-provenance.md` (Section 2)
- `phase18-solver-input-trace.md` (Section 3)
- `phase18-frozen-file-verification.log` (Section 4)
- `phase18-schema-inspection.md` (Section 6)
- `phase18-capacity-model.md` (Section 9 — states the concurrency/capacity
  consistency model)
- `phase18-backend-tests.log` (Section 24)
- `phase18-frontend-tests.log`, `phase18-frontend-typecheck.log`,
  `phase18-frontend-build.log`
- `phase18-full-test.log` (full backend suite via `run-tests.mjs`)
- `phase18-e2e.log` (full E2E gate)
- `phase18-git-status.log`, `phase18-git-diff-stat.log`,
  `phase18-git-log.log`, `phase18-git-diff-name-only.log`
- `phase18-closeout.md` (Section 30)

All evidence must be captured with the actual tool output, not paraphrased.

## 30. Verification gates

| Gate | Required result |
|---|---|
| Root typecheck (`npx tsc --noEmit`) | PASS |
| `prisma validate` / `prisma generate` | PASS |
| New Phase 18 backend tests (isolated) | PASS |
| Full backend suite (`run-tests.mjs`) | All pass except documented pre-existing flaky cases |
| Frontend typecheck (`tsc -b`) | PASS |
| Frontend tests | All 127 existing + new PASS |
| Frontend production build | PASS |
| E2E Playwright (`run-e2e.mjs`) | All 17 existing + new PASS |
| Frozen-file verification (`phase18-frozen-file-verification.log`) | All six files explicitly UNCHANGED |
| Git state | No commit, no push |

## 31. Git rules

- NO COMMIT. NO PUSH. (Unless explicitly instructed otherwise by the user.)
- No destructive git commands (`git reset --hard`, `git clean -fd`,
  `git checkout .`, `git restore .`).
- Keep Phase 18 files separable from pre-existing uncommitted work in the
  closeout report (list new vs modified vs pre-existing).

## 32. Scope boundaries

In scope:

- Hall CRUD, Bench CRUD, capacity, positioning, validation, RBAC, audit
- solver-input trace and, if confirmed, the integration boundary change
- frontend Hall Management + Hall/Bench UI
- tests, E2E, evidence, migrations, verification

Out of scope (record as future-phase notes):

- gender seating, seating PDF download, CP-SAT/solver changes
- PDF parser redesign, auth/RBAC/RLS redesign, multi-tenancy
- Hall/bench import/export tooling
- any change to the six frozen solver files
- unrelated refactoring

## 33. Stop conditions

Stop and report to the user (do not silently continue) if any of the
following occurs:

- the Section 3 trace reveals the solver input is synthetic/hardcoded AND the
  integration requirement cannot be implemented without touching a frozen
  solver file or the verified backbone
- the frozen-file verification detects any change to the six files
- a destructive action against the test/e2e database is required
- the capacity concurrency model cannot be made safe without a schema change
  that risks existing assignments
- a task takes more than one session and the session is about to exceed the
  tool time limits — checkpoint and summarize before continuing

## 34. Acceptance criteria

Phase 18 is complete when all of the following hold:

1. The solver-input trace (Section 3) is documented with the current input
   classified and, if synthetic/hardcoded, the integration requirement
   confirmed and implemented.
2. All six frozen solver files are byte-for-byte unchanged, proven by
   `phase18-frozen-file-verification.log`.
3. Hall CRUD and Bench CRUD exist with correct RBAC, audit, validation, and
   error codes.
4. Duplicate bench positions are forbidden (or the intentional shared-position
   case is documented with model/solver/test evidence).
5. Hall capacity has an explicit, tested concurrency-consistency model.
6. Concurrent edits to different benches in the same hall are tested or
   rigorously verified per the chosen model.
7. Phase 17 provenance is established via raw filesystem/script evidence, and
   the `student.service.ts` coverage question is answered (recording
   `PHASE 17 TEST-COVERAGE GAP` if applicable).
8. Solver input is sourced from real Hall/Bench state (or the trace proves it
   already is, unchanged).
9. Historical plans/assignments and the no-hard-delete policy are intact.
10. Backend, frontend, and E2E gates (Section 30) are green.
11. Evidence is captured under `docs/evidence/phase18/`.

## 35. Final closeout

Write `docs/evidence/phase18/phase18-closeout.md` that includes:

- the solver-input trace conclusion and integration classification
- the frozen-file verification result (all six files unchanged/changed)
- the concurrency/capacity consistency model
- the duplicate-position decision and its evidence
- the Phase 17 provenance conclusion and the `student.service.ts` coverage
  determination
- every verification gate result (Section 30)
- the git-state summary (no commit, no push) with new/modified/pre-existing
  file separation
- any future-phase notes

The closeout MUST end with:

```text
PHASE 18 — COMPLETE
```

Only emit that status after Sections 2–35 requirements are done, all gates
green, and the frozen-file verification explicitly reports the six files
unchanged.