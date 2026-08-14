"""PHASE 3 MILESTONE 2 — 500-student validation + encoding benchmark.

Runs, on the same deterministic 500-student dataset:
  1. Approach A (dense) — validation oracle, benchmark workers.
  2. Approach C (structured, Encoding D) — production worker config (Task 4 gate).
  3. Encoding D — stage-1 model via benchmark path (Task 5).
  4. Encoding C (integer seat-class) — benchmark path (Task 5).

For every arrangement the authoritative validity checks are run (§29): required zeros,
structural validation, objective == sameDepartmentAdjacentCount. Memory is measured with
psutil peak RSS of the solver process ("not measured" if psutil is unavailable).
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import constraints as cst
from app import oracle, solver
from app.config import Settings
from app.models import Assignment, SolveRequest
from app.validation import (
    ERROR,
    FEASIBLE,
    INFEASIBLE,
    OPTIMAL,
    classify_status,
    compute_validation_report,
    required_zeros,
    structural_validation,
)
from benchmarks.dataset import build_500_dataset, distribution
from benchmarks.encoding_c import solve_encoding_c


class MemorySampler:
    def __init__(self):
        self._proc = None
        self._peak = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        try:
            import psutil

            self._proc = psutil.Process()
        except Exception:
            self._proc = None
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            if self._proc is not None:
                try:
                    self._peak = max(self._peak, self._proc.memory_info().rss)
                except Exception:
                    pass
            self._stop.wait(0.5)

    def stop(self) -> str:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        return f"{self._peak / 1e6:.1f} MB" if self._peak else "not measured"


def _settings(workers: int, token: str) -> Settings:
    return Settings(internal_token=token, num_search_workers=workers)


def _checks(request: SolveRequest, status: str, assignments: list[Assignment], objective: int | None) -> dict:
    report = compute_validation_report(request, assignments)
    structural = structural_validation(request, assignments)
    valid = (
        status in (OPTIMAL, FEASIBLE)
        and required_zeros(report)
        and not structural
        and (objective is None or report["sameDepartmentAdjacentCount"] == objective)
    )
    return {"report": report, "structuralErrors": structural, "valid": valid}


def run_approach_a(request: SolveRequest, settings: Settings) -> dict:
    sampler = MemorySampler()
    sampler.start()
    t0 = time.perf_counter()
    status, assignments, objective = oracle.solve_dense(request, settings)
    duration_ms = (time.perf_counter() - t0) * 1000.0
    memory = sampler.stop()
    checks = _checks(request, status, assignments, objective)
    return {
        "model": "Approach A (dense oracle)",
        "status": status,
        "objectiveValue": objective,
        "solverDurationMs": int(round(duration_ms)),
        "memoryPeak": memory,
        "assignedCount": len(assignments),
        **checks,
    }


def run_approach_c_production(request: SolveRequest, settings: Settings) -> dict:
    sampler = MemorySampler()
    sampler.start()
    t0 = time.perf_counter()
    resp = solver.solve_request(request, settings)
    duration_ms = (time.perf_counter() - t0) * 1000.0
    memory = sampler.stop()
    checks = _checks(request, resp.status, resp.assignments, resp.objectiveValue)
    return {
        "model": "Approach C (structured, Encoding D, production)",
        "status": resp.status,
        "objectiveValue": resp.objectiveValue,
        "solverDurationMs": int(round(duration_ms)),
        "memoryPeak": memory,
        "assignedCount": len(resp.assignments),
        **checks,
    }


def run_encoding_d(request: SolveRequest, settings: Settings) -> dict:
    built = solver.build_stage1(request, encoding=solver.ENCODING_D)
    var_count = len(built["model"].Proto().variables)
    con_count = len(built["model"].Proto().constraints)
    sampler = MemorySampler()
    sampler.start()
    from ortools.sat.python import cp_model

    cp = cp_model.CpSolver()
    cp.parameters.max_time_in_seconds = float(request.timeLimitSeconds)
    cp.parameters.random_seed = request.solverConfig.randomSeed
    cp.parameters.num_search_workers = request.solverConfig.numSearchWorkers or settings.num_search_workers
    cp.parameters.log_search_progress = settings.log_search_progress
    t0 = time.perf_counter()
    status = cp.Solve(built["model"])
    duration_ms = (time.perf_counter() - t0) * 1000.0
    memory = sampler.stop()
    label = classify_status(status)
    objective = None
    assignments: list[Assignment] = []
    if label in (OPTIMAL, FEASIBLE):
        objective = int(round(cp.ObjectiveValue()))
        pattern = solver.extract_pattern(cp, built["z"], len(built["seats"]), len(built["keys"]), built["keys"])
        from app import assign

        assignments = assign.assign_candidates(request, built["seats"], pattern)
    checks = _checks(request, label, assignments, objective)
    return {
        "model": "Encoding D (stage-1, benchmark path)",
        "encoding": "D",
        "status": label,
        "objectiveValue": objective,
        "solverDurationMs": int(round(duration_ms)),
        "memoryPeak": memory,
        "variableCount": var_count,
        "constraintCount": con_count,
        "assignedCount": len(assignments),
        **checks,
    }


def run_encoding_c(request: SolveRequest, settings: Settings) -> dict:
    sampler = MemorySampler()
    sampler.start()
    t0 = time.perf_counter()
    status, objective, assignments, var_count, con_count = solve_encoding_c(request, settings)
    duration_ms = (time.perf_counter() - t0) * 1000.0
    memory = sampler.stop()
    checks = _checks(request, status, assignments, objective)
    return {
        "model": "Encoding C (integer seat-class)",
        "encoding": "C",
        "status": status,
        "objectiveValue": objective,
        "solverDurationMs": int(round(duration_ms)),
        "memoryPeak": memory,
        "variableCount": var_count,
        "constraintCount": con_count,
        "assignedCount": len(assignments),
        **checks,
    }


def _summary(result: dict) -> str:
    r = result["report"]
    return (
        f"{result['model']}: status={result['status']} objective={result['objectiveValue']} "
        f"durationMs={result['solverDurationMs']} memory={result['memoryPeak']} "
        f"varCount={result.get('variableCount')} conCount={result.get('constraintCount')} "
        f"assigned={result['assignedCount']} sameClassAdj={r['sameClassAdjacentCount']} "
        f"sameDeptAdj={r['sameDepartmentAdjacentCount']} requiredZeros={required_zeros(r)} "
        f"structuralErrors={result['structuralErrors']} valid={result['valid']}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--time-limit", type=int, default=600)
    parser.add_argument("--workers", type=int, default=8, help="benchmark workers (Approach A, Encoding C/D)")
    parser.add_argument("--prod-workers", type=int, default=1, help="Approach C production workers")
    parser.add_argument("--skip-a", action="store_true")
    parser.add_argument("--skip-c-prod", action="store_true")
    parser.add_argument("--skip-encodings", action="store_true")
    args = parser.parse_args()

    request = build_500_dataset(time_limit_seconds=args.time_limit)
    dist = distribution()
    print("=== PHASE 3 MILESTONE 2 — 500-STUDENT BENCHMARK ===")
    print(f"distribution: {json.dumps(dist)}")
    print(f"timeLimitSeconds={args.time_limit} benchmarkWorkers={args.workers} prodWorkers={args.prod_workers}")

    bench_settings = _settings(args.workers, "bench-500")
    prod_settings = _settings(args.prod_workers, "bench-500")

    results: list[dict] = []

    if not args.skip_a:
        result_a = run_approach_a(request, bench_settings)
        results.append(result_a)
        print(f"\n[_SUMMARY] {_summary(result_a)}")

    if not args.skip_c_prod:
        result_c = run_approach_c_production(request, prod_settings)
        results.append(result_c)
        print(f"[_SUMMARY] {_summary(result_c)}")

    if not args.skip_encodings:
        result_d = run_encoding_d(request, bench_settings)
        results.append(result_d)
        print(f"[_SUMMARY] {_summary(result_d)}")

        result_c_enc = run_encoding_c(request, bench_settings)
        results.append(result_c_enc)
        print(f"[_SUMMARY] {_summary(result_c_enc)}")

    # ---- §6.4 oracle agreement ----
    result_a = next((r for r in results if r["model"].startswith("Approach A")), None)
    result_c = next((r for r in results if r["model"].startswith("Approach C")), None)
    a_ok = result_a is not None and result_a["status"] == OPTIMAL
    c_ok = result_c is not None and result_c["status"] == OPTIMAL
    same_objective = a_ok and c_ok and result_a["objectiveValue"] == result_c["objectiveValue"]
    both_valid = result_a is not None and result_c is not None and result_a["valid"] and result_c["valid"]
    print("\n=== ORACLE AGREEMENT (§6.4) ===")
    print(f"Approach A present={result_a is not None} OPTIMAL={a_ok}  Approach C present={result_c is not None} OPTIMAL={c_ok}")
    print(f"sameOptimalObjectiveValue={'YES' if same_objective else 'NO'}  (A={None if result_a is None else result_a['objectiveValue']}, C={None if result_c is None else result_c['objectiveValue']})")
    print(f"bothIndependentlyValid={'YES' if both_valid else 'NO'}")

    print("\n=== ENCODING COMPARISON (§6.6) ===")
    print(f"{'Encoding':<8}{'Status':<10}{'Objective':<10}{'DurationMs':<12}{'Vars':<10}{'Constraints':<12}{'Valid'}")
    for r in results:
        if r.get("encoding"):
            print(
                f"{r['encoding']:<8}{r['status']:<10}{str(r['objectiveValue']):<10}"
                f"{r['solverDurationMs']:<12}{r.get('variableCount', '-'):<10}"
                f"{r.get('constraintCount', '-'):<12}{r['valid']}"
            )

    print("\n=== VALIDATION METRICS ===")
    for r in results:
        print(json.dumps({k: r[k] for k in ("model", "status", "objectiveValue", "solverDurationMs", "memoryPeak", "report", "valid")}))

    gate_passed = same_objective and both_valid
    print(f"\nGATE_PASSED={'YES' if gate_passed else 'NO'}")
    return 0 if gate_passed else 2


if __name__ == "__main__":
    import sys

    sys.exit(main())