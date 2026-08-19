# Phase 18 — Existing Schema Inspection & Bench-Domain Design

Date: 2026-08-19 (pre-implementation, pre-migration)

## Scope

Inspection of the current Hall/HallSeat/SeatAssignment domain and the full
generation input path, followed by a concrete Bench-domain design that
preserves every existing contract. No code or migration was modified.

Files inspected:

- `prisma/schema.prisma`
- `src/services/hall.service.ts`
- `src/services/solverInput.service.ts`
- `src/services/seatAssignment.service.ts`
- `src/phase4/integration.ts`
- `src/phase4/generation.service.ts`
- `src/phase4/persist.ts`
- `tests/hall.test.ts`
- `tests/seat-assignment.test.ts`
- `tests/fixtures.ts`
- `prisma/seed.ts`
- `scripts/e2e/seed.mjs`
- `prisma/migrations/20260812132538_init/migration.sql` (no-hard-delete triggers)

---

## 1. Current Hall model (`Hall`, table `halls`)

```prisma
model Hall {
  id         String        @id @default(uuid()) @map("id")
  hallNumber String        @unique @map("hall_number")
  name       String        @map("name")
  building   String?       @map("building")
  rows       Int           @map("rows")
  columns    Int           @map("columns")
  isActive   Boolean       @default(true) @map("is_active")
  createdAt  DateTime      @default(now()) @map("created_at")
  updatedAt  DateTime      @updatedAt @map("updated_at")
  seats          HallSeat[]
  seatAssignments SeatAssignment[]
  @@map("halls")
}
```

Key facts:

- `hallNumber` is globally unique. `rows`/`columns` are stored `Int` fields.
- Capacity is **not** stored on Hall. `rows * columns` is a *declared* grid
  used to materialize seats at creation, but capacity is always derived from
  active `HallSeat` rows (see §4).
- `isActive` filters halls out of `buildSolverInput` (`isActive: true`).

## 2. Current HallSeat model (`HallSeat`, table `hall_seats`)

```prisma
model HallSeat {
  id           String    @id @default(uuid()) @map("id")
  hallId       String    @map("hall_id")
  seatPosition String    @map("seat_position")
  row          String    @map("row")
  column       Int       @map("column")
  isActive     Boolean   @default(true) @map("is_active")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  hall            Hall             @relation(fields: [hallId], references: [id])
  seatAssignments SeatAssignment[]

  @@index([hallId])
  @@index([isActive])
  @@unique([hallId, seatPosition])
  @@map("hall_seats")
}
```

Key facts:

- `@@unique([hallId, seatPosition])` is the seat identity invariant — a
  seatPosition is unique within a hall. This must be preserved.
- `row` is a string letter (`"A"`), `column` is a 1-based int (`1..n`).
- Capacity/input selection is driven entirely by `isActive`.

## 3. Hall rows/columns semantics

- `seatPositionsFor(rows, columns)` (hall.service.ts:12-25) materializes a
  grid: row letters `A`, `B`, ... and columns `1..columns`, producing
  `seatPosition` strings like `A1`. `createHall` writes those rows inside one
  transaction.
- `rows`/`columns` are shipped to the solver as metadata (`SolverHall.rows/
  columns`, `DomainHall.rows/columns`) via `solverInputToDomains` and
  `buildDomainPayload`. They are authoritative declarations of the hall grid;
  they are NOT used to compute capacity anywhere in the pipeline.

## 4. HallSeat position semantics and active/deactivation semantics

- `setHallSeatActive(hallId, seatPosition, isActive)` (hall.service.ts:65-75)
  flips `isActive`. Seats are never destroyed — deactivation is the
  decommission mechanism and preserves the seat row for history.
- `deriveHallCapacity(hallId)` = `hallSeat.count({ hallId, isActive: true })`
  (hall.service.ts:53-55). `buildSolverInput` (solverInput.service.ts:55-71)
  selects active halls with only active seats and computes
  `capacity = seats.length` per hall, summed into `availableSeatCount`.
