# Phase 4 — Solver-Service Concurrency Fix: Final Close-Out

Date: 2026-08-15
Status: FINALIZED (pre-push)

## A. Git provenance

- Previous HEAD: `ec2a170e57e6ece8da8bc9ad5aa63c05a44ad7bf`
- New commit: `407942c586eaf6189230616e3a9fb14be70d6398`
  ("fix: enable concurrent solver-domain execution", 1 file, +6/-1)
- origin/main: `ec2a170e57e6ece8da8bc9ad5aa63c05a44ad7bf` (unchanged)
- Commits ahead of origin/main: 1
- PUSH_STATUS = NOT_PUSHED (not pushed; no push was instructed)
- Working tree after commit: no modified tracked files; only untracked evidence
  (docs/evidence/phase4-benchmarks/) and pre-existing untracked files.
- Commit contents: `solver-service/app/main.py` ONLY.

## B. Root cause

> `/solve-domain` previously executed synchronous CP-SAT work directly inside
> the single uvicorn asyncio event loop (`python -m uvicorn app.main:app`, no
> `--workers`), so concurrent HTTP requests queued and executed strictly one at
> a time.

Not "CP-SAT/GIL serialization" — the GIL probe (threads n=4, wall/max 1.01x)
disproved that explanation before the fix.

## C. Fix

> `/solve-domain` was changed from `async def` to synchronous `def`, allowing
> FastAPI/AnyIO to execute the blocking endpoint through its threadpool instead
> of blocking the asyncio event loop.

The body, the frozen-engine call (`seatlabel.solve_domain`), input/output
handling, objective passthrough, and validation are unchanged. Frozen solver
files verified unchanged via `git diff` (empty).

## D. Endpoint scope

- `/solve-domain`: changed (async -> sync def). Same body, same engine call,
  same response contract.
- `/health`: UNCHANGED. Responsive during solves (measured: 59 ms / 108 ms
  while 8 CP-SAT solves were running).
- `/solve`: unchanged; not part of the Phase 4 concurrent dispatch path; no
  change required.
- Middleware `_limit_body_size`: unchanged; not blocking on CP-SAT.
- ENDPOINT_SCOPE_STATUS = VERIFIED (see concurrency-endpoint-scope.log).

## E. Concurrency (final smoke test, 8 domains x 100 candidates)

- Node request overlap: 28/28
- Server CP-SAT solve overlap: 28/28 (all 8 solve intervals overlap)
- /health during burst: +1.5 s -> 59 ms, +3.5 s -> 108 ms (event loop free)
- wallClock: 19.7 s | sum solve: 120.3 s | max solve: 19.2 s
- wall/sum: 0.164x | wall/max: 1.028x
- All 8 domains OPTIMAL. The serialization signature did not return.

## F. Production benchmark (real CP-SAT, 1000 candidates, 10 domains)

| Workers | Wall ms | Sum Solve ms | Peak Python RSS MB | Peak Threads | Assigned | Failed |
| ------: | ------: | -----------: | -----------------: | -----------: | -------: | -----: |
|       1 |  41302  |  40830       |             222.9  |           24 |     1000 |      0 |
|       2 |  28899  |  55463       |             307.7  |           33 |     1000 |      0 |
|       4 |  26512  |  90828       |             479.2  |           48 |     1000 |      0 |
|       8 |  25219  | 154025       |             605.4  |           59 |     1000 |      0 |

Peak Python RSS = max WorkingSet64 of the actual uvicorn solver-process (child
of the `python -m uvicorn` supervisor), sampled externally every ~150 ms and
attributed to each worker-count run by wall-clock window. Solver RSS scales
with concurrent in-flight CP-SAT models (223 -> 605 MB). Node peak RSS 78-82 MB.
No timeouts, no resource errors, no solver failures at any worker count.

## G. Correctness

- All 10 domains successful at every worker count; state COMPLETED; failed = 0.
- 1000/1000 candidates assigned; merge_valid = true at every worker count.
- All domains OPTIMAL; objective reporting valid (objectiveValue passthrough;
  objective = 0 on these feasible workloads); validator agreement maintained.
- No partial publication weakened: phase4-failure.test.ts (9 tests) passed in
  the full suite; a single failed domain still prevents invalid publication.
- No candidate disappeared due to concurrency.

## H. Regression (final re-run after the fix, pre-commit)

- npm test: **124 passed / 3 skipped**, 17 files passed / 1 skipped.
- npm run typecheck: **clean** (tsc --noEmit, 0 errors).
- pytest -q: **85 passed**, 1 pre-existing deprecation warning.
- Orchestration file, unfiltered: **23 tests, 23 passed, 0 skipped**.

## I. Resource interpretation

Real CPU oversubscription exists at high worker counts: each CP-SAT solve uses
up to 8 internal search workers, so N concurrent solves create ~N x 8 threads.
At workers=8 the sum of solve times is 154.0 s vs 40.8 s serial (total CPU
~3.8x) while wall is 25.2 s, and workers=4 -> 8 gains only ~1.3 s wall for
+63 s sum-solve. This is expected, documented production behavior — NOT a
defect. Default remains SOLVER_MAX_PARALLEL_DOMAINS=4 (unchanged; owner may
decide otherwise, no automatic increase).

## J. Final classification

    CASE A — FULLY VERIFIED

All required checks pass: event loop no longer blocked, server-side solves
genuinely overlap (28/28), /health responsive during solves, wall < sum at
every worker count, workers 1/2/4/8 benchmark captured including actual Python
solver-process peak RSS (measured, not estimated), correctness and full
regression suites green, frozen solver unchanged, final diff is only the
intended execution-model change, commit created with clean post-commit
provenance, push state explicitly reported (NOT_PUSHED).