"""Approach C — stage-1 CP-SAT seat->class pattern model (Encoding D) plus orchestration.

Production entry point is ``solve_request``. The stage-1 model builds:
  z[s,K] in {0,1}   seat s hosts a class-K occupant
  o[e]   in {0,1}   adjacent seat pair e hosts same-department occupants
with constraints C1-C3 (Encoding D) and the §11 department-mixing objective.
Stage 2 (assign.py) is deterministic and NOT part of CP-SAT.
"""
from __future__ import annotations

import time
from collections import Counter, defaultdict
from typing import Any

from ortools.sat.python import cp_model

from . import constraints as cst
from .assign import assign_candidates
from .models import Assignment, SolveRequest, SolveResponse
from .validation import (
    ERROR,
    FEASIBLE,
    INFEASIBLE,
    INSUFFICIENT_SEATS,
    INTERNAL_ERROR,
    NO_FEASIBLE_ASSIGNMENT,
    OPTIMAL,
    SOLVER_TIMEOUT_NO_SOLUTION,
    build_response,
    classify_status,
    compute_validation_report,
)

ENCODING_D = "D"
ENCODING_B = "B"


def group_key(candidate, scope: str) -> str:
    return candidate.class_ if scope == "class" else candidate.department


def build_stage1(
    request: SolveRequest,
    encoding: str = ENCODING_D,
):
    """Build the Approach C stage-1 model. encoding in {"D", "B"} (B is test-only)."""
    seats = cst.ordered_seats(request)
    edges = cst.build_edges(seats)
    adjacency = cst.neighbors_of(seats, edges)
    deg = cst.degrees(adjacency)
    candidates = cst.ordered_candidates(request)

    scope = request.solverConfig.hardRuleScope
    s_count = len(seats)
    keys = sorted({group_key(c, scope) for c in candidates})
    key_index = {k: i for i, k in enumerate(keys)}
    counts = Counter(group_key(c, scope) for c in candidates)
    departments = sorted({c.department for c in candidates})
    key_department: dict[str, str] = {}
    for c in candidates:
        key_department[group_key(c, scope)] = c.department

    model = cp_model.CpModel()
    z: dict[tuple[int, int], Any] = {}
    for s in range(s_count):
        for k in range(len(keys)):
            z[(s, k)] = model.NewBoolVar(f"z_{s}_{k}")

    # C1 — one class per seat
    for s in range(s_count):
        model.Add(sum(z[(s, k)] for k in range(len(keys))) <= 1)

    # C2 — exact class quotas
    for key, k in key_index.items():
        model.Add(sum(z[(s, k)] for s in range(s_count)) == counts[key])

    # C3 — same-class adjacency, EXACT (Encoding D) or pairwise edge rule (Encoding B)
    for s in range(s_count):
        for k in range(len(keys)):
            if encoding == ENCODING_D:
                model.Add(sum(z[(t, k)] for t in adjacency[s]) + deg[s] * z[(s, k)] <= deg[s])
            else:
                for t in adjacency[s]:
                    model.Add(z[(s, k)] + z[(t, k)] <= 1)

    # objective linking — w[s,d] = sum of z over classes in department d
    o = [model.NewBoolVar(f"o_{e}") for e in range(len(edges))]
    for e, (a, b) in enumerate(edges):
        for d in departments:
            w_a = sum(z[(a, key_index[k])] for k in key_index if key_department[k] == d)
            w_b = sum(z[(b, key_index[k])] for k in key_index if key_department[k] == d)
            model.Add(o[e] >= w_a + w_b - 1)
    model.Minimize(sum(o))

    return {
        "model": model,
        "z": z,
        "o": o,
        "seats": seats,
        "edges": edges,
        "adjacency": adjacency,
        "deg": deg,
        "keys": keys,
        "key_index": key_index,
        "counts": counts,
        "departments": departments,
        "key_department": key_department,
    }


def _configure_solver(request: SolveRequest, settings) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(request.timeLimitSeconds)
    solver.parameters.random_seed = request.solverConfig.randomSeed
    solver.parameters.num_search_workers = (
        request.solverConfig.numSearchWorkers or settings.num_search_workers
    )
    solver.parameters.log_search_progress = settings.log_search_progress
    return solver


def solve_pattern(request: SolveRequest, settings):
    """Solve the stage-1 pattern. Returns (solver, status, model, z, seats, keys)."""
    built = build_stage1(request, encoding=ENCODING_D)
    solver = _configure_solver(request, settings)
    status = solver.Solve(built["model"])
    return (
        solver,
        status,
        built["model"],
        built["z"],
        built["o"],
        built["seats"],
        built["keys"],
        built["key_index"],
    )


def extract_pattern(solver, z, s_count: int, k_count: int, keys: list[str]) -> dict[int, str]:
    pattern: dict[int, str] = {}
    for s in range(s_count):
        for k in range(k_count):
            if solver.Value(z[(s, k)]):
                pattern[s] = keys[k]
                break
    return pattern


def solve_request(request: SolveRequest, settings) -> SolveResponse:
    start = time.perf_counter()

    total_seats = cst.total_active_seats(request)
    candidate_count = len(request.candidates)
    if candidate_count > total_seats:
        return build_response(
            request,
            INFEASIBLE,
            [],
            0.0,
            None,
            infeasibility_reason=INSUFFICIENT_SEATS,
        )

    try:
        solver, status, model, z, o, seats, keys, key_index = solve_pattern(request, settings)
    except Exception:  # defensive: never leak a traceback to callers
        return build_response(
            request,
            ERROR,
            [],
            _elapsed_ms(start),
            None,
            error_code=INTERNAL_ERROR,
            error_message="internal solver failure",
        )

    duration_ms = _elapsed_ms(start)
    status_label = classify_status(status)

    if status_label == INFEASIBLE:
        return build_response(
            request,
            INFEASIBLE,
            [],
            duration_ms,
            None,
            infeasibility_reason=NO_FEASIBLE_ASSIGNMENT,
        )
    if status_label == ERROR:
        return build_response(
            request,
            ERROR,
            [],
            duration_ms,
            None,
            error_code=SOLVER_TIMEOUT_NO_SOLUTION,
            error_message="timed out with no solution; infeasibility unproven",
        )

    pattern = extract_pattern(solver, z, len(seats), len(keys), keys)
    assignments = assign_candidates(request, seats, pattern)

    if status_label == OPTIMAL:
        # objective is tight for proven-optimal solutions
        objective_value = int(round(solver.ObjectiveValue()))
    else:
        # FEASIBLE (timeout): o[e] is only lower-bounded, so solver.ObjectiveValue()
        # may be inflated on non-same-department edges; report the true objective of
        # the returned assignment (§29 pairwise count).
        objective_value = compute_validation_report(request, assignments)["sameDepartmentAdjacentCount"]
    return build_response(request, status_label, assignments, duration_ms, objective_value)


def _elapsed_ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000.0