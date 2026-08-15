# Phase 3 — CP-SAT Solver Benchmarks: 500/1000/2000 Monolithic Gates & Seat-Label Partitioned Engine (Phase D/E)

Status: MILESTONE 2 — COMPLETE; MILESTONE 3 — VALID FEASIBLE (1000) / 2000 CHECKPOINT — SOLVER TIMEOUT (ERROR); PHASE D EQUIVALENCE — PASS; PHASE E PARTITIONED BUCKETS — ALL OPTIMAL
Author: (automated benchmark evidence)
Date: 2026-08-15
Spec: `docs/phase3-cpsat-spec.md` Revision 7

## 1. Purpose

Validate the 500-student instance of the solver-service (Approach A oracle vs
Approach C structured model, production 8-worker configuration) and benchmark
Encoding C vs Encoding D (spec §6.6).

## 2. Method

- Deterministic 500-student dataset built by `solver-service/benchmarks/dataset.py`
  (seeded; no PII). Distribution verified:
  candidates=500, seats=500, halls=5 (LH01–LH05, 5 rows × 20 columns each),
  classes=100 (10 departments × 10 suffixes A–J), departments=10,
  5 students/class, 50 students/department.
- Approaches/encodings and acceptance criteria per spec Revision 5 §6.4:
  **oracle agreement** = same optimal `objectiveValue` AND both independently
  valid (required zeros satisfied, structural validation clean, objective equals
  measured same-department adjacency).
- Statuses follow §5/§16: OPTIMAL / FEASIBLE / INFEASIBLE / ERROR
  (ERROR = solver returned no feasible solution within the configured limit).
- Machine: 8 logical / 4 physical CPU cores, ~23.7 GB RAM. Python 3.14, OR-Tools 9.15.
- Random seed 42 throughout (spec §12).

## 3. Commands

```text
python benchmarks\benchmark_oracle_agreement.py                                    (100 students, milestone 1)
python benchmarks\benchmark_500.py --time-limit 900 --workers 8 --prod-workers 8 --skip-encodings
                                                                                    (500 production gate)
python benchmarks\benchmark_500.py --time-limit 600 --workers 8 --prod-workers 8    (500 full suite + encodings)
python benchmarks\benchmark_500.py --time-limit 900 --workers 8 --prod-workers 1 --skip-a --skip-encodings
                                                                                    (500 Approach C 1-worker comparison)
```

Raw logs: `docs/evidence/phase3-benchmarks/*.log` (each ends with a literal
`EXIT CODE: N` line).

## 4. Results

### 100 students

| Model | Status | Objective | Duration (ms) | Validity |
|---|---|---|---|---|
| Approach A (dense oracle) | OPTIMAL | 0 | 8,823 | valid |
| Approach C (structured, Encoding D) | OPTIMAL | 0 | 4,008 | valid |

### 500 students

| Model | Encoding | Status | Objective | Duration (ms) | Peak RSS (MB) | Variables | Constraints | Validity |
|---|---|---|---|---|---|---|---|---|
| Approach A (dense oracle) | — | OPTIMAL | 0 | 118,844 | 3,853.5 (ORACLE-ONLY) | — | — | valid |
| Approach C (production, 8 workers) | D | OPTIMAL | 0 | 47,741 | 1,355.5 (PRODUCTION-PATH) | — | — | valid |
| Encoding D (stage-1, benchmark) | D | OPTIMAL | 0 | 42,015 | 1,372.9 | 51,635 | 66,950 | valid |
| Encoding C (integer seat-class) | C | OPTIMAL | 0 | 312,651 | 2,597.3 | 52,635 | 119,085 | valid |
| Approach C, 1 worker (comparison) | D | FEASIBLE | 129 | 903,439 | 373.5 | — | — | valid (not optimal) |

Notes:
- All OPTIMAL solutions achieve objective 0: **zero** same-department and zero
  same-class adjacent pairs.
