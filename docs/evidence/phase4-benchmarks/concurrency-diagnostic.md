# Phase 4 — Concurrency Path Diagnostic

Date: 2026-08-15
Task: determine whether domain jobs actually execute concurrently from the Node
worker pool down to CP-SAT, and identify exactly where serialization occurs.

## 1. Repository Baseline

- HEAD == origin/main == `ec2a170` (clean before diagnostic; no production
  files modified during this task).
- Baseline evidence captured:
  `concurrency-git-status.log`, `concurrency-git-log.log`,
  `concurrency-git-diff-stat.log` (0 bytes — no diff),
  `concurrency-git-diff-name-only.log` (0 bytes — no diff).
- Frozen solver files (`seatlabel.py`, `solver.py`, `graph.py`, `partition.py`,
  `guards.py`, `validation.py`) verified UNCHANGED (`git diff --stat` empty).

## 2. Node Worker Pool Behavior

`src/phase4/workerPool.ts` `mapWithConcurrency` starts `min(limit, n)` async
workers that each pull the next index and `await task(item)` — genuine Promise
concurrency, no lock/mutex. `generation.service.ts:185` dispatches via
`mapWithConcurrency(payloads, worker, { limit: maxParallelDomains })`, each
worker `await dispatch.solveDomain(payload)`.

MEASURED (8 domains): all 8 requests fired within **7 ms**, **28/28 overlapping
pairs**. Node-side concurrency is real. → CASE C excluded.

## 3. HTTP Client Behavior

`solverClient.ts` uses global `fetch` (undici) — no Agent override, no
connection limit, no serial await, keep-alive on. The `/health` probe (a
separate fetch) was received by the server **while solves were still running**,
proving multiple simultaneous client connections. The HTTP layer is concurrent.

## 4. Uvicorn Configuration

Started benchmark-identically: `python -m uvicorn app.main:app --host
127.0.0.1 --port N` — **no `--workers`, no `--reload`** → `workers == 1`.
Observed: exactly **ONE serving python process** (parent PID is a supervisor;
child prints `Started server process [29012]`), i.e. **one asyncio event loop**.

## 5. /solve-domain Execution Model

`main.py:66` — `async def solve_domain(...)` calls
`seatlabel.solve_domain(req, settings)` **synchronously at main.py:85**, which
invokes `cp_model.CpSolver().Solve(model)` (`seatlabel.py:326`). No
`run_in_executor`, no `asyncio.to_thread`, no thread/process pool. A blocking
CPU-bound call inside an async handler **occupies the event loop** for the
whole solve.

## 6. Python Process/Thread Behavior

Single serving process; every request runs on the same event-loop thread.
Thread IDs are not logged by the frozen service (recorded NOT_AVAILABLE rather
than modifying code). The serving process showed 15–23 threads and multi-core
CPU — CP-SAT's **internal** search workers within one solve, not concurrent
requests.

## 7. Request Overlap

- Node: 8/8 requests overlap (28/28 pairs).
- Server (timestamped solver logger): completions strictly back-to-back —
  `27.561 → 31.353 → 35.363 → 39.458 → 43.392 → 47.227 → 50.962 → 55.238`,
  each gap exactly equal to the previous solve's duration. **No overlap.**

## 8. CP-SAT Overlap

None — only one solve is ever invoked at a time because the event loop blocks.
Separate GIL probe (direct import, 4 solves on 4 threads): wall/max = **1.01x**
(near-perfect overlap) — **CP-SAT itself is NOT the serializer**; it would run
concurrently if invoked from multiple threads/processes.

## 9. CPU/Memory Behavior

wallClock **31,928 ms** vs sum of solves **31,264 ms (0.98x)** vs max solve
**4,245 ms (7.52x)**. The `wall == sum` signature is serial execution, not
contention. Health probe fired mid-run was **starved 27.9 s**, served only
after all 8 solves finished — definitive proof the event loop was continuously
blocked. Prior benchmarks (1000 candidates, workers 1/2/4/8 → ~46–50 s) show
the same `wall == sum` signature, consistent with serial execution.

## 10. Root Cause

`main.py:85` — an `async def` handler executes a synchronous, CPU-bound
CP-SAT solve directly on the single uvicorn asyncio event loop. Every request
queues on that loop and runs one at a time. The prior "CPU contention" claim
is disproven: wall == sum (not ~max), and the GIL probe shows the solver would
overlap.

## 11. Production Impact

The configured concurrency (default 4) currently has **no effect** on solver
elapsed time: N domains take ~sum(solve durations) regardless of worker count.
The orchestrator (partitioning, guards, dispatch, merge, persistence) is
correct; the solver-service request path is the bottleneck. No correctness
issue — only latency.

## 12. Required Fix (recommendation only — NOT applied in this diagnostic)

Per the STOP/FIX policy this was not implemented. Options, in order of
robustness:
1. **Offload the solve off the event loop** — the minimal fix. Make the
   handler synchronous `def` (FastAPI then runs it in the threadpool) or wrap
   the call in `await asyncio.to_thread(...)`. The GIL probe proves real
   concurrency is achievable on threads (wall/max 1.01x).
2. **Run uvicorn with `--workers N`** — process-level parallelism, GIL
   irrelevant, heavier memory footprint.
Both are service request-path changes; the frozen solver engine is untouched.

## 13. Evidence Files

- concurrency-node-timing.log (per-domain + health-probe + CPU samples)
- concurrency-python-startup.log (startup command, process model, env)
- concurrency-handler-analysis.log (handler call path)
- concurrency-http-analysis.log (client + worker pool + probes)
- concurrency-overlap.log (Node + server-side overlap)
- concurrency-process-thread.log (process/thread/GIL probe)
- concurrency-benchmark.log (prior benchmark serial signature)
- concurrency-interpretation.log (verdict + NOT_AVAILABLE items)
- concurrency-git-*.log (baseline)

## 14. Git Status

HEAD == origin/main == `ec2a170`. No production/source/test file changed.
Temporary diagnostic files (`scripts/diagnose-concurrency.ts`,
`scripts/diagnose-gil.py`, `scripts/diagnose-uvicorn-log.json`) were created,
used, and **removed** after evidence capture. Only new (untracked) evidence
logs under `docs/evidence/phase4-benchmarks/`.

## 15. Final Classification

    CASE B — HTTP/SERVICE SERIALIZATION

Node requests overlap but the solver-service processes them sequentially. The
exact mechanism is the `async def` `/solve-domain` handler calling the
synchronous CP-SAT solve directly on the single uvicorn asyncio event loop
(no `--workers`, no executor/thread boundary), blocking the loop for the full
solve duration.

    ROOT_CAUSE  : async handler blocks the single uvicorn event loop
                  (main.py:85 -> seatlabel.solve_domain -> CpSolver().Solve())
    AFFECTED_LAYER: solver-service FastAPI request handling (uvicorn process)
    EVIDENCE     : serial server completions (gaps == durations); wall == sum
                   (0.98x); health probe starved 27.9 s; GIL probe wall/max 1.01x
                   rules out CP-SAT/GIL; 28/28 Node overlap rules out Node/HTTP
    IMPACT       : worker count has no effect on elapsed solver time; N domains
                   cost ~sum of solve durations
    RECOMMENDED_FIX: offload solve off the event loop (sync `def` handler or
                   `asyncio.to_thread`) OR run uvicorn with `--workers N`;
                   frozen solver engine unchanged