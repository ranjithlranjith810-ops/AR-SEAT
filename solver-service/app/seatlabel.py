"""Phase C — Seat-label channeling formulation (§12, §13, §14, §15, §16, §17).

Per-domain CP-SAT model:
  X[c,s] in {0,1}        candidate c seated at seat s
  O[s] = sum_c X[c,s]    seat occupancy
  D[s] in 1..|depts|     department label of seat s (0 = EMPTY sentinel)
  Y[s] in 1..|years|     year label of seat s (0 = EMPTY sentinel)
  K[s] in 1..|cohorts|   cohort label of seat s (0 = EMPTY sentinel)

Channeling is enforced by linear weighted sums (EMPTY sentinel index 0):
  D[s] = sum_c X[c,s] * deptIndex(c)   (and Y/K likewise)

Anti-adjacency is REIFIED ON OCCUPANCY (never blind label inequality):
  both occupied => rule per policy mode
  DEPARTMENT_ONLY      : D[s1] != D[s2]
  STRICT_DEPT_OR_YEAR  : D[s1] != D[s2] AND Y[s1] != Y[s2]
  COHORT               : K[s1] != K[s2]

Objective (soft, §11-compatible): minimize the number of adjacent occupied
same-department seat pairs. Under DEPARTMENT_ONLY / STRICT_DEPT_OR_YEAR this is
forced to zero by the hard policy; under COHORT it minimises residual
same-department pairs. Target complexity O(|S| x |C| + |A|).

§18 objective reporting: OPTIMAL reports the solver objective subject to
validator agreement; FEASIBLE recomputes from the returned assignment via the
authoritative validator. A mismatch is reported, never silently patched.
"""
from __future__ import annotations

import time
from typing import Any, Optional

from ortools.sat.python import cp_model

from .graph import PhysicalSeatGraph, SeatNode
from .guards import (
    ERR_DOMAIN_COMPOSITION_IMBALANCE,
    ERR_INSUFFICIENT_DOMAIN_CAPACITY,
    compute_composition_report,
)
from .models import Assignment, Candidate, SolveRequest, SolveResponse
from .partition import ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT, partition_request
from .validation import (
    ERROR,
    FEASIBLE,
    INFEASIBLE,
    OPTIMAL,
    SOLVER_TIMEOUT_NO_SOLUTION,
    build_response,
    classify_status,
)

POLICY_DEPARTMENT_ONLY = "DEPARTMENT_ONLY"
POLICY_STRICT_DEPT_OR_YEAR = "STRICT_DEPT_OR_YEAR"
POLICY_COHORT = "COHORT"

ERR_INVALID_POLICY_CONFIGURATION = "ERR_INVALID_POLICY_CONFIGURATION"
ERR_VALIDATOR_MISMATCH = "ERR_VALIDATOR_MISMATCH"
ERR_INVALID_ASSIGNMENT = "ERR_INVALID_ASSIGNMENT"

MAX_DOMAIN_CANDIDATES = 1000


