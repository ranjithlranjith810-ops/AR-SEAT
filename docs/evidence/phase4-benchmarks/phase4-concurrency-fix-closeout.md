# Phase 4 — Solver-Service Concurrency Fix & Verification (Close-Out)

Date: 2026-08-15
Status: IMPLEMENTATION VERIFIED

## Git provenance

- HEAD: `ec2a170e57e6ece8da8bc9ad5aa63c05a44ad7bf`
- origin/main: `ec2a170e57e6ece8da8bc9ad5aa63c05a44ad7bf`
- Working tree: `M solver-service/app/main.py` (the fix) + untracked evidence
  (docs/evidence/phase4-benchmarks/) + pre-existing untracked files.
  Not committed (task §21 — commit only when explicitly instructed).
- Changed files: `solver-service/app/main.py` only.

## Root cause

> `/solve-domain` was an `async def` handler that executed the synchronous
> CPU-bound CP-SAT solve directly inside the single uvicorn asyncio event loop
> (`python -m uvicorn app.main:app`, no `--workers`). Concurrent HTTP requests
> therefore queued and executed strictly one at a time.

This is NOT "CP-SAT/GIL serialization": the pre-fix GIL probe proved CP-SAT
releases the GIL and overlaps across threads (wall/max 1.01x), and the health
endpoint was starved 27.9 s while solves ran.

## Fix (implemented)

**Option A — synchronous FastAPI handler.** `solver-service/app/main.py:67`
changed `async def solve_domain(...)` to `def solve_domain(...)`. FastAPI now
executes the endpoint through its threadpool (anyio `to_thread`); the blocking
CP-SAT call runs on a worker thread and no longer occupies the event loop.
Execution-model change only — no solver formulation, parameters, objective,
adjacency, partitioning, or validator logic touched. Frozen files verified
unchanged via `git diff` (empty).

## Concurrency evidence (identical methodology to the pre-fix diagnostic)

| Metric               | Before Fix | After Fix |
| -------------------- | ---------: | --------: |
| Node request overlap | 28/28      | 28/28     |
| Server solve overlap | 0          | 28/28     |
| Health starvation    | 27.9 s (whole batch) | <= 2.2 s |
| wallClock (8x100)    | ~31.9 s    | 22.4 s    |
| sum solve (8x100)    | ~31.3 s    | 132.8 s   |
| wall/sum             | 0.98x      | 0.168x    |
| wall/max             | 7.52x      | 1.05x     |
| GIL wall/max         | 1.01x      | 1.01x     |

- Node: all 8 POSTs fired within 7 ms; 28/28 overlapping pairs (unchanged).
- Server: all 8 CP-SAT solve intervals overlap (28/28) — solves genuinely run
  concurrently instead of back-to-back. wall/max 1.05x (batch finishes as the
  longest solve finishes).
- Health: fired at +1.3 s / +2.9 s / +6.4 s while 8 solves were running;
  responded in 0.96 / 2.21 / 2.19 s — responsive during the batch, not blocked
  for its duration (batch ~22.4 s; pre-fix same probe starved ~27.9 s). The
  residual ~2 s latency is CPU oversubscription (see Resource behavior), not
  event-loop blocking.
- GIL probe unchanged: threads n=4 wall/max 1.01x — engine untouched.

## Benchmark (real CP-SAT, 1000 candidates, 10 domains, timeLimit 120 s)

| Workers | Wall ms | Sum Solve ms | wall/sum | Node Peak RSS MB | OPTIMAL | Merge Valid | Assigned |
| ------: | ------: | -----------: | -------: | ---------------: | :-----: | :---------: | -------: |
|       1 |  43394  |  42908       | 0.989x   | 66               | yes     | true        | 1000/1000 |
|       2 |  31845  |  61956       | 0.514x   | 64               | yes     | true        | 1000/1000 |
|       4 |  29019  | 100583       | 0.288x   | 67               | yes     | true        | 1000/1000 |
|       8 |  25516  | 157640       | 0.162x   | 67               | yes     | true        | 1000/1000 |

