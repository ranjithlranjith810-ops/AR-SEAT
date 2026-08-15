"""PHASE 3 MILESTONE 3 — 1000-student production-path benchmark.

Runs ONLY the production path (Approach C, Encoding D) with the production
default configuration on the deterministic 1000-student dataset. The dense
oracle (Approach A) is NOT run at 1000 (spec §6.4 requires the oracle only at
100/500; those gates already passed).

Configuration (spec §12): num_search_workers=8, random_seed=42,
hardRuleScope=class, Encoding D, 8-neighbourhood, timeLimitSeconds=120.

Captures status, objectiveValue, solverDurationMs, peak RSS (psutil), peak
CPU% (psutil), variable/constraint counts, and the full §29 validation report.
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
from benchmarks.dataset import build_1000_dataset, distribution_1000  # noqa: E402


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
    parser.add_argument("--time-limit", type=int, default=120, help="CP-SAT time limit (spec: 120 s for 1000)")
    args = parser.parse_args()
    time_limit = args.time_limit

    request = build_1000_dataset(time_limit_seconds=time_limit)
    settings = Settings(internal_token="bench-1000")
    assert settings.num_search_workers == 8, settings.num_search_workers

    print("=== PHASE 3 MILESTONE 3 — 1000-STUDENT PRODUCTION-PATH BENCHMARK ===")
    print(f"distribution: {json.dumps(distribution_1000())}")
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
    resp = solver.solve_request(request, settings)
    duration_ms = (time.perf_counter() - t0) * 1000.0
    memory, cpu = sampler.stop()

    report = compute_validation_report(request, resp.assignments)
    structural = structural_validation(request, resp.assignments)
    zeros = required_zeros(report)
    valid = (
        resp.status in (OPTIMAL, FEASIBLE)
        and zeros
        and not structural
        and report["sameDepartmentAdjacentCount"] == resp.objectiveValue
    )

    print(f"\nstatus={resp.status}")
    print(f"objectiveValue={resp.objectiveValue}")
    print(f"solverDurationMs={int(round(duration_ms))}")
    print(f"memoryPeak={memory}")
    print(f"cpuPeak={cpu}")
    print(f"variableCount={var_count}")
    print(f"constraintCount={con_count}")
    print(f"assignedCount={len(resp.assignments)}")
    print(f"unassignedCount={report['unassignedCount']}")
    print(f"\nvalidation={json.dumps(report)}")
    print(f"requiredZeros={zeros}")
    print(f"structuralErrors={json.dumps(structural)}")
    print(f"objective==sameDepartmentAdjacentCount={report['sameDepartmentAdjacentCount'] == resp.objectiveValue}")
    print(f"valid={valid}")

    if resp.status == OPTIMAL and valid:
        print("\nBENCHMARK = PASS")
        return 0
    if resp.status == FEASIBLE and valid:
        print("\nBENCHMARK = VALID FEASIBLE RESULT")
        print("OPTIMALITY = NOT PROVEN")
        return 0
    print(f"\nBENCHMARK = UNEXPECTED (status={resp.status} valid={valid})")
    return 2


if __name__ == "__main__":
    sys.exit(main())