# Phase 18 — Pre-Commit Audit

Date: 2026-08-19 (post-implementation, pre-commit)

Four verification checks only. No application-architecture change, no Phase 19.

---

## 1. Skipped backend tests

### Exact skipped tests

`tests/storage-integration.test.ts` (1 file, 3 tests — `describe.skip`):

1. "stores, downloads, verifies SHA-256, signed-URLs and removes a test object"
2. "does not expose the uploaded PDF through an anonymous public URL"
3. "cleans up the test object even when an assertion fails mid-test"

### Skip reason (exact)

`storage-integration.test.ts:10-19` resolves the mode via
`resolveStorageIntegrationMode` (`src/services/exam-document/
storage-integration.ts`):

```text
if (config.storageIntegration !== "1") {
  return { mode: "skip", reason:
    "STORAGE_INTEGRATION is not '1', so the real Supabase Storage integration
     suite is skipped. No live bucket access happens during the normal test run." };
}
```

`describeImpl = decision.mode === "skip" ? describe.skip : describe;`

The normal test run does not set `STORAGE_INTEGRATION=1`, so the whole
`describe` block is skipped at collection. When `STORAGE_INTEGRATION=1` is
explicitly set, the suite either **runs** (config present) or **fails closed**
(required Supabase config missing — `mode: "fail"` in `beforeAll`). It never
silently falls back to the in-memory store.

### Are they environment-gated / intentional?

**Yes — fully intentional, fail-closed environment gate.** The suite targets a
real private Supabase Storage bucket (`SupabaseDocumentStore`) and is
deliberately excluded from normal runs so no live bucket access happens during
CI/dev. `STORAGE_INTEGRATION` is never persisted in `.env` (documented in the
module header).

### Do they test Phase 18 functionality?

**No.** They exercise `src/services/exam-document/upload.ts` +
`src/supabase.ts` (PDF object put/get/exists/metadata/signedUrl, public-URL
privacy, cleanup-on-assertion-failure). None of the touched modules reference
Hall, Bench, HallSeat, capacity, reassignment, generation, or SeatAssignment.
Phase 18 changed none of these modules.

### Required for the Phase 18 acceptance gate?

**No.** The Phase 18 gate is: `bench.test.ts` 14/14 + `hall.test.ts` 6/6 +
`deletion.test.ts` 8/8 (isolated) and the full-suite run (30 files passed;
the 3-skipped file is this env-gated live-storage suite). This skip count is
identical to the pre-Phase-18 baseline — Phase 18 added no new skips.

### Could they hide a Phase 18 regression?

**No.** They share no code path with Phase 18 (document storage vs.
Hall/Bench/seat domain). A Phase 18 regression would surface in the other 237
tests and the 21 E2E tests, which all pass.

### Classification

**INTENTIONAL / NON-BLOCKING** — environment-gated live Supabase Storage
integration tests, unrelated to Phase 18. Not enabled or rewritten (per audit
instructions).

---

## 2. HallSeat capacity indexing

### Current schema indexes (HallSeat)

`prisma/schema.prisma` (HallSeat model):

```prisma
@@index([hallId])
@@index([benchId])
@@index([isActive])
@@unique([hallId, seatPosition])
```

Materialized as: `hall_seats_hall_id_idx`, `hall_seats_bench_id_idx`
(created in `20260819144738_add_bench`), `hall_seats_is_active_idx`
(created in `20260812132538_init`), and the
`hall_seats_hall_id_seat_position_key` unique index.

### Relevant capacity queries

```sql
-- deriveHallCapacity (hall.service.ts):  count WHERE hallId = ? AND isActive = true
-- deriveBenchCapacity (bench.service.ts): count WHERE benchId = ? AND isActive = true
-- buildSolverInput (solverInput.service.ts): seats WHERE hallId = ? AND isActive = true
-- serializeHall unassignedSeats (api.ts):   seats WHERE benchId IS NULL
```

### Is a compound index `(hallId, isActive)` required?

**No.** Rationale:

- The `[hallId]` index narrows the capacity/count query to a single hall's
  seat set. A hall is a materialized `rows × columns` grid (LH09 = 25 seats;
  typical halls are small). The `isActive = true` predicate is then applied to
  that already-small rowset; the count is over exactly that set. PostgreSQL
  can use the `hall_id` index and filter — no second pass over the table.
- The `[benchId]` index does the same for `deriveBenchCapacity`; a bench holds
  at most a handful of seats.
- Capacity is a **read-time derivation** (never stored, never cached), so these
  queries run at serialization/generation time per hall/bench — not a hot path,
  and each runs against an O(hall-seats) set.
- Adding `(hallId, isActive)` (or `(benchId, isActive)`) would be speculative:
  it would not change the plan materially at this cardinality and would add
  write amplification on every seat mutation for no measurable gain.

### Decision

**No index change.** Current single-column `[hallId]` and `[benchId]` indexes
are appropriate and sufficient for the authoritative capacity queries at the
current data model. No additive migration is justified, so none was created.
The `[isActive]` column's standalone index exists but is not needed for these
queries (the leading hall/bench column dominates); it is left as-is.

---

## 3. Historical / cascade integrity

### Foreign keys

- `hall_seats.bench_id → benches.id` `ON DELETE SET NULL ON UPDATE CASCADE`
  (add_bench migration). A bench row can never be deleted (see trigger), so
  `SET NULL` never fires in practice; HallSeat rows are never removed by any
  bench operation.
- `benches.hall_id → halls.id` `ON DELETE RESTRICT ON UPDATE CASCADE`. A hall
  cannot be deleted while benches reference it (halls use status-based
  deactivation anyway).
- `seat_assignments.hall_seat_id → hall_seats.id` (required, RESTRICT),
  `seat_assignments.hall_id → halls.id` (RESTRICT),
  `seat_assignments.seating_plan_id → seating_plans.id` (RESTRICT),
  `seat_assignments.exam_candidate_id → exam_candidates.id` (RESTRICT). HallSeat
  and Hall rows referenced by assignments cannot be deleted.
- `audit_logs` has **no FK columns to Hall/Bench/HallSeat** — `actor_id`/
  `entity_id` are loose strings. Audit rows are append-only and can never be
  cascade-deleted by these operations.

### Triggers