- **Single source of truth for capacity = the active `HallSeat` rows.**

## 5. SeatAssignment foreign keys and historical-data constraints

```prisma
model SeatAssignment {
  seatingPlanId   String        @map("seating_plan_id")
  examCandidateId String        @map("exam_candidate_id")
  hallId          String        @map("hall_id")
  hallSeatId      String        @map("hall_seat_id")
  ...
  @@unique([seatingPlanId, examCandidateId])
  @@unique([seatingPlanId, hallId, hallSeatId])
}
```

- `hallId` and `hallSeatId` are **required, non-nullable** FKs. Every
  assignment points at a concrete `HallSeat` row.
- Historical accuracy depends on the referenced `HallSeat` row keeping its
  `id`, `seatPosition`, `row`, `column`, and `hallId` stable forever
  (`seat-assignment.test.ts:100-120` asserts this exact property after a plan
  is published). Therefore HallSeat rows may be deactivated but **never
  re-purposed or deleted**.
- `assignCandidateSeat` (seatAssignment.service.ts:26-33) validates that the
  `hallSeat.hallId` matches the assignment `hallId` — a cross-hall invariant
  that must keep holding.

## 6. Existing no-hard-delete protections

From `20260812132538_init/migration.sql`:

- `es_protect_hard_delete()` triggers exist on: `exams`, `exam_candidates`,
  `seating_plans`, `seat_assignments`, `uploaded_exam_documents`,
  `solve_jobs`.
- `students` have their own conditional guard (blocked once exam history
  exists).
- `halls`/`hall_seats` currently have **no** delete trigger; they are
  protected indirectly — the `seat_assignments → hall_seats` FK (Restrict)
  blocks deletion of any referenced seat, and `seat_assignments → halls` does
  the same for halls. The intended decommission path is `isActive = false`.

## 7. How Hall/HallSeat are created in seeds

- `prisma/seed.ts:91-121`: idempotent upsert of `LH09` (5 rows × 5 columns),
  then per-seat upsert keyed on `hallId_seatPosition` for `A1..E5`, forcing
  `isActive: true` on update.
- `scripts/e2e/seed.mjs:49`: calls `seedDatabase(prisma)` directly, so the
  E2E database gets the identical LH09 hall + seats, then adds exams/users.
- `tests/fixtures.ts:72-76`: `seededHall()` reads `LH09` from the seed.

## 8. How existing tests expect Hall/HallSeat to behave

- `tests/hall.test.ts`:
  - `createHall` materializes seats matching `rows × columns` (12 for 4×3),
    seatPositions `A1..`, unique set, and **no stored `capacity` column**.
  - Duplicate `seatPosition` within a hall → unique violation.
  - Capacity derived from active HallSeat only; inactive seats excluded
    (25 → 22 after 3 deactivated; 8 of 9 active after 1 deactivated).
  - Active seats are the exact set the solver input builder consumes.
- `tests/seat-assignment.test.ts`: assigns via `hallId` + `hallSeatId`;
  duplicate (candidate, plan) and (plan, hall, seat) rejected; historical
  placement preserved post-publish.
- `tests/phase10-plan-read.test.ts`, `tests/phase4-*.test.ts`,
  `tests/candidate.test.ts`: all rely on the same Hall/HallSeat shape and
  derive capacity from active seat rows.

## 9. Can HallSeat safely gain a `benchId`?

**Yes — a nullable `benchId` column is purely additive and non-breaking:**

- Existing rows get `NULL` — no data migration, benches remain optional.
- `@@unique([hallId, seatPosition])` is untouched.
- `buildSolverInput`'s seat `select` (id/seatPosition/row/column) does not
  include `benchId`, so the solver contract is byte-identical.
- `assignCandidateSeat`, `persist.ts`, `partition.ts`, `generation.service.ts`
  never touch `benchId`.
- Existing tests pass unchanged because they neither select nor populate
  `benchId`.

## 10. Can a new Bench model coexist with HallSeat without breaking contracts?