- **Memory labels are explicit.** Approach A memory is ORACLE-ONLY: the dense
  oracle is benchmark/validation only and is never deployed. Production memory
  sizing must use the Approach C + Encoding D figure (PRODUCTION-PATH).
  1,355–1,373 MB at 500 does **not** prove memory requirements at 4,000 or
  10,000 candidates — those sizes require separate benchmarks.
- The 1-worker row is a **configuration comparison finding**, NOT the production
  result. With the spec-default single worker, Approach C returned FEASIBLE
  objective 129 in ≈903 s and could not prove optimality; with the
  owner-approved production default of 8 workers (spec §12) it proves OPTIMAL 0
  in ≈47 s. Worker count affects runtime and may affect the exact optimal
  arrangement; the correctness comparison is `objectiveValue` plus independent
  validation, not byte-for-byte assignment identity (spec §15).

## 5. Validation metrics (OPTIMAL runs, 500)

All OPTIMAL runs: candidateCount=500, assignedCount=500, unassignedCount=0,
duplicateCandidateCount=0, duplicateSeatCount=0, sameClassAdjacentCount=0,
sameDepartmentAdjacentCount=0 (= objectiveValue), hallsUsed=5,
requiredZeros=true, structuralErrors=[] (every candidate and seat from input,
only active seats used).

## 6. Oracle agreement (§6.4) — 500-student production gate

Production configuration (spec §12): `num_search_workers=8`, Encoding D,
classSnapshot hard rule, departmentSnapshot objective, seed 42, limit 900 s.

- Approach A: OPTIMAL, objectiveValue=0 — independently valid
- Approach C: OPTIMAL, objectiveValue=0 — independently valid
- sameOptimalObjectiveValue: YES
- bothIndependentlyValid: YES

**PHASE 3 MILESTONE 2 500-ORACLE GATE: PASSED.** (Evidence:
`500-production-gate-8w.log`, EXIT CODE: 0.)

## 7. Approach C single-worker finding (configuration comparison, not production)

Approach C through the production code path with `num_search_workers=1`
returned **FEASIBLE, objectiveValue=129** after ≈903 s — optimality unproven
within the limit (EXIT CODE: 2, GATE_PASSED=NO). This finding drove the
owner-approved decision to set the production default to **8 workers**
(spec §12, §28 item 10, Revision 5). The 8-worker production run above proves
OPTIMAL/0 in ≈47 s.

## 8. Encoding comparison (§6.6): D vs C

| Encoding | Status | Objective | Duration (ms) | Variables | Constraints | Peak RSS (MB) |
|---|---|---|---|---|---|---|
| D (seat-candidate edge) | OPTIMAL | 0 | 42,015 | 51,635 | 66,950 | 1,372.9 |
| C (integer seat-class) | OPTIMAL | 0 | 312,651 | 52,635 | 119,085 | 2,597.3 |

Both encodings reach the same optimum (0) at 500 students. Encoding D is the
clear winner: ~7.4× faster and ~1.9× less memory, with fewer constraints.
**Encoding D remains the production encoding** (spec §6.6). Encoding C remains a
benchmark/research alternative only.

## 9. Production host capacity (deployment assumption)

- Measured benchmark host: **8 logical cores, 4 physical cores, 23.7 GB RAM**
  (Windows 11 Home, AMD64).
- The 8-worker production configuration assumes the deployment host provides
  **≥ 8 logical CPU cores**. The measured host satisfies this assumption.
- **The intended production host is not declared in the repository** — no
  deployment manifest declares CPU/RAM. If the production host provides fewer
  than 8 logical cores, the 8-worker performance evidence does not transfer and
  must be re-validated on that host. Recorded as a deployment assumption/risk.
- Production-path memory figure for sizing: **Approach C + Encoding D ≈1.37 GB
  peak RSS at 500**. Approach A's ≈3.85 GB is oracle-only and must not be used
  for production sizing.

## 10. Evidence

