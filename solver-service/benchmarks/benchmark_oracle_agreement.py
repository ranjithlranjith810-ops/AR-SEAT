"""First benchmark: 100 students / 2 halls — Approach A oracle vs Approach C agreement (§6.4, §25).

The two formulations must agree on the optimal objective value, and both assignments must
independently pass the authoritative validity checks. Candidate-level identity is NOT compared.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import constraints as cst, oracle, solver  # noqa: E402
from app.config import Settings  # noqa: E402
from app.models import SolveRequest  # noqa: E402
from app.validation import (  # noqa: E402
    OPTIMAL,
    compute_validation_report,
    required_zeros,
    structural_validation,
)
from tests.helpers import make_hall, make_request  # noqa: E402

# Benchmark uses 8 search workers to prove optimality quickly. Per §15 the comparable
# metric is objectiveValue (not candidate identity), so workers do not affect the
# correctness gate. Production solve_request keeps num_search_workers=1 (determinism).
SETTINGS = Settings(internal_token="benchmark", num_search_workers=8)


def build_100_dataset() -> SolveRequest:
    departments = ["CSE", "ECE", "EEE", "MECH", "CIVIL"]
    classes = [f"{dept}-{suffix}" for dept in departments for suffix in ["A", "B", "C", "D"]]
    candidates = []
    i = 0
    for cls in classes:
        dept = cls.split("-")[0]
        for _ in range(5):
            candidates.append(
                {
                    "id": f"cand-{i:03d}",
                    "registerNumber": f"REG{i:04d}",
                    "studentName": f"Student {i}",
                    "department": dept,
                    "class": cls,
                    "gender": "MALE" if i % 2 == 0 else "FEMALE",
                    "subjectCode": "CS101",
                    "subjectName": "Programming",
                }
            )
            i += 1
    assert len(candidates) == 100
    halls = [make_hall("hall-1", "LH09", 5, 10, name="LH09"), make_hall("hall-2", "LH13", 5, 10, name="LH13")]
    return SolveRequest(**make_request(candidates, halls, time_limit_seconds=120, request_id="bench-100", exam_id="exam-100"))

def main() -> int:
    request = build_100_dataset()
    print("=== 100-student / 2-hall benchmark (5x10 x 2 = 100 seats, 20 classes x 5) ===")
    print(f"candidateCount={len(request.candidates)}  seatCount={cst.total_active_seats(request)}")

    # ---- Approach C (production path) ----
    t0 = time.perf_counter()
    resp_c = solver.solve_request(request, SETTINGS)
    duration_c = (time.perf_counter() - t0) * 1000.0
    report_c = compute_validation_report(request, resp_c.assignments)
    print("\n--- Approach C (structured, Encoding D) ---")
    print(f"status={resp_c.status} objectiveValue={resp_c.objectiveValue} durationMs={resp_c.solverDurationMs}")
    print(f"validation={json.dumps(report_c)}")
    print(f"requiredZeros={required_zeros(report_c)} structuralErrors={structural_validation(request, resp_c.assignments)}")
    assert resp_c.status == OPTIMAL

    # ---- Approach A (dense oracle, test-only) ----
    t0 = time.perf_counter()
    status_a, assignments_a, objective_a = oracle.solve_dense(request, SETTINGS)
    duration_a = (time.perf_counter() - t0) * 1000.0
    report_a = compute_validation_report(request, assignments_a)
    print("\n--- Approach A (dense oracle) ---")
    print(f"status={status_a} objectiveValue={objective_a} durationMs={int(round(duration_a))}")
    print(f"validation={json.dumps(report_a)}")
    print(f"requiredZeros={required_zeros(report_a)} structuralErrors={structural_validation(request, assignments_a)}")
    assert status_a == OPTIMAL

    # ---- §6.4 agreement checks ----
    print("\n--- Agreement check (§6.4) ---")
    same_objective = resp_c.objectiveValue == objective_a
    print(f"sameOptimalObjectiveValue={same_objective}  (A={objective_a}, C={resp_c.objectiveValue})")
    print(f"sameDepartmentAdjacentCount==objectiveValue: A={report_a['sameDepartmentAdjacentCount'] == objective_a}, "
          f"C={report_c['sameDepartmentAdjacentCount'] == resp_c.objectiveValue}")
    print(f"bothIndependentlyValid: A={required_zeros(report_a)} C={required_zeros(report_c)}")

    if not same_objective:
        print("FAIL: objective mismatch")
        return 1
    if not required_zeros(report_a) or not required_zeros(report_c):
        print("FAIL: required zeros not satisfied")
        return 1
    if report_a["sameDepartmentAdjacentCount"] != objective_a:
        print("FAIL: Approach A objective != sameDepartmentAdjacentCount")
        return 1
    if report_c["sameDepartmentAdjacentCount"] != resp_c.objectiveValue:
        print("FAIL: Approach C objective != sameDepartmentAdjacentCount")
        return 1

    print("\nRESULT: APPROACH A ORACLE AGREES WITH APPROACH C — same optimal objective, both independently valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())