**Yes.** A `Bench` parent model grouping `HallSeat` rows:

- `Hall` gains `benches Bench[]`; `HallSeat` gains `benchId` + `bench`; the
  new `benches` table is additive.
- None of the existing reads (`buildSolverInput`, `solverInputToDomains`,
  `buildDomainPayload`, `SEATING_PLAN_INCLUDE`, `listAssignments`) touch the
  bench relation, so existing tests and the frozen-solver payload shape are
  unaffected.
- Benches sit **above** the authoritative seat set; they never replace it.

## 11. How bench positions map to row/column/seatPosition

- `HallSeat.seatPosition`/`row`/`column` remain the **authoritative positional
  encoding** and are unchanged.
- A `Bench` carries `benchNumber` (e.g. `"B1"`, `"B2"`) unique within its
  hall, plus optional display attributes. A bench groups existing seats
  (e.g. one row, or a set of paired desks); it does not introduce a competing
  coordinate system.
- Because each HallSeat keeps its own row/column, historical assignments stay
  exact even if a seat is later re-grouped into a different bench.

## 12. How bench capacity is represented

- **Not stored.** Bench capacity is derived = count of that bench's active
  `HallSeat` rows:
  `prisma.hallSeat.count({ where: { benchId, isActive: true } })` — mirroring
  `deriveHallCapacity`. This keeps active HallSeat rows the single source of
  truth for every capacity value in the system.

## 13. Whether capacity remains derived exclusively from active HallSeat records

**Yes.** Hall capacity, bench capacity, and `availableSeatCount` are all
derived at read/generation time from active `HallSeat` rows. No stored or
cached capacity is introduced anywhere. `buildSolverInput` is unchanged and
never consults benches.

## 14. How concurrent bench mutations remain safe

- No stored aggregates exist, so there is nothing to desynchronize. Each
  mutation is a single-row `UPDATE hall_seats SET bench_id = X WHERE id = ...`
  which is atomic, and capacity reads run in their own transaction snapshot.
- `createHall`/`createBench` materializations run in one transaction.
- Bench decommission = a transaction that sets `isActive = false` on the
  bench's member HallSeat rows (soft decommission), matching today's seat
  semantics. Concurrently issued generations re-read active seats, so they
  never observe a half-applied decommission (each read is a snapshot).
- The full concurrency-consistency model will be recorded in
  `phase18-capacity-model.md` during implementation (spec Section 9).

## 15. How inactive/decommissioned benches affect HallSeat and solver input

- Decommissioning a bench deactivates its member HallSeat rows. Those seats
  drop out of `buildSolverInput` and capacity exactly as today's individual
  seat deactivation does — the solver input contract is preserved verbatim.
- Seats are not deleted, so `SeatAssignment` history (which references the
  HallSeat rows, not benches) remains fully valid.
- Because the solver input never reads benches, a bench flagged inactive
  without touching seats would have zero effect on generation; the defined
  behavior is therefore to deactivate member seats so the operational
  meaning ("this bench is not usable") is reflected in capacity.

## 16. Whether existing Hall rows/columns remain authoritative

**Yes, unchanged.** `Hall.rows`/`columns` remain the declared grid metadata
and continue to be shipped to the solver. Active `HallSeat` rows remain the
authoritative seat/capacity source. Benches add a management grouping layer
on top; they do not alter Hall's or HallSeat's role.

## 17. Historical-data / destructive-change check

**No blocker found.** The entire proposed change is additive:

- New table `benches`.
- New nullable column `hall_seats.bench_id` + index.
- New relation `hall.benches`.
- No existing column, constraint, or index is modified or dropped.
- `seat_assignments` and every referenced `hall_seats`/`halls` row are
  untouched; `@@unique([hallId, seatPosition])` and the FK structure are
  preserved. No `SeatAssignment` record is invalidated.

---

## Concrete Bench-domain recommendation

Introduce a **`Bench` management layer** above the existing authoritative
seat set.

### Proposed schema delta (to be applied ONLY in the implementation phase)

