"""PHASE 3 MILESTONE 3 CLOSE-OUT — 2000-student intermediate memory/runtime validation.

Two purposes (owner prompt):

1. Empirical memory/runtime scaling data point between 1000 and 4000.
2. Independently exercise the FEASIBLE objective-reporting fix (§5.1, Revision 6)
   under a different workload.

Runs ONLY the production path (Approach C, Encoding D) with the production
default configuration on the deterministic 2000-student dataset. Approach A is
NOT run at 2000 (spec §6.4 requires the oracle only at 100/500).

Configuration: num_search_workers=8, random_seed=42, hardRuleScope=class,
Encoding D, 8-neighbourhood, timeLimitSeconds=180 (hard cap — scaling
checkpoint, not an optimality benchmark).

Objective-reporting regression (spec §5.1 / Revision 6):
  - reported objectiveValue == validatorObjectiveValue (required)
  - rawSolverObjectiveValue captured from an identical-configuration
    diagnostic solve; for FEASIBLE it may differ from the validator value
    (that is the known lower-bound reporting defect — acceptable diagnostic).
  - OBJECTIVE_REPORTING_FIX_CHECK = PASS when reported == validator.

Termination classification: OPERATOR_INTERRUPTED / SOLVER_TIMEOUT /
RESOURCE_FAILURE (OOM) / TERMINATION_REASON_UNCERTAIN. Never fabricated.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import solver  # noqa: E402
from app.config import Settings  # noqa: E402
from app.validation import (  # noqa: E402
    ERROR,
    FEASIBLE,
    INFEASIBLE,
    OPTIMAL,
    compute_validation_report,
    required_zeros,
    structural_validation,
)
from benchmarks.dataset import build_2000_dataset, distribution_2000  # noqa: E402


class ResourceSampler:
    def __init__(self) -> None:
        self._proc = None
        self._peak_rss = 0
        self._peak_cpu = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        try:
            import psutil

            self._proc = psutil.Process()
            self._proc.cpu_percent(interval=None)
        except Exception:
            self._proc = None
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            if self._proc is not None:
                try:
                    self._peak_rss = max(self._peak_rss, self._proc.memory_info().rss)
                    self._peak_cpu = max(self._peak_cpu, self._proc.cpu_percent(interval=None))
                except Exception:
                    pass
            self._stop.wait(0.5)

    def stop(self) -> tuple[str, str]:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        if self._peak_rss:
            return f"{self._peak_rss / 1e6:.1f} MB", f"{self._peak_cpu:.1f}%"
        return "not measured", "not measured"


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--time-limit", type=int, default=180, help="hard cap (spec: 180 s max for 2000 checkpoint)")
    args = parser.parse_args()
    time_limit = args.time_limit
    assert time_limit <= 180, "2000 checkpoint is capped at 180 s by owner prompt"

    request = build_2000_dataset(time_limit_seconds=time_limit)
    settings = Settings(internal_token="bench-2000")
    assert settings.num_search_workers == 8, settings.num_search_workers
    dist = distribution_2000()

    print("=== PHASE 3 MILESTONE 3 CLOSE-OUT — 2000-STUDENT PRODUCTION-PATH CHECKPOINT ===")
    print(f"distribution: {json.dumps(dist)}")
    print(
        "config: Approach=C Encoding=D num_search_workers=8 random_seed=42 "
        f"hardRuleScope=class adjacency=8-neighbourhood timeLimitSeconds={time_limit}"
    )

    built = solver.build_stage1(request, encoding=solver.ENCODING_D)
    var_count = len(built["model"].Proto().variables)
    con_count = len(built["model"].Proto().constraints)

    sampler = ResourceSampler()
    sampler.start()
    t0 = time.perf_counter()
    try:
        resp = solver.solve_request(request, settings)
    except KeyboardInterrupt:
        print("TERMINATION = OPERATOR_INTERRUPTED (SIGINT before completion)")
        print("EXIT CODE: 130")
        return 130
    except MemoryError:
        print("TERMINATION = RESOURCE_FAILURE / OOM (MemoryError raised)")
        print("EXIT CODE: 1")
        return 1
    duration_ms = (time.perf_counter() - t0) * 1000.0
    memory, cpu = sampler.stop()

    report = compute_validation_report(request, resp.assignments)
    structural = structural_validation(request, resp.assignments)
    zeros = required_zeros(report)

    validator_objective = report["sameDepartmentAdjacentCount"]
    reported_objective = resp.objectiveValue
    if resp.status in (OPTIMAL, FEASIBLE):
        fix_check = reported_objective == validator_objective
        fix_label = "PASS" if fix_check else "FAIL"
    else:
        fix_check = None
        fix_label = "N/A (no solution produced; status has no assignments)"

    if resp.status == ERROR:
        termination = "SOLVER_TIMEOUT (no solution, infeasibility unproven -> ERROR)"
    elif resp.status == FEASIBLE and duration_ms >= (time_limit * 1000 - 500):
        termination = "SOLVER_TIMEOUT (180 s cap reached, feasible incumbent -> FEASIBLE)"
    elif resp.status == FEASIBLE:
        termination = "FEASIBLE before cap (termination within limit)"
    elif resp.status == OPTIMAL:
        termination = "OPTIMAL (solved before cap)"
    else:
        termination = "TERMINATION_REASON_UNCERTAIN"

    print(f"\nstatus={resp.status}")
    if resp.status in (OPTIMAL, FEASIBLE):
        # Diagnostic solve (identical configuration) to recover CP-SAT's
        # internal ObjectiveValue(), which the production response discards for
        # FEASIBLE (§5.1). For FEASIBLE it may differ from the validator-derived
        # objective — that is the known lower-bound reporting defect (Revision 6).
        from ortools.sat.python import cp_model

        diag_solver, diag_status, *_ = solver.solve_pattern(request, settings)
        if diag_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            raw_objective = int(round(diag_solver.ObjectiveValue()))
        else:
            raw_objective = None
    else:
        raw_objective = None
    print(f"rawSolverObjectiveValue={raw_objective}")
    print(f"validatorObjectiveValue={validator_objective}")
    print(f"reportedObjectiveValue={reported_objective}")
    print(f"objectiveValueReported==validator={fix_check}")
    print(f"OBJECTIVE_REPORTING_FIX_CHECK={fix_label}")
    print(f"termination={termination}")
    print(f"variableCount={var_count}")
    print(f"constraintCount={con_count}")
    print(f"solverDurationMs={int(round(duration_ms))}")
    print(f"memoryPeak={memory}")
    print(f"cpuPeak={cpu}")
    print(f"assignedCount={len(resp.assignments)}")
    print(f"unassignedCount={report['unassignedCount']}")
    print(f"sameClassAdjacentCount={report['sameClassAdjacentCount']}")
    print(f"sameDepartmentAdjacentCount={report['sameDepartmentAdjacentCount']}")
    print(f"structuralErrors={json.dumps(structural)}")
    print(f"candidateCount={dist['candidateCount']}")
    print(f"seatCount={dist['seatCount']}")
    print(f"hallCount={dist['hallCount']}")
    print(f"classCount={dist['classCount']}")
    print(f"departmentCount={dist['departmentCount']}")

    valid = (
        resp.status in (OPTIMAL, FEASIBLE)
        and zeros
        and not structural
        and fix_check
    )

    if resp.status == INFEASIBLE:
        print("\nBENCHMARK = INFEASIBLE (unexpected for this dataset)")
        print("EXIT CODE: 2")
        return 2
    if not valid:
        print(f"\nBENCHMARK = UNEXPECTED (status={resp.status} valid={valid})")
        print("EXIT CODE: 2")
        return 2
    if resp.status == OPTIMAL:
        print("\nBENCHMARK = PASS (OPTIMAL)")
        print("EXIT CODE: 0")
        return 0
    print("\nBENCHMARK = VALID FEASIBLE RESULT")
    print("OPTIMALITY = NOT PROVEN")
    print("EXIT CODE: 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())