def build_seatlabel_model(
    seats: list[SeatNode],
    edge_pairs: list[tuple[int, int]],
    candidates: list[Candidate],
    policy: str,
):
    """Build the seat-label model for ONE domain. Returns solver-side artifacts."""
    s_count = len(seats)
    c_list = sorted(candidates, key=lambda c: (c.department, c.registerNumber, c.id))

    departments = sorted({c.department for c in c_list})
    dept_index = {d: i + 1 for i, d in enumerate(departments)}
    years_all = sorted({c.year for c in c_list if c.year is not None})
    year_index = {y: i + 1 for i, y in enumerate(years_all)}
    cohorts_all = sorted({(c.department, c.year) for c in c_list if c.year is not None})
    cohort_index = {co: i + 1 for i, co in enumerate(cohorts_all)}

    if policy in (POLICY_STRICT_DEPT_OR_YEAR, POLICY_COHORT) and not years_all:
        raise ValueError(
            f"{ERR_INVALID_POLICY_CONFIGURATION}: policy {policy} requires "
            "candidates with a 'year' attribute; none present"
        )

    model = cp_model.CpModel()
    X: list[list[Any]] = [
        [model.NewBoolVar(f"X_{s}_{ci}") for ci in range(len(c_list))] for s in range(s_count)
    ]
    O = [model.NewBoolVar(f"O_{s}") for s in range(s_count)]
    D = [model.NewIntVar(0, len(departments), f"D_{s}") for s in range(s_count)]
    Y = (
        [model.NewIntVar(0, len(years_all), f"Y_{s}") for s in range(s_count)]
        if years_all
        else None
    )
    K = (
        [model.NewIntVar(0, len(cohorts_all), f"K_{s}") for s in range(s_count)]
        if cohorts_all
        else None
    )

    # one candidate per seat; occupancy
    for s in range(s_count):
        model.Add(sum(X[s]) <= 1)
        model.Add(O[s] == sum(X[s]))
    # one seat per candidate (all domain candidates MUST be seated; the
    # composition guard guarantees capacity before CP-SAT is invoked)
    for ci in range(len(c_list)):
        model.Add(sum(X[s][ci] for s in range(s_count)) == 1)

    # channeling via linear weighted sums (EMPTY sentinel index 0)
    for s in range(s_count):
        model.Add(
            D[s]
            == sum(X[s][ci] * dept_index[c_list[ci].department] for ci in range(len(c_list)))
        )
        if Y is not None:
            model.Add(
                Y[s]
                == sum(X[s][ci] * year_index[c_list[ci].year] for ci in range(len(c_list)))
            )
        if K is not None:
            model.Add(
                K[s]
                == sum(
                    X[s][ci] * cohort_index[(c_list[ci].department, c_list[ci].year)]
                    for ci in range(len(c_list))
                )
            )

    # anti-adjacency reified on occupancy
    viol: list[Any] = []
    for e, (i, j) in enumerate(edge_pairs):
        occupied = [O[i], O[j]]
        if policy == POLICY_DEPARTMENT_ONLY:
            model.Add(D[i] != D[j]).OnlyEnforceIf(occupied)
        elif policy == POLICY_STRICT_DEPT_OR_YEAR:
            model.Add(D[i] != D[j]).OnlyEnforceIf(occupied)
            model.Add(Y[i] != Y[j]).OnlyEnforceIf(occupied)
        else:  # POLICY_COHORT
            model.Add(K[i] != K[j]).OnlyEnforceIf(occupied)

        # soft objective: adjacent occupied same-department pair
        v = model.NewBoolVar(f"viol_{e}")
        model.Add(D[i] == D[j]).OnlyEnforceIf(occupied + [v])
        model.Add(D[i] != D[j]).OnlyEnforceIf(occupied + [v.Not()])
        viol.append(v)
    model.Minimize(sum(viol))

    return {
        "model": model,
        "X": X,
        "O": O,
        "D": D,
        "Y": Y,
        "K": K,
        "viol": viol,
        "candidates": c_list,
        "seats": seats,
        "edge_pairs": edge_pairs,
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


def extract_assignments(built: dict) -> list[Assignment]:
    solver = built["solver"]
    X = built["X"]
    seats = built["seats"]
    c_list = built["candidates"]
    assignments: list[Assignment] = []
    for s in range(len(seats)):
        for ci in range(len(c_list)):
            if solver.Value(X[s][ci]):
                assignments.append(
                    Assignment(
                        candidateId=c_list[ci].id,
                        hallId=seats[s].hall_id,
                        hallSeatId=seats[s].seat_id,
                    )
                )
                break
    return assignments


def compute_seatlabel_report(
    graph: PhysicalSeatGraph,
    assignments: list[Assignment],
    candidates_by_id: dict[str, Candidate],
    policy: str,
) -> dict:
    """§19 — authoritative pairwise validation over the configured physical graph.

    Counts are computed over the graph's adjacency edges (which encode the
    configured adjacency mode), never via any CP-SAT neighbourhood sum.
    """
    occupant: dict[int, Candidate] = {}
    seen_candidates: set[str] = set()
    seen_seats: set[str] = set()
    duplicate_candidate_count = 0
    duplicate_seat_count = 0
    seat_index = {n.seat_id: i for i, n in enumerate(graph.nodes)}
    halls_used: set[str] = set()

    for a in assignments:
        if a.candidateId in seen_candidates:
            duplicate_candidate_count += 1
        seen_candidates.add(a.candidateId)
        if a.hallSeatId in seen_seats:
            duplicate_seat_count += 1
        seen_seats.add(a.hallSeatId)
        halls_used.add(a.hallId)
        idx = seat_index.get(a.hallSeatId)
        if idx is not None:
            occupant[idx] = candidates_by_id.get(a.candidateId)

    same_department_adjacent = 0
    same_year_adjacent = 0
    same_cohort_adjacent = 0
    policy_violations: list[str] = []
    for i, j in graph.edges:
        ca = occupant.get(i)
        cb = occupant.get(j)
        if ca is None or cb is None:
            continue
        same_dept = ca.department == cb.department
        same_year = ca.year is not None and cb.year is not None and ca.year == cb.year
        same_cohort = same_dept and same_year
        if same_dept:
            same_department_adjacent += 1
        if same_year:
            same_year_adjacent += 1
        if same_cohort:
            same_cohort_adjacent += 1
        if policy == POLICY_DEPARTMENT_ONLY and same_dept:
            policy_violations.append(
                f"{graph.nodes[i].seat_id} <-> {graph.nodes[j].seat_id}: same department {ca.department}"
            )
        elif policy == POLICY_STRICT_DEPT_OR_YEAR and (same_dept or same_year):
            policy_violations.append(
                f"{graph.nodes[i].seat_id} <-> {graph.nodes[j].seat_id}: "
                f"{'same department' if same_dept else ''} "
                f"{'same year' if same_year else ''}".strip()
            )
        elif policy == POLICY_COHORT and same_cohort:
            policy_violations.append(
                f"{graph.nodes[i].seat_id} <-> {graph.nodes[j].seat_id}: same cohort {ca.department}/{ca.year}"
            )

    return {
        "candidateCount": len(candidates_by_id),
        "assignedCount": len(assignments),
        "unassignedCount": len(candidates_by_id) - len(assignments),
        "duplicateCandidateCount": duplicate_candidate_count,
        "duplicateSeatCount": duplicate_seat_count,
        "sameDepartmentAdjacentCount": same_department_adjacent,
        "sameYearAdjacentCount": same_year_adjacent,
        "sameCohortAdjacentCount": same_cohort_adjacent,
        "policyViolationCount": len(policy_violations),
        "policyViolations": policy_violations,
        "hallsUsed": len(halls_used),
    }


def _solve_domain(
    request: SolveRequest,
    settings,
    graph: PhysicalSeatGraph,
    domain_seats: list[SeatNode],
    domain_candidates: list[Candidate],
) -> dict:
    """Build + solve the seat-label model for one domain. Returns a result dict."""
    start = time.perf_counter()
    policy = request.solverConfig.policyMode
    if not domain_candidates:
        return {
            "status": OPTIMAL,
            "assignments": [],
            "objective": 0,
            "durationMs": 0.0,
            "modelBuildMs": 0.0,
            "solveMs": 0.0,
            "variableCount": 0,
            "constraintCount": 0,
            "errorCode": None,
            "errorMessage": None,
        }

    local_index = {n.index: k for k, n in enumerate(domain_seats)}
    edge_pairs = [
        (local_index[i], local_index[j])
        for i, j in graph.edges
        if i in local_index and j in local_index
    ]

    try:
        built = build_seatlabel_model(domain_seats, edge_pairs, domain_candidates, policy)
    except ValueError as exc:
        return {
            "status": ERROR,
            "assignments": [],
            "objective": None,
            "durationMs": 0.0,
            "modelBuildMs": 0.0,
            "solveMs": 0.0,
            "variableCount": 0,
            "constraintCount": 0,
            "errorCode": ERR_INVALID_POLICY_CONFIGURATION,
            "errorMessage": str(exc),
        }

    model_build_ms = (time.perf_counter() - start) * 1000.0
    solver = _configure_solver(request, settings)
    solve_start = time.perf_counter()
    cp_status = solver.Solve(built["model"])
    solve_ms = (time.perf_counter() - solve_start) * 1000.0
    built["solver"] = solver
    duration_ms = (time.perf_counter() - start) * 1000.0
    status_label = classify_status(cp_status)

    proto = built["model"].Proto()
    var_count = len(proto.variables)
    con_count = len(proto.constraints)

    if status_label == INFEASIBLE:
        return {
            "status": INFEASIBLE,
            "assignments": [],
            "objective": None,
            "durationMs": duration_ms,
            "modelBuildMs": model_build_ms,
            "solveMs": solve_ms,
            "variableCount": var_count,
            "constraintCount": con_count,
            "errorCode": None,
            "errorMessage": "no feasible assignment",
        }
    if status_label == ERROR:
        return {
            "status": ERROR,
            "assignments": [],
            "objective": None,
            "durationMs": duration_ms,
            "modelBuildMs": model_build_ms,
            "solveMs": solve_ms,
            "variableCount": var_count,
            "constraintCount": con_count,
            "errorCode": SOLVER_TIMEOUT_NO_SOLUTION,
            "errorMessage": "timed out with no solution; infeasibility unproven",
        }

    assignments = extract_assignments(built)
    candidates_by_id = {c.id: c for c in domain_candidates}
    report = compute_seatlabel_report(graph, assignments, candidates_by_id, policy)

    if report["duplicateCandidateCount"] or report["duplicateSeatCount"] or report["policyViolationCount"]:
        return {
            "status": ERROR,
            "assignments": [],
            "objective": None,
            "durationMs": duration_ms,
            "modelBuildMs": model_build_ms,
            "solveMs": solve_ms,
            "variableCount": var_count,
            "constraintCount": con_count,
            "errorCode": ERR_INVALID_ASSIGNMENT,
            "errorMessage": "; ".join(report["policyViolations"] or ["invalid assignment"]),
        }

    validator_objective = report["sameDepartmentAdjacentCount"]
    if status_label == OPTIMAL:
        objective_value = int(round(solver.ObjectiveValue()))
        if objective_value != validator_objective:
            return {
                "status": ERROR,
                "assignments": [],
                "objective": None,
                "durationMs": duration_ms,
                "modelBuildMs": model_build_ms,
                "solveMs": solve_ms,
                "variableCount": var_count,
                "constraintCount": con_count,
                "errorCode": ERR_VALIDATOR_MISMATCH,
                "errorMessage": (
                    f"reported objective {objective_value} != validator objective "
                    f"{validator_objective}"
                ),
            }
    else:
        # FEASIBLE (§18): recompute from the returned assignment via the validator
        objective_value = validator_objective

    return {
        "status": status_label,
        "assignments": assignments,
        "objective": objective_value,
        "durationMs": duration_ms,
        "modelBuildMs": model_build_ms,
        "solveMs": solve_ms,
        "variableCount": var_count,
        "constraintCount": con_count,
        "errorCode": None,
        "errorMessage": None,
        "report": report,
        "validatorObjective": validator_objective,
    }


def _graph_and_partition(request: SolveRequest):
    graph = PhysicalSeatGraph.build(request.halls, adjacency=request.solverConfig.adjacency)
    partition = partition_request(
        request.candidates, graph, max_domain_candidates=MAX_DOMAIN_CANDIDATES
    )
    return graph, partition


def solve_domain(request: SolveRequest, settings) -> SolveResponse:
    """Solve a single connected domain. Rejects multi-component requests.

    The solver service solves ONE physical domain per call; splitting a request
    that spans multiple disconnected components is the orchestrator's job (§11.1).
    """
    start = time.perf_counter()
    try:
        graph, partition = _graph_and_partition(request)
    except ValueError as exc:
        return build_response(
            request,
            ERROR,
            [],
            _elapsed_ms(start),
            None,
            error_code=ERR_INVALID_POLICY_CONFIGURATION,
            error_message=str(exc),
        )

    if len(partition.domains) != 1:
        return build_response(
            request,
            ERROR,
            [],
            _elapsed_ms(start),
            None,
            error_code="ERR_INVALID_DOMAIN_ASSIGNMENT",
            error_message=(
                f"request spans {len(partition.domains)} disconnected components; "
                "solver service solves one domain per request"
            ),
        )

    domain = partition.domains[0]
    if partition.oversized:
        return build_response(
            request,
            ERROR,
            [],
            _elapsed_ms(start),
            None,
            error_code=ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT,
            error_message=(
                f"domain {domain.domain_id} candidates={domain.candidate_count} "
                f"exceeds ceiling {MAX_DOMAIN_CANDIDATES}"
            ),
        )

    domain_candidates = [c for c in request.candidates if c.id in set(domain.candidate_ids)]
    composition = compute_composition_report(domain_candidates, domain.seat_count)
    if composition.classification == "INSUFFICIENT_CAPACITY":
        return build_response(
            request, INFEASIBLE, [], _elapsed_ms(start), None,
            infeasibility_reason=ERR_INSUFFICIENT_DOMAIN_CAPACITY,
        )
    if (
        composition.classification == "IMBALANCE_RISK"
        and request.solverConfig.compositionAction == "reject"
    ):
        return build_response(
            request, ERROR, [], _elapsed_ms(start), None,
            error_code=ERR_DOMAIN_COMPOSITION_IMBALANCE,
            error_message="; ".join(composition.risk_violations),
        )

    domain_seats = [graph.nodes[i] for i in domain.seat_indices]
    result = _solve_domain(request, settings, graph, domain_seats, domain_candidates)
    return _domain_response(request, result, _elapsed_ms(start))


def solve_partitioned(request: SolveRequest, settings) -> SolveResponse:
    """§30 full pipeline: graph -> components -> ceiling -> composition -> per-domain
    solve -> aggregate -> validate. Used for multi-hall requests (benchmarks).
    """
    start = time.perf_counter()
    try:
        graph, partition = _graph_and_partition(request)
    except ValueError as exc:
        return build_response(
            request,
            ERROR,
            [],
            _elapsed_ms(start),
            None,
            error_code=ERR_INVALID_POLICY_CONFIGURATION,
            error_message=str(exc),
        )

    if partition.oversized:
        d = partition.oversized[0]
        return build_response(
            request,
            ERROR,
            [],
            _elapsed_ms(start),
            None,
            error_code=ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT,
            error_message=(
                f"domain {d.domain_id} candidates={d.candidate_count} exceeds "
                f"ceiling {MAX_DOMAIN_CANDIDATES}"
            ),
        )

    candidates_by_id = {c.id: c for c in request.candidates}
    all_assignments: list[Assignment] = []
    total_ms = 0.0
    aggregate_status = OPTIMAL
    failure: Optional[tuple[bool, str, str]] = None  # (is_infeasible, code, message)

    for domain in partition.domains:
        domain_candidates = [
            candidates_by_id[cid] for cid in domain.candidate_ids if cid in candidates_by_id
        ]
        composition = compute_composition_report(domain_candidates, domain.seat_count)
        if composition.classification == "INSUFFICIENT_CAPACITY":
            failure = (True, ERR_INSUFFICIENT_DOMAIN_CAPACITY, f"domain {domain.domain_id} candidates > seats")
            break
        if (
            composition.classification == "IMBALANCE_RISK"
            and request.solverConfig.compositionAction == "reject"
        ):
            failure = (False, ERR_DOMAIN_COMPOSITION_IMBALANCE, "; ".join(composition.risk_violations))
            break

        domain_seats = [graph.nodes[i] for i in domain.seat_indices]
        result = _solve_domain(request, settings, graph, domain_seats, domain_candidates)
        total_ms += result["durationMs"]
        all_assignments.extend(result["assignments"])
        if result["status"] != OPTIMAL:
            aggregate_status = result["status"]
        if result["status"] in (ERROR, INFEASIBLE) and failure is None:
            failure = (
                result["status"] == INFEASIBLE,
                result["errorCode"] or "NO_FEASIBLE_ASSIGNMENT",
                result["errorMessage"],
            )

    if failure is not None:
        is_infeasible, code, message = failure
        if is_infeasible:
            return build_response(
                request, INFEASIBLE, [], total_ms, None,
                infeasibility_reason=code, error_message=message,
            )
        return build_response(
            request, ERROR, [], total_ms, None, error_code=code, error_message=message
        )

    report = compute_seatlabel_report(
        graph, all_assignments, candidates_by_id, request.solverConfig.policyMode
    )
    if report["duplicateCandidateCount"] or report["duplicateSeatCount"] or report["policyViolationCount"]:
        return build_response(
            request,
            ERROR,
            [],
            total_ms,
            None,
            error_code=ERR_INVALID_ASSIGNMENT,
            error_message="; ".join(report["policyViolations"] or ["invalid aggregate assignment"]),
        )

    objective = report["sameDepartmentAdjacentCount"]
    return build_response(request, aggregate_status, all_assignments, total_ms, objective)


def partitioned_detail(request: SolveRequest, settings) -> dict:
    """§30 pipeline returning (response, per-domain results, graph, partition) for
    benchmarking — model_build_ms / solve_ms / variable / constraint per domain."""
    start = time.perf_counter()
    try:
        graph, partition = _graph_and_partition(request)
    except ValueError as exc:
        return {
            "response": build_response(
                request, ERROR, [], _elapsed_ms(start), None,
                error_code=ERR_INVALID_POLICY_CONFIGURATION, error_message=str(exc),
            ),
            "domains": [],
            "graph": None,
            "partition": None,
        }

    if partition.oversized:
        d = partition.oversized[0]
        return {
            "response": build_response(
                request, ERROR, [], _elapsed_ms(start), None,
                error_code=ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT,
                error_message=(
                    f"domain {d.domain_id} candidates={d.candidate_count} exceeds "
                    f"ceiling {MAX_DOMAIN_CANDIDATES}"
                ),
            ),
            "domains": [],
            "graph": graph,
            "partition": partition,
        }

    candidates_by_id = {c.id: c for c in request.candidates}
    all_assignments: list[Assignment] = []
    total_ms = 0.0
    total_build_ms = 0.0
    total_solve_ms = 0.0
    aggregate_status = OPTIMAL
    domain_results: list[dict] = []
    failure: Optional[tuple[bool, str, str]] = None

    for domain in partition.domains:
        domain_candidates = [
            candidates_by_id[cid] for cid in domain.candidate_ids if cid in candidates_by_id
        ]
        composition = compute_composition_report(domain_candidates, domain.seat_count)
        if composition.classification == "INSUFFICIENT_CAPACITY":
            failure = (True, ERR_INSUFFICIENT_DOMAIN_CAPACITY, f"domain {domain.domain_id} candidates > seats")
            break
        if (
            composition.classification == "IMBALANCE_RISK"
            and request.solverConfig.compositionAction == "reject"
        ):
            failure = (False, ERR_DOMAIN_COMPOSITION_IMBALANCE, "; ".join(composition.risk_violations))
            break

        domain_seats = [graph.nodes[i] for i in domain.seat_indices]
        result = _solve_domain(request, settings, graph, domain_seats, domain_candidates)
        domain_results.append(
            {
                "domain_id": domain.domain_id,
                "candidate_count": len(domain_candidates),
                "seat_count": len(domain_seats),
                "status": result["status"],
                "objective": result["objective"],
                "model_build_ms": round(result["modelBuildMs"], 1),
                "solve_ms": round(result["solveMs"], 1),
                "total_duration_ms": round(result["durationMs"], 1),
                "variable_count": result["variableCount"],
                "constraint_count": result["constraintCount"],
                "assigned_count": len(result["assignments"]),
                "unassigned_count": len(domain_candidates) - len(result["assignments"]),
            }
        )
        total_ms += result["durationMs"]
        total_build_ms += result["modelBuildMs"]
        total_solve_ms += result["solveMs"]
        all_assignments.extend(result["assignments"])
        if result["status"] != OPTIMAL:
            aggregate_status = result["status"]
        if result["status"] in (ERROR, INFEASIBLE) and failure is None:
            failure = (
                result["status"] == INFEASIBLE,
                result["errorCode"] or "NO_FEASIBLE_ASSIGNMENT",
                result["errorMessage"],
            )

    if failure is not None:
        is_infeasible, code, message = failure
        if is_infeasible:
            response = build_response(
                request, INFEASIBLE, [], total_ms, None,
                infeasibility_reason=code, error_message=message,
            )
        else:
            response = build_response(
                request, ERROR, [], total_ms, None, error_code=code, error_message=message
            )
        return {
            "response": response,
            "domains": domain_results,
            "graph": graph,
            "partition": partition,
        }

    report = compute_seatlabel_report(
        graph, all_assignments, candidates_by_id, request.solverConfig.policyMode
    )
    if report["duplicateCandidateCount"] or report["duplicateSeatCount"] or report["policyViolationCount"]:
        response = build_response(
            request,
            ERROR,
            [],
            total_ms,
            None,
            error_code=ERR_INVALID_ASSIGNMENT,
            error_message="; ".join(report["policyViolations"] or ["invalid aggregate assignment"]),
        )
        return {
            "response": response,
            "domains": domain_results,
            "graph": graph,
            "partition": partition,
        }

    objective = report["sameDepartmentAdjacentCount"]
    response = build_response(request, aggregate_status, all_assignments, total_ms, objective)
    return {
        "response": response,
        "domains": domain_results,
        "graph": graph,
        "partition": partition,
        "total_build_ms": round(total_build_ms, 1),
        "total_solve_ms": round(total_solve_ms, 1),
        "total_duration_ms": round(total_ms, 1),
        "aggregate_report": report,
    }


def _domain_response(request: SolveRequest, result: dict, elapsed_ms: float) -> SolveResponse:
    duration = result["durationMs"] if result["durationMs"] else elapsed_ms
    if result["status"] == INFEASIBLE:
        return build_response(
            request, INFEASIBLE, [], duration, None,
            infeasibility_reason=result.get("errorMessage"),
        )
    if result["status"] == ERROR:
        return build_response(
            request, ERROR, [], duration, None,
            error_code=result.get("errorCode"),
            error_message=result.get("errorMessage"),
        )
    return build_response(request, result["status"], result["assignments"], duration, result["objective"])


def _elapsed_ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000.0