```prisma
model Bench {
  id          String   @id @default(uuid()) @map("id")
  hallId      String   @map("hall_id")
  benchNumber String   @map("bench_number")
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  hall        Hall     @relation(fields: [hallId], references: [id])
  seats       HallSeat[]

  @@unique([hallId, benchNumber])
  @@index([hallId])
  @@map("benches")
}
```

HallSeat delta:

```prisma
  benchId String? @map("bench_id")
  bench   Bench?  @relation(fields: [benchId], references: [id])
  @@index([benchId])
```

Hall delta:

```prisma
  benches Bench[]
```

### Why this preserves the existing solver contract

`buildSolverInput`, `solverInputToDomains`, `buildDomainPayload`, `partition`,
`persist`, and `assignCandidateSeat` operate exclusively on `Hall` +
`HallSeat` and do not read `benchId`/`Bench`. The frozen solver payload shape
(`SolverHall`/`DomainHall` with `seats: {id, seatPosition, row, column}` and
derived `capacity`) is produced by identical queries. Benches are invisible
to generation.

### How Bench maps to HallSeat

`Bench.seats` = the set of `HallSeat` rows whose `benchId` references the
bench, all within one hall (`bench.hallId`), validated at service level. Each
seat keeps its own `row`/`column`/`seatPosition`.

### How existing SeatAssignment history remains valid

Assignments reference `hallId` + `hallSeatId` only. Benches never appear in
`SeatAssignment`; decommissioning a bench only flips `isActive` on its seats,
and seats are never deleted or re-positioned, so all published-plan history
stays exact.

### How capacity remains single-source-of-truth

All capacity (hall, bench, and `availableSeatCount`) is derived at read time
from active `HallSeat` rows. No capacity column is added to any table.

### How duplicate bench positions are prevented

`@@unique([hallId, benchNumber])` forbids two benches with the same
`benchNumber` in the same hall. No evidence of intentionally shared/paired
bench positions exists in the current domain, so the strict uniqueness rule
applies. A bench can still hold multiple seats (two per paired desk is
expressed as two distinct HallSeat rows, each with its own `seatPosition`).

### How concurrent bench edits are handled

No stored aggregates → no desync risk. Single-row atomic updates; bench
creation and decommission run in transactions; capacity readers use snapshot
reads. Full model documented in `phase18-capacity-model.md`.

### How seeds and E2E fixtures will migrate

- `prisma/seed.ts`: after upserting LH09 and its seats, upsert benches
  (`upsert` keyed on `hallId_benchNumber`), then set `benchId` on the seats
  (`update` branch includes `benchId`). Fully idempotent for re-runs.
- `scripts/e2e/seed.mjs`: unchanged — it delegates to `seedDatabase`.
- Optional: add a second seeded hall with benches for E2E coverage of
  multi-bench generation. Existing tests that use `seededHall()` are
  unaffected.

### Exact schema changes required (implementation phase)

1. Add `Bench` model (table `benches`) with `@@unique([hallId, benchNumber])`
   and `@@index([hallId])`.
2. Add `benchId String?` + `bench` relation to `HallSeat` plus
   `@@index([benchId])`.
3. Add `benches Bench[]` to `Hall`.
4. Add the same `es_protect_hard_delete` trigger on `benches` for consistency
   with the operational no-hard-delete policy (decommission = `isActive
   = false`).
5. `npx prisma migrate dev --name add_bench` (additive ALTER) + `npx prisma
   generate`.
6. Add `createBench`/`setBenchActive`/`deriveBenchCapacity` services mirroring
   `hall.service.ts`; optionally `createHall` gains a `benches` input.
7. Frontend Hall Management UI (bench CRUD + seat-to-bench assignment).
8. Backend + frontend tests, E2E, frozen-file post-verification, full gates,
   closeout per Phase 18 spec Sections 2-35.

### Verification gate before implementation

This document does **not** modify `prisma/schema.prisma`, any migration, any
application source, or any frozen solver file. A migration will only be
created during the implementation phase, after this design checkpoint is
accepted.