- `docs/evidence/phase3-benchmarks/500-production-gate-8w.log` — 500 production
  gate (Approach A + Approach C, 8 workers) — EXIT CODE: 0.
- `docs/evidence/phase3-benchmarks/500-full-suite-8w.log` — full suite
  (Approach A, Approach C 8w, Encoding D, Encoding C) — EXIT CODE: 0.
- `docs/evidence/phase3-benchmarks/500-approach-c-production-1w.log` —
  Approach C single-worker comparison — EXIT CODE: 2.
- `solver-service/benchmarks/dataset.py`, `encoding_c.py`, `benchmark_500.py`,
  `benchmark_oracle_agreement.py`.

## 11. Milestone status

PHASE 3 MILESTONE 2 — COMPLETE / VERIFIED. See milestone report.

## 12. 1000-student production-path gate (Milestone 3)

Production path only (Approach C, Encoding D); the dense oracle (Approach A) is
**not** run at 1000 (spec §6.4 requires the oracle only at 100/500). Config
(spec §12/§25): `num_search_workers=8`, `random_seed=42`, `hardRuleScope=class`,
8-neighbourhood, `timeLimitSeconds=120`. Dataset: 1,000 candidates, 1,000 seats,
10 halls (5 rows × 20 columns), 200 classes (10 departments × suffixes A–T),
5 students/class, 100 students/department.

| Metric | Value |
|---|---|
| Status | FEASIBLE (120 s limit; optimality not proven) |
| objectiveValue | 272 (= measured sameDepartmentAdjacentCount) |
| solverDurationMs | 139,734 |
| Peak RSS | 4,518.9 MB (PRODUCTION-PATH) |
| Peak CPU | 727.0% |
| Variables / Constraints | 203,270 / 233,900 |
| assigned / unassigned | 1,000 / 0 |
| sameClassAdjacent / sameDepartmentAdjacent | 0 / 272 |
| requiredZeros / structuralErrors | true / [] |

Memory note: **4,518.9 MB is the measured peak production-path RSS on the
measured benchmark host** (8 logical / 4 physical cores, 23.7 GB RAM). It is a
measured fact, **not** a defined production memory budget — no deployment
manifest in the repository defines a production memory limit, and no 16 GB
budget is claimed. Approach A oracle memory remains benchmark/validation-only
and is never deployed (§12, spec §37 item 3).

**PHASE 3 MILESTONE 3 — VALID FEASIBLE RESULT / OPTIMALITY NOT PROVEN.**
(Evidence: `1000-production-8w-fixed.log`, EXIT CODE: 0.)

### 12.1 Defect discovered and owner-approved fix

The first 1000 run reported `objectiveValue=488` while the measured
same-department adjacency was **264**. Root cause: the objective variable `o[e]`
is only **lower-bounded** (`o[e] >= w_a + w_b - 1`); in a FEASIBLE (timeout)
solution CP-SAT may leave `o[e]=1` on non-same-department edges, inflating
`solver.ObjectiveValue()`. The bound is tight at OPTIMAL, which is why this never
surfaced at 100/500 (both OPTIMAL). Verified independently by
`solver-service/benchmarks/diagnose_1000.py`: three independent counts
(z-derived, validator, pattern recompute) all agreed on 323 while
`ObjectiveValue()` reported 1335.

Owner-approved **reporting-only fix** (no model change): for FEASIBLE responses,
`solve_request` now reports the objective recomputed from the returned
assignment (§29 pairwise `sameDepartmentAdjacentCount`) instead of
`solver.ObjectiveValue()`; OPTIMAL reporting is unchanged. Re-run: objective
272 == sameDepartmentAdjacentCount 272, valid=True, EXIT CODE: 0.

## 13. Evidence (1000-student gate)

- `docs/evidence/phase3-benchmarks/1000-production-8w-fixed.log` — 1000
  production gate (Approach C, 8 workers, 120 s) — EXIT CODE: 0.
