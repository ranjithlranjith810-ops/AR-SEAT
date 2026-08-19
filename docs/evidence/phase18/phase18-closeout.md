# Phase 18 — Hall & Bench Management

## Summary

Delivered the Phase 18 **Hall & Bench Management** product surface: a Bench
grouping layer over the existing Hall/HallSeat domain, backend REST API with
explicit RBAC, an ADMIN browser UI, audit coverage for all writes, idempotent
seeding, and full verification (backend suite, frontend suite/build, E2E). The
solver input contract is **unchanged**: `buildSolverInput` and the six frozen
solver files were never touched — post-implementation SHA-256 confirms they are
byte-identical to baseline. Nothing committed or pushed.

## Design (per the accepted implementation directive)

- **Bench = management/grouping layer above the seat grid.** The solver domain
  remains the active `HallSeat` set; benches are invisible to generation.
- **Capacity is derived only** — never stored on `Hall` or `Bench`. Single
  source of truth = active `HallSeat` rows. See
  `docs/evidence/phase18/phase18-capacity-model.md`.
- **Cross-hall guard** (`BENCH_SEAT_HALL_MISMATCH`): a seat can only be
  assigned to a bench in the same hall.
- **Atomic decommission**: `setBenchActive(false)` flips the bench **and** its
  member seats inactive in one `$transaction`; reactivation never re-activates
  seats. `SeatAssignment` history is preserved.
- **Immutable geometry**: `Hall.rows`/`columns` are immutable after creation;
  `updateHall` only accepts name/building/isActive. Seat `row`/`column`/
  `seatPosition` never change.
- **Additive migration only**; `benches` carries a no-hard-delete trigger
  (`trg_es_benches_no_delete`) consistent with the existing RDBMS policy.

## Scope Delivered

### Schema (`prisma/schema.prisma` + migration)

- `Bench` model (`benches`): `hallId`, `benchNumber`, `isActive`, timestamps;
  `@@unique([hallId, benchNumber])`, `@@index([hallId])`. No capacity column.
- `HallSeat.benchId String?` + relation to `Bench` + `@@index([benchId])`.
- `Hall.benches Bench[]`.
- 8 new `AuditAction` values: `HALL_CREATED`, `HALL_UPDATED`,
  `HALL_STATUS_CHANGED`, `BENCH_CREATED`, `BENCH_UPDATED`,
  `BENCH_STATUS_CHANGED`, `BENCH_SEAT_ASSIGNED`, `BENCH_SEAT_REMOVED`.
- Hand-authored migration
  `prisma/migrations/20260819144738_add_bench/migration.sql` including the
  `trg_es_benches_no_delete` trigger; applied to dev and test DBs.

### Backend (`src/phase4/api.ts` + services)

- Routes under `/exam-seating`:
  - `GET/POST /halls`, `PATCH /halls/:id`
  - `GET/POST /halls/:id/benches`
  - `GET/PATCH /benches/:id`, `POST /benches/:id/status`
  - `POST/DELETE /benches/:id/seats/:hallSeatId`
- RBAC: reads = `requireAuth`; all mutations = `requireAdmin`.
- Error mapping: `HALL_NOT_FOUND`/`BENCH_NOT_FOUND` → 404;
  `BENCH_SEAT_HALL_MISMATCH`/`BENCH_SEAT_NOT_ASSIGNED` → 400;
  `BENCH_ALREADY_EXISTS` → 409.
- Serializers expose live derived capacity, `unassignedSeats`,
  `activeSeatCount`/`totalSeatCount`; audit rows written for every mutation.
- New `src/services/bench.service.ts`: `createBench`, `getBench`,
  `getBenchDetail`, `listBenches`, `updateBench`, `setBenchActive`,
  `deriveBenchCapacity`, `assignSeatToBench`, `removeSeatFromBench`.
- `src/services/hall.service.ts`: added `listHalls` (halls + seats + benches
  with seats) and `updateHall` (name/building/isActive only).

### Seed (`prisma/seed.ts`)

Idempotent: LH09 gets one bench per row letter A–E (bench `A` holds `A1..A5`),
seats receive `benchId` in both create/update branches.

### Frontend (`frontend/`)

- `HallsPage.tsx` — hall CRUD, bench CRUD, seat-to-bench assign/remove, live
  capacity, decommission, loading/empty/error+Retry states, success/danger
  notices, safe error mapping. No mock data.
- Wiring: `/halls` route (`RequireAdmin`) in `App.tsx`, "Halls & benches"
  NavLink (ADMIN only) in `Layout.tsx`.
- `lib/types.ts` (Hall/HallBench/HallSeat + `unassignedSeats` + new audit
  labels) and `lib/api.ts` (hall/bench client functions).

## Tests

### Backend — `tests/bench.test.ts` (14 tests)

Creation + derived capacity, duplicate bench number within a hall (409),
same number allowed in another hall, cross-hall assignment rejection,
**cross-hall reassign rejection**, seat move/remove within a hall, atomic
decommission, deactivation leaving **other benches' seats and unassigned seats
untouched**, **independently-inactive member seat** surviving decommission
(not rewritten) and reactivation (never touched), reactivation does not
reactivate decommissioned seats, `SeatAssignment` history preserved after
decommission, no-delete trigger, **solver input oblivious to benches**
(capacity 5, seat shape = id/seatPosition/row/column only), bench list
ordering.

Result: **14/14 PASS**; regressions `hall.test.ts` 6/6 and
`deletion.test.ts` 8/8 PASS.

### Full backend suite (Supabase `exam_seating_test`)

