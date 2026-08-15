# Phase 3 — CP-SAT Solver Benchmarks: 500-Student Validation & Encoding Comparison

Status: PHASE 3 MILESTONE 2 — COMPLETE / VERIFIED
Author: (automated benchmark evidence)
Date: 2026-08-14
Spec: `docs/phase3-cpsat-spec.md` Revision 5

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