"""Encoding C — integer seat-class model (§6.6).

BENCHMARK / TEST PATH ONLY. Production stays on Encoding D (app/solver.py).

Model:
  seatClass[s] in {0..K}     0 = empty, K = class key index (1-based)
  occupied[s]   = (seatClass[s] != 0)
  C1 one class per seat: inherent.
  C2 exact quotas: AddExactly(seatClass, k, n_k)
  C3 reified inequality per edge: (occupied[s] and occupied[t]) => seatClass[s] != seatClass[t]
  objective: minimize same-department adjacency via o[e] linked to department membership.

Returns (status_label, objective, assignments, variable_count, constraint_count).
"""
from __future__ import annotations

from collections import Counter

from ortools.sat.python import cp_model

from app import assign as assign_mod
from app import constraints as cst
from app.models import SolveRequest
from app.validation import FEASIBLE, INFEASIBLE, OPTIMAL, classify_status


def group_key(candidate, scope: str) -> str:
    return candidate.class_ if scope == "class" else candidate.department


def solve_encoding_c(request: SolveRequest, settings):
    seats = cst.ordered_seats(request)
    edges = cst.build_edges(seats)
    candidates = cst.ordered_candidates(request)

    scope = request.solverConfig.hardRuleScope
    keys = sorted({group_key(c, scope) for c in candidates})
    key_index = {k: i + 1 for i, k in enumerate(keys)}  # 0 = empty
    k_count = len(keys)
    counts = Counter(group_key(c, scope) for c in candidates)
    departments = sorted({c.department for c in candidates})
    key_department: dict[str, str] = {}
    for c in candidates:
        key_department[group_key(c, scope)] = c.department

    s_count = len(seats)
    model = cp_model.CpModel()

    seat_class = [model.NewIntVar(0, k_count, f"seatClass_{s}") for s in range(s_count)]
    occupied = [model.NewBoolVar(f"occupied_{s}") for s in range(s_count)]
    for s in range(s_count):
        model.Add(seat_class[s] != 0).OnlyEnforceIf(occupied[s])
        model.Add(seat_class[s] == 0).OnlyEnforceIf(occupied[s].Not())

    # reified seatClass[s] == k
    eq: dict[tuple[int, str], object] = {}
    for s in range(s_count):
        for key, k in key_index.items():
            eq[(s, key)] = model.NewBoolVar(f"eq_{s}_{key}")
            model.Add(seat_class[s] == k).OnlyEnforceIf(eq[(s, key)])
            model.Add(seat_class[s] != k).OnlyEnforceIf(eq[(s, key)].Not())

    # C2 — exact class quotas: for each key, exactly counts[key] seats hold it
    for key in key_index:
        model.Add(sum(eq[(s, key)] for s in range(s_count)) == counts[key])

    # C3 — (occupied[s] and occupied[t]) => seatClass[s] != seatClass[t]
    for a, b in edges:
        model.Add(seat_class[a] != seat_class[b]).OnlyEnforceIf([occupied[a], occupied[b]])

    # objective — same-department adjacency
    w: dict[tuple[int, str], object] = {}
    for s in range(s_count):
        for d in departments:
            w[(s, d)] = sum(eq[(s, key)] for key in key_index if key_department[key] == d)

    o = [model.NewBoolVar(f"o_{e}") for e in range(len(edges))]
    for e, (a, b) in enumerate(edges):
        for d in departments:
            model.Add(o[e] >= w[(a, d)] + w[(b, d)] - 1)
    model.Minimize(sum(o))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(request.timeLimitSeconds)
    solver.parameters.random_seed = request.solverConfig.randomSeed
    solver.parameters.num_search_workers = request.solverConfig.numSearchWorkers or settings.num_search_workers
    solver.parameters.log_search_progress = settings.log_search_progress
    status = solver.Solve(model)

    label = classify_status(status)
    var_count = len(model.Proto().variables)
    con_count = len(model.Proto().constraints)

    if label not in (OPTIMAL, FEASIBLE):
        return label, None, [], var_count, con_count

    pattern: dict[int, str] = {}
    for s in range(s_count):
        v = solver.Value(seat_class[s])
        if v != 0:
            for key, k in key_index.items():
                if k == v:
                    pattern[s] = key
                    break
    assignments = assign_mod.assign_candidates(request, seats, pattern)
    objective = int(round(solver.ObjectiveValue()))
    return label, objective, assignments, var_count, con_count