- Pre-fix historical benchmark (preserved in phase4-parallel-benchmark.log,
  NOT overwritten): workers 1/2/4/8 wall 49935 / 48372 / 46492 / 48662 ms.
- Post-fix the serialization signature (wall ~= sum) is gone at every worker
  count >= 2. At the production default workers=4 wall drops ~46.5 s -> ~29.0 s
  (~38% wall reduction).
- All runs COMPLETED, all domains OPTIMAL, 1000/1000 assigned, merge valid,
  failed=0.

## Correctness

- Every domain: status OPTIMAL; raw_solver_objective == reported_objective ==
  validator_objective (objective=0 for these feasible workloads; solver
  response carries the single objective path).
- candidate_count == assigned_candidate_count == 1000 at all worker counts.
- merge_valid == true at all worker counts.
- No partial publication weakened: phase4-failure.test.ts (9 tests, incl.
  failed-domain classification) passed in the full suite.
- No candidate disappeared due to concurrency.

## Regression

- npm test (isolated test DB): **124 passed / 3 skipped**, 17 files passed /
  1 file skipped — same counts as pre-fix (no regressions).
- npm run typecheck: **clean** (tsc --noEmit, 0 errors).
- pytest -q (solver-service): **85 passed**, 1 deprecation warning (pre-existing).
- Orchestration file unfiltered (`vitest run tests/phase4-orchestration.test.ts`):
  **23 tests, 23 passed, 0 skipped**.
- The pre-fix "124 passed / 3 skipped" was not treated as proof of the new
  code; the suite was re-run after the change.

## Resource behavior

- Solver process thread count during the 8-concurrent-solve diagnostic burst:
  15 -> 56 threads (8 solves x up to 8 CP-SAT internal search workers on an
  8-core host). CPU deltas (Get-Process, quantized) show multi-core
  oversubscription during the burst.
- Oversubscription is real: at workers=8, sum solve time is 157.6 s vs 42.9 s
  serial (total CPU ~3.7x), and workers=8 vs 4 gives only -12% wall (-29.0 s ->
  -25.5 s) for +57% sum-solve time. Diminishing returns at 8 are documented,
  expected production behavior (task §4/§13), not an implementation failure.
- Node peak RSS stable 64-67 MB across worker counts. Solver-process peak RSS
  during the benchmark runs was not captured (no sampler attached); the
  diagnostic thread/CPU sampling is the resource evidence. Recorded honestly.
- Timeouts / resource errors / solver failures: none (failed=0, all OPTIMAL).

## Evidence files (docs/evidence/phase4-benchmarks/)

- concurrency-fix-git-status.log / -git-log.log / -git-diff-stat.log /
  -git-diff-name-only.log (baseline + after)
- concurrency-after-node-overlap.log / -server-overlap.log / -health.log /
  -resource.log (full after-fix diagnostic report, one per evidence file)
- concurrency-after-gil.log (GIL probe)
- concurrency-after-benchmark.log (workers 1/2/4/8)
- phase4-orchestration-full.log (23/23)
- phase4-npm-test-after-fix.log (124 passed / 3 skipped)
- phase4-pytest-after-fix.log (85 passed)
- phase4-typecheck-after-fix.log (clean)
- phase4-concurrency-fix-closeout.md (this report)
- phase4-parallel-benchmark.log: historical pre-fix benchmark, restored after
  capture (old values not overwritten).

## Final classification

    CASE A — VERIFIED CONCURRENCY FIX

Event loop no longer blocked by CP-SAT (health responsive during solves),
multiple /solve-domain requests genuinely execute CP-SAT concurrently
(28/28 server solve overlap), wallClock is measurably below sum(domain solve
times) (0.168x at 8 domains; <1x at every worker count in the 1000-candidate
benchmark), correctness passes, and there are no timeout/resource failures.

Documented production behavior: real CPU oversubscription appears at high
worker counts (each CP-SAT solve already uses multiple internal search
workers); the Node default of 4 remains unchanged and appropriate — it delivers
the wall-clock reduction with materially less total CPU than 8.