- `docs/evidence/phase3-benchmarks/1000-checkpoint.log` — on-disk checkpoint,
  incl. defect finding and regression records.
- `docs/evidence/phase3-benchmarks/npm-test.log` — Phase 2 regression
  (85 passed / 3 skipped, 12 files passed / 1 skipped).
- Regression: `pytest -q` 46 passed (solver-service); Phase 2 protection: no
  tracked diffs under `prisma/`, `src/`.

## 14. 2000-student intermediate checkpoint (Milestone 3 close-out)

Scaling/validation checkpoint (owner prompt): empirical memory/runtime data point
between 1,000 and 4,000, and an independent exercise of the FEASIBLE
objective-reporting fix (spec §5.1, Revision 6) under a different workload.
Production path only (Approach A NOT run). Config: Approach C, Encoding D,
`num_search_workers=8`, `random_seed=42`, `hardRuleScope=class`,
8-neighbourhood, **`timeLimitSeconds=180` (hard cap, not extended)**. Dataset:
2,000 candidates, 2,000 seats, 20 halls (5×20), 400 classes
(10 departments × 40 suffixes A–Z/AA–AN), 5 students/class, 200 students/dept.

| Metric | Value |
|---|---|
| Status | **ERROR** (SOLVER_TIMEOUT_NO_SOLUTION, spec §16) |
| Termination | SOLVER_TIMEOUT (180 s cap reached, no feasible incumbent; infeasibility unproven) |
| variableCount / constraintCount | 806,540 / 867,800 |
| solverDurationMs | 243,986 (incl. model build; solve ran the full 180 s cap) |
| Peak RSS | 5,541.5 MB (measured, production path) |
| Peak CPU | 104.0% |
| assigned / unassigned | 0 / 2,000 |
| raw / validator / reported objective | None / 0 / None (no solution produced) |
| OBJECTIVE_REPORTING_FIX_CHECK | **N/A** (no solution; not regressed — remains validated by the 1000 gate 272==272) |
| structuralErrors | [] |

**BENCHMARK = UNEXPECTED (status=ERROR), EXIT CODE: 2.**

### 14.1 Interpretation

- This is a **tractability / scaling** finding, **not** a solver/model correctness
  defect: feasible arrangements certainly exist (each class needs only 5
  pairwise-non-adjacent seats), but CP-SAT's global search over the class-scope
  model at 2,000 could not find one within 180 s. This is consistent with spec
  §32/§35: the class-scope hard rule (K = N/5) drives the S×K term
  (~806 k variables / ~868 k constraints at 2,000; ~3.2 M variables estimated at
  4,000). A 4,000 class-scope single-instance attempt is therefore not viable
  within a practical time cap.
- The 180 s cap was **not** extended and the run was **not** restarted, per the
  owner prompt. No OOM/resource failure: peak 5.5 GB on the 23.7 GB measured
  host; clean exit code 2.
- Recommendation for 4,000 (owner decision required; **4,000 NOT started**):
  adopt department-scope (§32) or per-hall decomposition (§30.5) before any
  4,000 attempt; do not change the model without owner approval.

## 15. Evidence (2000-student checkpoint)

- `docs/evidence/phase3-benchmarks/2000-production-8w.log` — 2000 checkpoint
  (Approach C, 8 workers, 180 s) — EXIT CODE: 2.
- `docs/evidence/phase3-benchmarks/2000-checkpoint.log` — on-disk checkpoint,
  incl. owner-approval provenance, interpretation, and regression records.
- `docs/evidence/phase3-benchmarks/git-status.log`, `git-diff-stat.log`,
  `git-diff-name-only.log`, `git-log.log`, `phase3-spec-diff.log` — captured git
  evidence (actual command output).
- `docs/evidence/phase3-benchmarks/npm-test.log` — Phase 2 regression
  (85 passed / 3 skipped, 12 files passed / 1 skipped).
- Regression: `pytest -q` 46 passed; Phase 2 protection: no tracked diffs under
  `prisma/`, `src/`.