`es_protect_hard_delete()` (init migration) raises `P0001` ("hard delete is
disabled for table ...") on any `DELETE`. Applied to: `exams`,
`exam_candidates`, `seating_plans`, `seat_assignments`, `uploaded_documents`,
`solve_jobs` — and to **`benches`** via `trg_es_benches_no_delete`
(add_bench migration). HallSeat rows themselves are never deleted by the
application (only `is_active` flips).

### Transaction behavior

`setBenchActive(false)` (bench.service.ts:110-129) runs in a single
`$transaction`: bench `is_active=false` + `updateMany` on
`{ benchId, isActive: true }` → `isActive: false`. Deactivation is atomic;
reactivation touches **only** the bench row (never seats).

### Proof (item-by-item)

1. **Deactivating a Bench does not delete HallSeat rows** — `setBenchActive`
   only calls `update`/`updateMany` (no delete); proven by
   `tests/bench.test.ts` "atomically decommissions a bench and its member
   seats" (member seats still exist, `isActive=false`, count 3) and
   "reactivating a bench does not reactivate decommissioned seats".
2. **Does not delete SeatAssignment history** — no SeatAssignment write path in
   bench service; proven by "decommissioning a bench preserves historical
   SeatAssignment rows" (assignment row + `hallSeatId` reference intact).
3. **Existing `SeatAssignment.hallSeatId` references remain valid** — HallSeat
   rows are never deleted (deactivation flips `is_active` only); the same test
   re-reads `assignment.hallSeat` and asserts `hallId`/`seatPosition`.
4. **Audit records remain intact** — `audit_logs` has no FK to these tables;
   bench mutations append `BENCH_CREATED`/`BENCH_UPDATED`/`BENCH_STATUS_CHANGED`/
   `BENCH_SEAT_ASSIGNED`/`BENCH_SEAT_REMOVED` rows and never delete audit rows.
5. **No orphaned rows** — decommission creates/deletes no HallSeat rows;
   `removeSeatFromBench` sets `bench_id=null` (row stays owned by its hall);
   no table receives dangling FKs.
6. **Hard deletion of Bench blocked** — proven by "refuses to hard-delete a
   bench (no-delete trigger)" (`prisma.bench.delete` rejects; row count stays 1).
7. **Decommission only changes intended active member seats** — the
   `updateMany` predicate is `{ benchId, isActive: true }`; proven by
   "deactivating a bench leaves other benches' seats and unassigned seats
   untouched" and "decommissioning does not rewrite an independently inactive
   member seat, and reactivation never touches it".

### New regression tests added

Three narrowly scoped tests were added to `tests/bench.test.ts` (14/14 PASS)
covering the exact invariant wording: cross-hall reassign rejection;
deactivation leaving other benches'/unassigned seats untouched;
independently-inactive member seat surviving decommission+reactivation. No
further uncovered invariant was found, so no additional tests were added.

---

## 4. API contract / documentation audit

### Actual response shapes (src/phase4/api.ts serializers)

`serializeHall` (api.ts:1276): `{ id, hallNumber, name, building, rows,
columns, isActive, createdAt, updatedAt, totalSeatCount: seats.length,
activeSeatCount: seats.filter(isActive).length, unassignedSeats:
seats.filter(benchId === null), benches: [{ id, hallId, benchNumber,
isActive, createdAt, updatedAt, capacity: b.seats.filter(isActive).length,
seats }] }`

`serializeBench` (api.ts:1340): `{ id, hallId, benchNumber, isActive,
createdAt, updatedAt, hall, capacity: seats.filter(isActive).length, seats }`

`serializeHallSeat` (api.ts:1370): `{ id, hallId, benchId, seatPosition, row,
column, isActive }`

### Derived-capacity semantics (verified)

- Hall capacity (returned as `activeSeatCount`) is derived from **active
  HallSeat rows** of the hall at read time (`deriveHallCapacity`,
  hall.service.ts:88).
- Bench capacity is derived from **active HallSeat rows assigned to that
  Bench** at read time (`deriveBenchCapacity`, bench.service.ts:132).
- **No persisted `Hall.capacity` field** — `Hall` model columns are `id,
  hallNumber, name, building, rows, columns, isActive, createdAt, updatedAt`
  (schema.prisma:241).
- **No persisted `Bench.capacity` field** — `Bench` model columns are `id,
  hallId, benchNumber, isActive, createdAt, updatedAt` (schema.prisma:279).
- Capacity is a projection/read-time value, computed at serialization and in
  `buildSolverInput` (solverInput.service.ts:73-78).

### Frontend/backend agreement

`frontend/src/lib/types.ts` `Hall`, `HallBench`, `HallSeat` match the backend
serializers field-for-field on every field the UI consumes (`totalSeatCount`,
`activeSeatCount`, `unassignedSeats`, bench `capacity`, seat `benchId`/
`isActive`, etc.). The bench-detail response additionally carries a `hall`
object that the frontend `HallBench` type does not model — additive, unused by
the UI, and not a contract violation. No stale or divergent types found.

### OpenAPI / documentation status

**NO FORMAL OPENAPI CONTRACT EXISTS.**

- The backend is a hand-rolled `node:http` router (`src/phase4/api.ts`) with
  manual serializers; it does not expose `/openapi.json`, `/docs`, or `/redoc`.
- `solver-service/app/main.py` constructs FastAPI with
  `openapi_url=None, docs_url=None, redoc_url=None`.
- Prior evidence confirms this: `docs/evidence/phase6-tb3/topology-decision.md`
  lists `GET /openapi.json` as 404 (disabled); `docs/evidence/phase7b/
  phase7b-closeout.md` states the API has no OpenAPI docs.
- No spec file exists in the repository.

Per the audit instruction, no new documentation system was invented and no
documentation was corrected (nothing to correct — there is no OpenAPI contract
to be stale).

---

## Final decision

```text
PHASE 18 PRE-COMMIT — CLEAR
```