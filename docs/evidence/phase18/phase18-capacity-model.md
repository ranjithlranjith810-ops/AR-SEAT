# Phase 18 — Capacity Model

Date: 2026-08-19 (post-implementation)

## Decision

Bench and Hall capacity are **derived only** — never stored, never cached. The
single source of truth for capacity is the active `HallSeat` row set. A Bench
is a management/grouping layer **above** the seat grid; it owns no capacity
state of its own.

## Why derived, not stored

1. **One authoritative source.** `HallSeat.isActive` already drives the solver
   input (`buildSolverInput` filters `seats` on `isActive: true`). Storing a
   capacity column on `Hall` or `Bench` would create a second, desynchronizable
   copy of the same fact.
2. **No desync window.** Because capacity is recomputed at read/generation
   time, a bench decommission, seat deactivation, or seat reassignment is
   reflected in the very next read — there is no cached value to go stale.
3. **Immutable geometry, mutable state.** `Hall.rows`/`columns` are immutable
   after creation; individual seat activity changes over time. A stored
   capacity would have to be maintained across every seat mutation. Deriving it
   removes that maintenance burden entirely.

## Where capacity is derived

| Read | Source | Implementation |
| --- | --- | --- |
| Hall capacity | active `HallSeat` rows of the hall | `deriveHallCapacity` in `src/services/hall.service.ts` (count where `isActive: true`) |
| Bench capacity | active `HallSeat` rows with `benchId = bench.id` | `deriveBenchCapacity` in `src/services/bench.service.ts` |
| Solver domain seats | `buildSolverInput` → active seats per active hall | `src/services/solverInput.service.ts` (`capacity: h.seats.length`) |
| API `serializeHall` | live seat list | `totalSeatCount` / `activeSeatCount` / bench `capacity` computed at serialization |
| API `serializeBench` | live member seat list | `capacity: seats.filter(s => s.isActive).length` at serialization |

## Bench capacity semantics

`deriveBenchCapacity(benchId)` = number of `HallSeat` rows where
`benchId = benchId` **and** `isActive = true`. There is no `capacity` column on
the `bench` table (schema: `prisma/schema.prisma`, `Bench` model fields are
`id`, `hallId`, `benchNumber`, `isActive`, timestamps only).

## Decommission/commission semantics (consistency of the derived model)

- **Decommission** (`setBenchActive(benchId, false)`): a single `$transaction`
  flips the bench inactive **and** all member seats inactive. The next read
  therefore reports bench capacity `0` — consistent with the physical state
  the hall actually offers.
- **Reactivation** (`setBenchActive(benchId, true)`): flips the bench active
  only; it **never** re-activates member seats. Decommissioned seats stay
  decommissioned, so capacity is never silently "restored" to seats an admin
  intentionally took out of service.
- **Seat reassignment** moves a seat between benches in the same hall; both
  benches' derived capacities update atomically because they are read from the
  same `HallSeat.benchId` fact.
- **Cross-hall guard** (`BENCH_SEAT_HALL_MISMATCH`) guarantees a bench's member
  seats always belong to the bench's hall, so hall-level aggregation (a hall's
  capacity is unaffected by another hall's benches) remains exact.

## Solver-input invariant

`buildSolverInput` does **not** read benches at all (`src/services/
solverInput.service.ts`). The solver's domain remains the active `HallSeat`
set exactly as before Phase 18. Bench capacity is a *projection for the
management UI*, never an input to generation — proven by
`tests/bench.test.ts` ("keeps the solver input oblivious to benches"): a hall
with 5 active seats and an assigned bench yields `availableSeatCount = 5` and
a seat shape of `{ id, seatPosition, row, column }` only.

## Concurrency

Every capacity-affecting mutation (bench create/update/status, seat
assign/remove) runs inside its own Prisma transaction. Reads derive capacity
at query time, so concurrent mutations are observed atomically at the next
read. There is no stored value to lock or reconcile.