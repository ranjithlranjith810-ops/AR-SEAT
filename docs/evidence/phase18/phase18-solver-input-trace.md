# Phase 18 — Solver-Input Trace

Date: 2026-08-19 (pre-implementation)

## Purpose

Section 3 of the Phase 18 spec requires tracing the complete current generation
input path **before any Hall/Bench code** and classifying the current solver
input source. This document records the findings with code-path evidence.

## Path traced (end-to-end)

1. `src/services/solverInput.service.ts` — `buildSolverInput(examId)`
2. `src/phase4/integration.ts` — `solverInputToDomains(input)` +
   `runSeatingGeneration` (calls `buildSolverInput` at line 176)
3. `src/phase4/generation.service.ts` — `runGeneration` + `buildDomainPayload`
4. `src/phase4/partition.ts` — `partitionCandidates` (capacity check at line 90)
5. `src/phase4/solverClient.ts` — HTTP dispatch to the frozen solver
6. `src/phase4/persist.ts` — `persistValidatedGeneration` (assignments)

## Answers to the eight trace questions

### 1. What represents the current seat set?

The `HallSeat` table (`hall_seats`). `buildSolverInput` (solverInput.service.ts
lines 55–71) queries active `Hall` rows, each including only `seats` where
`isActive: true`, ordered by `row` asc then `column` asc. Each seat is
`{ id, seatPosition, row, column }`.

### 2. Where does seat capacity come from?

Derived at read/generation time. `buildSolverInput` computes
`capacity: h.seats.length` per hall (line 73) and
`availableSeatCount = sum(hallRows, h => h.capacity)` (line 78). Capacity is
**not stored** on the Hall row and is not cached — it is recomputed from the
authoritative active `HallSeat` rows on every `buildSolverInput` call. The
service-level `deriveHallCapacity(hallId)` in `src/services/hall.service.ts`
counts active `HallSeat` rows the same way.

### 3. Where do seat labels/positions come from?

The `HallSeat` row/column/seatPosition columns, materialized by
`createHall` (`src/services/hall.service.ts`) as a `rows × columns` grid
(seatPosition like `A1`). Uniqueness per hall is enforced by
`@@unique([hallId, seatPosition])` in `prisma/schema.prisma` (line 263).

### 4. Is the input schema-backed, derived, hardcoded, synthetic, or mocked?

**Schema-backed and derived.** The entire seat set and capacity come from the
`halls` and `hall_seats` tables via Prisma, filtered by `isActive: true`.
There is no hardcoded/synthetic/mock seat data in the shipped generation path.

### 5. Which database models currently supply it?

- `Hall` (`halls`) — hall identity, `rows`/`columns` dimensions, active flag.
- `HallSeat` (`hall_seats`) — the individual seat set, position, active flag.

`SeatAssignment` (`seat_assignments`) records the results, referencing
`hallId` + `hallSeatId`.

### 6. Which Phase 4/10/11 tests prove the current behavior?

- `tests/hall.test.ts` — `createHall` materializes seats matching rows×columns;
  duplicate seat position within a hall rejected; capacity derived from active
  HallSeat records; inactive seats excluded from capacity; active seats
  available to the solver input builder.
- `tests/candidate.test.ts` — imports `buildSolverInput`/`buildSolverCandidateList`.
- `tests/phase10-plan-read.test.ts` — `createHall` used to build halls feeding
  plan reads.
- `tests/phase4-persistence.test.ts` / `tests/phase4-e2e.test.ts` —
  full generation path including hall/seat assignment persistence.
- `tests/seat-assignment.test.ts` — assignments reference hall + hallSeat.

### 7. Does the current generator already consume Hall/Bench data?

It consumes the **Hall domain** (Hall + HallSeat) today. There is **no Bench
model** in the schema, so no Bench data exists to consume. The generator
consumes the existing seat set directly from `HallSeat`.

### 8. If not, identify exactly where the integration boundary must change.

The Hall/HallSeat path **already feeds the real generation pipeline** — this
is not hypothetical. A Bench layer must therefore be designed to preserve this
contract. The integration boundary that a Bench model must respect:

- `buildSolverInput` selects `seats` directly off each active hall
  (solverInput.service.ts lines 64–68). If benches become the authoritative
  seat grouping, this selection (or the mapping from benches to the
  seatPosition/row/column shape) is the exact boundary to change.
- `solverInputToDomains` (integration.ts lines 236–250) and `buildDomainPayload`
  (generation.service.ts lines 337–344) require each hall to expose
  `seats: { id, seatPosition, row, column }[]` and `capacity` — the contract
  the Bench mapping must satisfy.

## Classification

**The current solver input is schema-backed and derived from the real Hall
domain (`Hall` + `HallSeat`). It is NOT synthetic, NOT hardcoded, NOT mocked.**

Therefore the spec's "confirmed Phase 18 integration requirement" branch (input
is synthetic/hardcoded → must integrate) **does not trigger**. The Phase 18
requirement becomes: **preserve the existing Hall/HallSeat → solver-input
contract while adding the Bench management layer**, and prove via tests that
the solver input continues to be built from real, authoritative seat state.

## Concurrency/capacity consistency model (Section 9 pre-design note)

Current model: **derived at read/generation time (option 1)** — capacity is
recomputed from active `HallSeat` rows inside each `buildSolverInput` call;
there is no stored or cached capacity to desynchronize. Concurrent bench/seat
mutations are therefore reflected atomically at the next read (each Prisma
query runs in its own transaction snapshot). The final model will be stated in
`phase18-capacity-model.md` once the Bench schema is designed.

## Open questions for Bench design (to resolve during schema inspection)

- Should benches replace the `HallSeat` grid, or sit above it as a grouping
  layer (bench → seats)? The `SeatAssignment.hallSeatId` reference and the
  `@@unique([hallId, seatPosition])` invariant constrain this choice.
- How do bench capacity and positions map to the `seatPosition`/`row`/`column`
  shape that the solver contract requires?