"""Approach A — dense candidate x seat Boolean matrix.

TEST / VALIDATION ORACLE ONLY. Never imported by the production request path
(app.main / app.solver). Used for the §6.4 100/500 oracle agreement benchmark.
"""
from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from . import constraints as cst
from .models import Assignment, SolveRequest
from .validation import ERROR, INFEASIBLE, classify_status


def solve_dense(request: SolveRequest, settings) -> tuple[str, list[Assignment], int | None]:
    candidates = cst.ordered_candidates(request)
    seats = cst.ordered_seats(request)
    edges = cst.build_edges(seats)

    n = len(candidates)
    s = len(seats)
    classes = sorted({c.class_ for c in candidates})
    departments = sorted({c.department for c in candidates})

    candidates_by_class: dict[str, list[int]] = defaultdict(list)
    candidates_by_department: dict[str, list[int]] = defaultdict(list)
    for i, c in enumerate(candidates):
        candidates_by_class[c.class_].append(i)
        candidates_by_department[c.department].append(i)

    model = cp_model.CpModel()
    x: dict[tuple[int, int], object] = {}
    for i in range(n):
        for j in range(s):
            x[(i, j)] = model.NewBoolVar(f"x_{i}_{j}")

    # C1 — one candidate per seat
    for j in range(s):
        model.Add(sum(x[(i, j)] for i in range(n)) <= 1)

    # H1 — each candidate assigned exactly one seat
    for i in range(n):
        model.Add(sum(x[(i, j)] for j in range(s)) == 1)

    # C3 — same-class edge rule (hard)
    for a, b in edges:
        for k in classes:
            model.Add(
                sum(x[(i, a)] for i in candidates_by_class[k])
                + sum(x[(i, b)] for i in candidates_by_class[k])
                <= 1
            )

    # soft objective — minimize same-department adjacent pairs
    o = [model.NewBoolVar(f"o_{e}") for e in range(len(edges))]
    for e, (a, b) in enumerate(edges):
        for d in departments:
            model.Add(
                o[e]
                >= sum(x[(i, a)] for i in candidates_by_department[d])
                + sum(x[(i, b)] for i in candidates_by_department[d])
                - 1
            )
    model.Minimize(sum(o))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(request.timeLimitSeconds)
    solver.parameters.random_seed = request.solverConfig.randomSeed
    solver.parameters.num_search_workers = request.solverConfig.numSearchWorkers or settings.num_search_workers
    solver.parameters.log_search_progress = settings.log_search_progress

    status = solver.Solve(model)
    label = classify_status(status)
    if label in (INFEASIBLE, ERROR):
        return label, [], None

    assignment: list[int] = [-1] * n
    for i in range(n):
        for j in range(s):
            if solver.Value(x[(i, j)]):
                assignment[i] = j
                break

    assignments = [
        Assignment(
            candidateId=candidates[i].id,
            hallId=seats[assignment[i]].hall_id,
            hallSeatId=seats[assignment[i]].seat_id,
        )
        for i in range(n)
    ]
    return label, assignments, int(round(solver.ObjectiveValue()))
