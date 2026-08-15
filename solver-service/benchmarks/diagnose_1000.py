"""Diagnostic: is objectiveValue consistent with the returned solution at 1000?

Only reads solver values when a solution exists (OPTIMAL/FEASIBLE).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ortools.sat.python import cp_model

from app import assign, solver, validation
from app.config import Settings
from benchmarks.dataset import build_1000_dataset


def main() -> None:
    print("building model...", flush=True)
    request = build_1000_dataset(time_limit_seconds=120)
    settings = Settings(internal_token="diag")
    built = solver.build_stage1(request, encoding=solver.ENCODING_D)
    z, o, edges, seats, keys = built["z"], built["o"], built["edges"], built["seats"], built["keys"]
    key_department = built["key_department"]

    print(f"model built: vars={len(built['model'].Proto().variables)} cons={len(built['model'].Proto().constraints)} edges={len(edges)}", flush=True)
    cp = cp_model.CpSolver()
    cp.parameters.max_time_in_seconds = 120.0
    cp.parameters.random_seed = request.solverConfig.randomSeed
    cp.parameters.num_search_workers = 8
    print("solving...", flush=True)
    status = cp.Solve(built["model"])
    print(f"cp_status={status} ({validation.classify_status(status)})", flush=True)

    if validation.classify_status(status) not in (validation.OPTIMAL, validation.FEASIBLE):
        print("no solution; skipping value consistency checks", flush=True)
        return

    print(f"cp.ObjectiveValue()={cp.ObjectiveValue()}", flush=True)

    s_o = sum(round(cp.Value(o[e])) for e in range(len(edges)))
    print(f"sum(cp.Value(o[e]))={s_o}", flush=True)

    count_solver_graph = 0
    for a, b in edges:
        dA = dB = None
        for k in range(len(keys)):
            if cp.Value(z[(a, k)]) == 1:
                dA = key_department[keys[k]]
                break
        for k in range(len(keys)):
            if cp.Value(z[(b, k)]) == 1:
                dB = key_department[keys[k]]
                break
        if dA and dB and dA == dB:
            count_solver_graph += 1
    print(f"same-dept edges (solver graph, from z values)={count_solver_graph}", flush=True)

    pattern = solver.extract_pattern(cp, z, len(seats), len(keys), keys)
    assignments = assign.assign_candidates(request, seats, pattern)
    report = validation.compute_validation_report(request, assignments)
    print(f"assignedCount={len(assignments)}", flush=True)
    print(f"validator sameDepartmentAdjacentCount={report['sameDepartmentAdjacentCount']}", flush=True)
    print(f"validator sameClassAdjacentCount={report['sameClassAdjacentCount']}", flush=True)

    # recompute o from the extracted pattern directly
    seat_dept = {}
    for s, key in pattern.items():
        seat_dept[s] = key_department[key]
    p_edges = sum(1 for a, b in edges if a in seat_dept and b in seat_dept and seat_dept[a] == seat_dept[b])
    print(f"same-dept edges recomputed from pattern={p_edges}", flush=True)


if __name__ == "__main__":
    main()