**30 files passed / 1 skipped, 237 passed / 3 skipped (240)** — 753.60s.
3 skipped are the pre-existing `storage-integration.test.ts` (env-gated) file.
Three additional cross-hall reassign / deactivation-scope tests were added to
`bench.test.ts` afterwards and pass 14/14 in isolation.

### Frontend

`HallsPage.test.tsx` 12/12; full suite **139/139 PASS (11 files)**; typecheck
`tsc -b` PASS; production build PASS.

### E2E — `e2e/specs/bench-management.spec.ts` (4 tests)

ADMIN browses seeded halls with live capacity, full browser flow
(create hall → add bench → assign seat → decommission), API auth + RBAC
(401 anon / STAFF 403, ADMIN 200), cross-hall guard + soft decommissioning.
Run against a fresh local Docker `exam_seating_e2e_test` DB with scrubbed env
via `scripts/e2e/run-e2e.mjs`.

Result: **21/21 PASS** across all 6 spec files (4 new + 17 pre-existing, no
regressions) — includes the golden-path full lifecycle.

## Verification Gates

| Gate | Result |
|---|---|
| Phase 18 backend tests (bench.test.ts + hall + deletion) | 28/28 PASS |
| Full backend suite (Supabase `exam_seating_test`, recorded run) | 237 passed / 3 skipped (30 files); +3 bench tests pass 14/14 in isolation |
| Root typecheck (`npx tsc --noEmit`) | PASS |
| Frontend test suite | 139/139 PASS (11 files) |
| Frontend typecheck (`tsc -b`) | PASS |
| Frontend production build | PASS |
| E2E Playwright (fresh local Docker `*_test` DB) | 21/21 PASS |
| Frozen solver files post-implementation SHA-256 | MATCH (byte-identical, `git diff` exit 0) |

## Frozen-File Integrity

Six frozen solver files (`seatlabel.py`, `solver.py`, `graph.py`,
`partition.py`, `guards.py`, `validation.py`) verified byte-identical before
and after the implementation; `git diff --exit-code HEAD -- solver-service/app/`
returns 0. See `docs/evidence/phase18/phase18-frozen-file-verification.log`.

## Security / Architecture

- No auth bypass, no RBAC weakening: all bench/hall mutations are
  ADMIN-gated; reads are authenticated; anon → 401, STAFF → 403.
- No RLS/tenant-isolation changes; no hard-delete surfaces (benches carry the
  no-delete trigger; halls/seats use status-based deactivation).
- No unrelated refactoring of the verified seating/PDF/auth backbone;
  `solverInput.service.ts` and all solver files untouched.
- Tests/E2E ran only against the guard-verified `exam_seating_test` DB and a
  fresh local Docker `*_test` DB with scrubbed env.

## Notes

- The bench E2E spec soft-deactivates the halls it creates so the shared
  fresh-DB suite keeps golden-path's generation domain at its seeded state
  (only LH09 active). This preserves suite order-independence.
- E2E run also required starting the local Docker Desktop service (daemon was
  stopped); the orchestrator itself was unchanged.

## Files (Phase 18)

New:
- `prisma/migrations/20260819144738_add_bench/`
- `src/services/bench.service.ts`
- `tests/bench.test.ts`
- `e2e/specs/bench-management.spec.ts`
- `frontend/src/components/HallsPage.tsx`, `HallsPage.test.tsx`
- `docs/evidence/phase18/` (trace, schema-inspection, capacity-model,
  frozen-file-verification.log, closeout, backend/e2e logs)

Modified (Phase 18 changes on top of pre-existing uncommitted state):
- `prisma/schema.prisma` (Bench model, `HallSeat.benchId`, `Hall.benches`,
  AuditAction enum)
- `prisma/seed.ts` (idempotent LH09 benches)
- `src/phase4/api.ts` (hall/bench routes + handlers + serializers)
- `src/services/hall.service.ts` (`listHalls`, `updateHall`)
- `tests/helpers.ts` (`benches` truncation)
- `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`
- `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`
- `frontend/src/styles.css`
- `docs/evidence/phase18/phase18-frozen-file-verification.log` (post-impl)

Pre-existing uncommitted work (NOT Phase 18, still uncommitted): frontend auth
Fast-Refresh fix (`auth-context.ts`, `AuthContext.tsx`, `harness.tsx`,
`AuthAndLogin.test.tsx`, `UploadPage.test.tsx`), `e2e/helpers.ts`,
`e2e/specs/auth.spec.ts`, `scripts/dev-all.mjs` + `package.json`, Phase 16
surface (`AuditPage.tsx`/`.test.tsx`, `tests/phase16-audit-read.test.ts`,
`e2e/specs/audit-read.spec.ts`, `scripts/e2e/seed.mjs`), Phase 17 surface
(`StudentsPage.tsx`, `StudentForm.tsx`, `StudentsPage.test.tsx`,
`tests/phase17-student-master.test.ts`, `e2e/specs/students.spec.ts`,
`src/services/class.service.ts`, `src/services/student.service.ts`,
`src/services/department.service.ts`,
`prisma/migrations/20260818000000_add_student_master_audit_actions/`),
`tests/phase4-ingestion-e2e.test.ts`, earlier evidence dirs
(`phase12/13/16/17/7a/8b/phase3/4-benchmarks`, etc.), `docs/phase18-prompt-revised.md`,
`docs/phase3-discovery.md`, `test-results/`, `phase10-verified-bundle.zip`,
stray `eating prototype•` dir.

## Git State

```text
committed: NO
pushed: NO
HEAD: d3b6d5696b9e7f962f72b4862ec6e41f10722ae4 (feat: add Phase 14 E2E browser harness)
Phase 18 work: uncommitted (new + modified files above)
```

## Final Status

```text
PHASE 18 — COMPLETE
```