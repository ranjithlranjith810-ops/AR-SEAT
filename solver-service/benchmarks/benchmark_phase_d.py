"""PHASE D — Legacy-vs-new equivalence validation (§40, §41).

Compares the trusted legacy formulation (Approach C / Encoding D, class scope)
against the new seat-label formulation (DEPARTMENT_ONLY) on small deterministic
datasets. Equivalence is about rules and correctness, not identical assignments:

  legacy.valid == new.valid
  AND new assignment passes the authoritative seat-label validator
  AND new objective complies with the configured policy
  AND reported objective == validator objective (§18)

Small sizes keep both formulations quickly solvable so the comparison is clean.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import solver  # noqa: E402
from app.config import Settings  # noqa: E402
from app.seatlabel import (  # noqa: E402
    OPTIMAL,
    compute_seatlabel_report,
    solve_partitioned,
)
from app.validation import (  # noqa: E402
    ERROR,
    FEASIBLE,
    INFEASIBLE,
    compute_validation_report,
    required_zeros,
    structural_validation,
)
from benchmarks.dataset import build_n_dataset  # noqa: E402

SIZES = [50, 100, 200, 300]
POLICY = "DEPARTMENT_ONLY"


def legacy_valid(request, resp) -> bool:
    if resp.status not in (OPTIMAL, FEASIBLE):
        return False
    report = compute_validation_report(request, resp.assignments)
    return (
        required_zeros(report)
        and not structural_validation(request, resp.assignments)
        and report["sameDepartmentAdjacentCount"] == resp.objectiveValue
    )


def main() -> int:
    settings = Settings(internal_token="phase-d")
    results = []
    all_pass = True

    print("=== PHASE D — LEGACY vs NEW EQUIVALENCE (seat-label DEPARTMENT_ONLY) ===")
    print(f"config: legacy=Approach C/Encoding D class-scope; new=seat-label; policy={POLICY}\n")

    for n in SIZES:
        request = build_n_dataset(n, time_limit_seconds=60)
        legacy_resp = solver.solve_request(request, settings)
        new_resp = solve_partitioned(request, settings)
        legacy_ok = legacy_valid(request, legacy_resp)
        new_ok = new_resp.status in (OPTIMAL, FEASIBLE)

        candidates_by_id = {c.id: c for c in request.candidates}
        from app.graph import PhysicalSeatGraph

        graph = PhysicalSeatGraph.build(request.halls, adjacency=request.solverConfig.adjacency)
        new_report = compute_seatlabel_report(graph, new_resp.assignments, candidates_by_id, POLICY)
        new_passes_validator = (
            new_report["duplicateCandidateCount"] == 0
            and new_report["duplicateSeatCount"] == 0
            and new_report["policyViolationCount"] == 0
            and new_resp.objectiveValue == new_report["sameDepartmentAdjacentCount"]
        )

        row = {
            "size": n,
            "legacyStatus": legacy_resp.status,
            "legacyValid": legacy_ok,
            "legacyObjective": legacy_resp.objectiveValue,
            "legacyAssigned": legacy_resp.assignedCount,
            "newStatus": new_resp.status,
            "newValid": new_ok,
            "newObjective": new_resp.objectiveValue,
            "newAssigned": new_resp.assignedCount,
            "newUnassigned": new_resp.unassignedCount,
            "newPassesValidator": new_passes_validator,
            "sameDepartmentAdjacent": new_report["sameDepartmentAdjacentCount"],
            "policyViolations": new_report["policyViolationCount"],
            "equivalence": legacy_ok and new_ok and new_passes_validator,
        }
        results.append(row)
        all_pass = all_pass and row["equivalence"]
        print(json.dumps(row))

    print(f"\nALL_EQUIVALENCE_PASS={all_pass}")
    if all_pass:
        print("PHASE D = PASS")
        return 0
    print("PHASE D = FAIL")
    return 2


if __name__ == "__main__":
    sys.exit(main())