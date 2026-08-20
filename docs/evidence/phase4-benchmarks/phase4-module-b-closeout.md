# Phase 4 — Module B Close-out (partition topology fix + guard parity + benchmark)

Date: 2026-08-15
Status: **CASE A — FULLY VERIFIED**
Frozen solver modified: **NO**
Owner directive: do not modify the frozen CP-SAT solver — no solver file changed.

## 1. Blocker resolved: physical connected-component partitioning

The review blocker ("if it simply does hall -> domain without checking physical
adjacency, do not sign off Module B") is resolved.

- `src/phase4/topology.ts` (new) is a faithful mirror of `solver-service/app/graph.py`:
  - `buildPhysicalGraph` — seat graph nodes/edges, 8/cardinal adjacency within a
    hall (`rowIndex = ord(row)-ord("A")`), cross-hall edges added ONLY when
    explicitly configured, otherwise hall isolation is verified, never assumed.
  - `UnionFind` + `connectedComponents` — domain boundary = PHYSICAL connected
    component, exactly like `partition.py`.
  - `verifyPartitionInvariants` — every seat in exactly one domain, no seat
    missing, no adjacency edge spans two domains.
  - `topologyAnomalyEvidence` — records adjacency edges within each domain.
- `src/phase4/partition.ts` — rewritten to partition by connected components:
  - `domainId = D-<hallNumbers joined by +>` per component; `DomainPlan` now
    carries `hallIds[]`, `hallNumbers[]`, `halls[]` (component halls), flattened
    `seats`.
  - `DomainPlan.hallId/hallNumber` removed; `buildDomainPayload`,
    `domainPayloadToSolverInput`, `validateMerge`, and `api.ts`
    `serializeGeneration` updated for multi-hall components.
  - Candidate allocation mirrors the frozen `allocate_candidates_to_domains`:
    per-department blocks (sorted), round-robin across domains, register order.
  - Guards unchanged in semantics: `candidateCount > seatCount` ->
    INSUFFICIENT_CAPACITY (only true capacity error); risk ratios are
    non-blocking signals; component > 1000 candidates ->
    `ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT` before dispatch.

## 2. Topology tests (evidence: phase4-partition-topology-tests.log)

7/7 pass against the topology suite (independent halls -> separate domains;
cross-hall edge -> one merged domain; transitive A-B-C -> one domain; two
independent pairs -> two domains; oversized component blocked; seat
completeness invariant; cross-domain adjacency flagged by the verifier).

## 3. Guard parity (evidence: phase4-guard-parity-tests.log)

10/10 fixtures identical between TypeScript `computeCompositionGuard` and the
FROZEN Python `guards.compute_composition_report` (classification, error code,
risk-violation count). Covers: BALANCED, IMBALANCE_RISK (department/year/
cohort/empty-seat), INSUFFICIENT_CAPACITY, strict `>` threshold boundaries for
department (0.60), year (0.70), empty-seat (0.80), and the
single-year-is-structure rule (`len(counts) >= 2`).

## 4. Full regression (evidence: phase4-npm-test.log, phase4-pytest.log)

- `npm test` (isolated `exam_seating_test` DB): **111 passed, 3 skipped**
  (14 files passed, 1 skipped).
- `pytest -q` (solver-service venv): **85 passed**, 1 pre-existing
  deprecation warning.
- `npm run typecheck`: clean.

## 5. Parallel benchmark — real CP-SAT solver (evidence: phase4-parallel-benchmark.log)

Workload: 8 halls x 25 seats = 200 seats, 160 candidates (CSE/ECE/MECH/CIVIL,
2026/2027), timeLimit=120s, adjacency=eight, DEPARTMENT_ONLY. uvicorn spawned
from the frozen solver-service; every generation COMPLETED, all 8 domains
OPTIMAL, merge valid, 160/160 candidates assigned, no blocked/failed domains.

| workers | wall-clock | sum(per-domain solve) | peak RSS | state |
|---------|-----------|------------------------|----------|-------|
| 2       | 1539 ms   | 1448 ms                | 86 MB    | COMPLETED (8/8 OPTIMAL, merge valid) |
| 4       | 1493 ms   | 1436 ms                | 82 MB    | COMPLETED (8/8 OPTIMAL, merge valid) |
| 8       | 1783 ms   | 1607 ms                | 83 MB    | COMPLETED (8/8 OPTIMAL, merge valid) |

Finding: 8 workers is NOT faster (CP-SAT already uses 8 internal search
workers per domain; domain-level concurrency adds CPU contention). 4 workers
is marginally best on this workload. This confirms the review caution "do not
assume 8 workers faster". No resource failures, no timeouts, merge valid at
every concurrency.

## 6. Evidence logs (docs/evidence/phase4-benchmarks/)

- phase4-partition-topology-tests.log
- phase4-guard-parity-tests.log
- phase4-npm-test.log
- phase4-pytest.log
- phase4-parallel-benchmark.log (+ phase4-parallel-run.log)
- phase4-git-status.log
- phase4-git-diff-stat.log
- phase4-git-diff-name-only.log
- phase4-git-log.log

## 7. Change surface (implementation phase; nothing committed)

- Modified: `src/phase4/partition.ts` (connected-component partitioning),
  `src/phase4/types.ts`, `src/phase4/generation.service.ts`,
  `src/phase4/validateMerge.ts`, `src/phase4/api.ts`,
  `src/phase4/integration.ts`, `tests/phase4-orchestration.test.ts`,
  `tests/phase4-persistence.test.ts`, `solver-service/app/main.py`
  (/solve-domain endpoint, added earlier).
- New: `src/phase4/topology.ts`, `solver-service/tests/test_solve_domain.py`,
  `scripts/guard-parity.ts`, `scripts/guard-parity-python.py`,
  `scripts/benchmark-parallel.ts`, evidence logs under
  `docs/evidence/phase4-benchmarks/`.
- FROZEN solver files (seatlabel.py, solver.py, graph.py, partition.py,
  guards.py, validation.py): **untouched**.

Classification: **CASE A — FULLY VERIFIED**. Module B may be signed off.