## 16. Phase D — Legacy-vs-New Equivalence (seat-label engine)

The owner-approved partitioned seating engine (`app/graph.py`, `app/partition.py`,
`app/guards.py`, `app/seatlabel.py`, spec Revision 7 §39) is validated against the
trusted legacy formulation (Approach C / Encoding D, class scope) on small
deterministic datasets. Equivalence is about **rules and correctness**, not
identical assignments (§40/§41): `legacy.valid == new.valid`, the new assignment
passes the authoritative seat-label validator, and the reported objective equals
the validator objective (§18).

| Size | Legacy status | Legacy obj | New status | New obj | Assigned | New passes validator | Equivalence |
|------|---------------|------------|------------|---------|----------|----------------------|-------------|
| 50   | OPTIMAL       | 0          | OPTIMAL    | 0       | 50       | true                 | true        |
| 100  | OPTIMAL       | 0          | OPTIMAL    | 0       | 100      | true                 | true        |
| 200  | OPTIMAL       | 0          | OPTIMAL    | 0       | 200      | true                 | true        |
| 300  | OPTIMAL       | 0          | OPTIMAL    | 0       | 300      | true                 | true        |

`ALL_EQUIVALENCE_PASS=True`, **PHASE D = PASS**
(`docs/evidence/phase3-benchmarks/phaseD-legacy-vs-seatlabel-50-100-200-300.log`).

## 17. Phase E — Partitioned benchmark buckets (seat-label engine)

Every hall is a connected component; each component is a domain solved
independently by the seat-label model, so the largest single domain in the Phase E
buckets is **one hall (100 candidates / 100 seats)**. Buckets are **Target
Hypothesis** (§49) and now measured. `model_build_ms` / `solve_ms` /
`total_duration_ms` are recorded separately per domain (§43); the 2000-run
instrumentation gap is not repeated.

| Bucket | Domains | Status | Objective | Build ms (Σ) | Solve ms (Σ) | Total ms (Σ) | Vars | Cons | Memory MB | CPU % |
|--------|---------|--------|-----------|--------------|--------------|--------------|------|------|-----------|-------|
| 200    | 2       | OPTIMAL | 0         | 370          | 5 691        | 6 062        | 21 054 | 2 762 | 296.4 | 715.7 |
| 500    | 5       | OPTIMAL | 0         | 869          | 15 603       | 16 471       | 52 635 | 6 905 | 327.8 | 728.2 |
| 800    | 8       | OPTIMAL | 0         | 1 582        | 27 705       | 29 287       | 84 216 | 11 048 | 373.1 | 732.2 |
| 1000   | 10      | OPTIMAL | 0         | 1 801        | 36 801       | 38 602       | 105 270 | 13 810 | 425.4 | 750.6 |

- Every domain OPTIMAL, objective 0 (perfect department separation per domain),
  every candidate seated (`assignedCount == candidateCount`, `unassignedCount == 0`).
- **1,000 vs legacy monolithic 1,000:** 38.6 s total / 425.4 MB / 105,270 vars /
  13,810 cons / OPTIMAL — versus 139.7 s / 4,518.9 MB / 203,270 vars / 233,900
  cons / FEASIBLE (objective 272). The partitioned engine solves each 100-candidate
  domain independently; time and memory scale linearly with domain count, which is
  the architectural path to 4,000+ (sessions × domains), never one monolithic model.
- **Interpretation:** the seat-label `D[s]≠D[j]` reification dominates per-domain
  solve cost (~3–4 s per 100-seat domain on the 8-core host); this is a measured
  fact of the implementation, not a target hypothesis.
- All buckets **PASS** (`docs/evidence/phase3-benchmarks/phaseE-seatlabel-200-500-800-1000.log`).
- Regression: `pytest -q` **80 passed** (46 legacy + 34 new: graph, partition,
  guards, seat-label); `npm test` frozen baseline unchanged (85/3, 12/1).