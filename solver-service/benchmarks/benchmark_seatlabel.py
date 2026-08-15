"""PHASE E — seat-label partitioned benchmark buckets (§42, §43).

Runs the new partitioned engine on the deterministic Phase E buckets
(200 / 500 / 800 / 1000). Each bucket's halls are connected components; every
component is a domain solved independently by the seat-label model, so the
biggest single domain is one hall (100 candidates / 100 seats).

Bucket sizes are "Target Hypothesis" (§49): the bucket is the candidate count,
with exactly as many seats; real measured metrics are reported below, not
presumed. model_build_ms / solve_ms / total_duration_ms are recorded separately
per domain (§43) — the 2000-run instrumentation gap is not repeated.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.seatlabel import (  # noqa: E402
    ERROR,
    FEASIBLE,
    OPTIMAL,
    partitioned_detail,
)
from benchmarks.benchmark_1000 import ResourceSampler  # noqa: E402
from benchmarks.dataset import (  # noqa: E402
    build_1000_dataset,
    build_200_dataset,
    build_500_dataset,
    build_800_dataset,
    distribution,
    distribution_1000,
    distribution_200,
    distribution_800,
)

BUCKETS = [
    (200, build_200_dataset, distribution_200),
    (500, build_500_dataset, distribution),
    (800, build_800_dataset, distribution_800),
    (1000, build_1000_dataset, distribution_1000),
]
PER_DOMAIN_TIME_LIMIT = 60


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", default="200,500,800,1000", help="comma-separated bucket sizes")
    args = parser.parse_args()
    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]

    settings = Settings(internal_token="phase-e", num_search_workers=8)
    exit_code = 0

    for size in sizes:
        builder = {b[0]: b[1] for b in BUCKETS}
        dist_fn = {b[0]: b[2] for b in BUCKETS}
        if size not in builder:
            print(f"SKIP size {size}: not in buckets 200/500/800/1000")
            continue
        request = builder[size](time_limit_seconds=PER_DOMAIN_TIME_LIMIT)
        dist = dist_fn[size]()

        print(f"\n=== PHASE E — {size}-STUDENT SEAT-LABEL PARTITIONED BENCHMARK ===")
        print(f"distribution: {json.dumps(dist)}")
        print(
            "config: engine=seat-label policy=DEPARTMENT_ONLY adjacency=eight "
            f"num_search_workers=8 random_seed=42 perDomainTimeLimitSeconds={PER_DOMAIN_TIME_LIMIT}"
        )

        sampler = ResourceSampler()
        sampler.start()
        t0 = time.perf_counter()
        detail = partitioned_detail(request, settings)
        wall_ms = (time.perf_counter() - t0) * 1000.0
        memory, cpu = sampler.stop()
        resp = detail["response"]
        domains = detail["domains"]

        var_count = sum(d["variable_count"] for d in domains)
        con_count = sum(d["constraint_count"] for d in domains)
        total_build = detail.get("total_build_ms", 0.0)
        total_solve = detail.get("total_solve_ms", 0.0)
        total_duration = detail.get("total_duration_ms", resp.solverDurationMs)
        report = detail.get("aggregate_report") or {}

        valid = resp.status in (OPTIMAL, FEASIBLE) and (
            not report or report.get("policyViolationCount", 0) == 0
        )

        print(f"status={resp.status}")
        print(f"objective={resp.objectiveValue}")
        print(f"validatorObjective={report.get('sameDepartmentAdjacentCount')}")
        print(f"modelBuildMs={round(total_build, 1)} (sum over domains)")
        print(f"solveMs={round(total_solve, 1)} (sum over domains)")
        print(f"totalDurationMs={round(total_duration, 1)} (sum over domains)")
        print(f"wallClockMs={int(round(wall_ms))}")
        print(f"variableCount={var_count}")
        print(f"constraintCount={con_count}")
        print(f"assignedCount={resp.assignedCount}")
        print(f"unassignedCount={resp.unassignedCount}")
        print(f"memoryPeak={memory}")
        print(f"cpuPeak={cpu}")
        print(f"numSearchWorkers=8")
        print(f"randomSeed=42")
        print(f"timeLimitSeconds={PER_DOMAIN_TIME_LIMIT}")
        print(f"domainCount={len(domains)}")
        print(f"largestDomainCandidates={max((d['candidate_count'] for d in domains), default=0)}")
        print(f"valid={valid}")

        if domains:
            print("\ndomains:")
            for d in domains:
                print(
                    f"  {d['domain_id']} candidates={d['candidate_count']} seats={d['seat_count']} "
                    f"status={d['status']} objective={d['objective']} "
                    f"buildMs={d['model_build_ms']} solveMs={d['solve_ms']} "
                    f"vars={d['variable_count']} cons={d['constraint_count']} "
                    f"assigned={d['assigned_count']} unassigned={d['unassigned_count']}"
                )

        if resp.status == OPTIMAL and valid:
            print("\nBUCKET = PASS (all domains OPTIMAL)")
        elif resp.status in (OPTIMAL, FEASIBLE) and valid:
            print("\nBUCKET = VALID FEASIBLE RESULT")
            print("OPTIMALITY = NOT PROVEN")
        else:
            print(f"\nBUCKET = UNEXPECTED (status={resp.status} valid={valid})")
            exit_code = 2

    print(f"\nPHASE E EXIT CODE = {exit_code}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())