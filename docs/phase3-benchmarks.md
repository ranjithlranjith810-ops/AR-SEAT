# Phase 3 — CP-SAT Solver Benchmarks: 500-Student Validation & Encoding Comparison

Status: PHASE 3 MILESTONE 2 — EVIDENCE (milestone decision in report)
Author: (automated benchmark evidence)
Date: 2026-08-14
Spec: `docs/phase3-cpsat-spec.md` Revision 4

## 1. Purpose

Validate the 500-student instance of the solver-service (Approach A oracle vs
Approach C structured model) and benchmark Encoding C vs Encoding D (spec §6.6).

## 2. Method

- Deterministic 500-student dataset built by `solver-service/benchmarks/dataset.py`
  (seeded; no PII). Distribution verified:
  candidates=500, seats=500, halls=5 (LH01–LH05, 5 rows × 20 columns each),
  classes=100 (10 departments × 10 suffixes A–J), departments=10,
  5 students/class, 50 students/department.
- Approaches/encodings and acceptance criteria per spec Revision 4 §6.4:
  **oracle agreement** = same optimal `objectiveValue` AND both independently
  valid (required zeros satisfied, structural validation clean, objective equals
  measured same-department adjacency).
- Statuses follow §5/§16: OPTIMAL / FEASIBLE / INFEASIBLE / ERROR
  (ERROR = solver returned no feasible solution within the configured limit).
- Machine: 8 logical processors, ~23.7 GB RAM. Python 3.14, OR-Tools 9.15.
- Benchmark runs use `num_search_workers=8` (documented benchmark parameter).
  Approach C **production gate** additionally runs with the spec-default
  `num_search_workers=1` (§12, §15) and is reported separately.
- Random seed 42 throughout (spec §12).

## 3. Commands

```text
python benchmarks\benchmark_500.py --time-limit 600 --workers 8 --prod-workers 8     (full suite)
python benchmarks\benchmark_500.py --time-limit 900 --workers 8 --prod-workers 1 --skip-a --skip-encodings
                                                                                      (Approach C production gate)
```

Raw logs: `docs/evidence/phase3-benchmarks/*.log`.

## 4. Results (500 students)

| Model | Encoding | Status | Objective | Duration (ms) | Peak RSS (MB) | Variables | Constraints | Valid |
|---|---|---|---|---|---|---|---|---|
| Approach A (dense oracle) | — | OPTIMAL | 0 | 110,276 | 3,637.5 | — | — | yes |
| Approach C (production, 8w) | D | OPTIMAL | 0 | 46,841 | 1,366.6 | — | — | yes |
| Encoding D (stage-1, benchmark) | D | OPTIMAL | 0 | 42,015 | 1,372.9 | 51,635 | 66,950 | yes |
| Encoding C (integer seat-class) | C | OPTIMAL | 0 | 312,651 | 2,597.3 | 52,635 | 119,085 | yes |
| Approach C (production default, 1w) | D | FEASIBLE | 129 | 903,439 | 373.5 | — | — | yes (not optimal) |

Notes:
- All OPTIMAL solutions achieve objective 0, meaning **zero** same-department and
  zero same-class adjacent pairs (fully separated seating).
- `memoryPeak` = psutil peak RSS of the solver process (real measurement).
- Encoding C reaches the same optimum but is ~7.4× slower than Encoding D
  (312,651 ms vs 42,015 ms) and uses ~1.9× the memory. At a 60 s limit it could
  not even reach feasibility (ERROR); at 600 s it proves OPTIMAL/0.
  At 100 students Encoding C is OPTIMAL/0 and fully valid (correctness at small
  scale established).

## 5. Validation metrics (OPTIMAL runs)

All OPTIMAL runs: candidateCount=500, assignedCount=500, unassignedCount=0,
duplicateCandidateCount=0, duplicateSeatCount=0, sameClassAdjacentCount=0,
sameDepartmentAdjacentCount=0, hallsUsed=5, requiredZeros=true,
structuralErrors=[].

## 6. Oracle agreement (§6.4) — Approach A vs Approach C (benchmark workers)

- Approach A: OPTIMAL, objectiveValue=0
- Approach C: OPTIMAL, objectiveValue=0
- sameOptimalObjectiveValue: YES
- bothIndependentlyValid: YES

**500-student oracle agreement PASSES with benchmark worker configuration
(8 workers).**

## 7. Approach C production gate (spec-default single worker)

Approach C run through the production code path with the spec-default
`num_search_workers=1` returned **FEASIBLE, objectiveValue=129** after 900 s
(no optimality proof within the configured limit; exit code 2 —
GATE_PASSED=NO). With 8 benchmark workers the same production model proves
OPTIMAL/0 in ~47 s.

**Finding:** the single-worker configuration cannot prove optimality for the
500-student instance within 900 s. Per §15 the comparable metric is
`objectiveValue`; the solver is correct (8-worker runs agree with the Approach A
oracle), but production default worker count is a performance blocker for the
500 benchmark gate. This is a config decision reserved for the owner (spec §28
item 10 — worker configuration is a PROPOSED V1 decision).

## 8. Encoding comparison (§6.6): D vs C

| Encoding | Status | Objective | Duration (ms) | Variables | Constraints | Peak RSS (MB) |
|---|---|---|---|---|---|---|
| D (seat-candidate edge) | OPTIMAL | 0 | 42,015 | 51,635 | 66,950 | 1,372.9 |
| C (integer seat-class) | OPTIMAL | 0 | 312,651 | 52,635 | 119,085 | 2,597.3 |

Both encodings reach the same optimum (0) at 500 students. Encoding D is the
clear winner: ~7.4× faster and ~1.9× less memory, with fewer constraints.
Encoding D remains the production encoding (§6.6 decision stands).

## 9. Evidence

- `docs/evidence/phase3-benchmarks/500-full-suite-8w.log` — full suite
  (Approach A, Approach C 8w, Encoding D, Encoding C).
- `docs/evidence/phase3-benchmarks/500-approach-c-production-1w.log` —
  Approach C production gate (single worker).
- `solver-service/benchmarks/dataset.py`, `encoding_c.py`, `benchmark_500.py`.

## 10. Milestone status

The mathematical correctness of the 500-student solver is established
(Approach A and Approach C agree on optimal objective 0 with 8 benchmark
workers, both independently valid). The production single-worker configuration
does not prove optimality within 900 s (FEASIBLE 129) — the 500 oracle
agreement gate cannot be certified under the production default worker
configuration. Reported as an owner decision (spec §28 item 10), not a
correctness defect. See the milestone report for the full decision.
