"""Phase C — seat-label channeling solver tests (§40, objective reporting §18)."""
import pytest

from app.config import get_settings
from app.models import SolverConfig, SolveRequest
from app.seatlabel import (
    ERR_DOMAIN_COMPOSITION_IMBALANCE,
    ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT,
    ERR_INVALID_ASSIGNMENT,
    ERR_INVALID_POLICY_CONFIGURATION,
    solve_domain,
    solve_partitioned,
)
from tests.helpers import make_candidate, make_hall, make_request


def _mk(i, cls, dept, year=None):
    c = make_candidate(i, cls, dept)
    c["year"] = year
    return c


def _req(candidates, halls, **cfg):
    request = SolveRequest(**make_request(candidates, halls))
    request.solverConfig = SolverConfig(**cfg)
    return request


def test_department_only_feasible_optimal():
    req = _req([make_candidate(i, "CLS", f"D{i}") for i in range(4)], [make_hall("h1", "LH09", 3, 3)])
    resp = solve_domain(req, get_settings())
    assert resp.status == "OPTIMAL"
    assert resp.objectiveValue == 0
    assert resp.assignedCount == 4
    assert resp.unassignedCount == 0


def test_department_only_infeasible_full_grid():
    # 3x3 grid is fully adjacent (8-neighbourhood); 3 departments cannot avoid
    # same-department adjacency for the centre seat
    req = _req([make_candidate(i, "CLS", f"D{i % 3}") for i in range(9)], [make_hall("h1", "LH09", 3, 3)])
    resp = solve_domain(req, get_settings())
    assert resp.status == "INFEASIBLE"


def test_adjacency_mode_changes_feasibility():
    # 2x3 grid, 2 departments: eight-neighbourhood contains a triangle (infeasible),
    # cardinal is a bipartite ladder (feasible)
    cands = [make_candidate(i, "CLS", f"D{i % 2}") for i in range(6)]
    hall = [make_hall("h1", "LH09", 2, 3)]
    r_eight = solve_domain(_req(cands, hall, adjacency="eight"), get_settings())
    r_card = solve_domain(_req(cands, hall, adjacency="cardinal"), get_settings())
    assert r_eight.status == "INFEASIBLE"
    assert r_card.status == "OPTIMAL"
    assert r_card.objectiveValue == 0


def test_cohort_mode_allows_same_dept_different_year():
    # same department but distinct years is allowed under COHORT
    cands = [_mk(i, f"CLS{i}", f"D{i % 2}", f"Y{i % 2}") for i in range(4)]
    resp = solve_domain(_req(cands, [make_hall("h1", "LH09", 3, 3)], policyMode="COHORT"), get_settings())
    assert resp.status == "OPTIMAL"
    assert resp.assignedCount == 4


def test_strict_mode_forbids_same_dept_and_same_year():
    # 2x3 ladder, 2 departments, same year everywhere -> no valid arrangement
    cands = [_mk(i, f"CLS{i}", f"D{i % 2}", "Y0") for i in range(6)]
    resp = solve_domain(_req(cands, [make_hall("h1", "LH09", 2, 3)], policyMode="STRICT_DEPT_OR_YEAR", adjacency="cardinal"), get_settings())
    assert resp.status == "INFEASIBLE"


def test_policy_requiring_year_without_year_errors():
    cands = [make_candidate(i, "CLS", "D") for i in range(4)]
    resp = solve_domain(_req(cands, [make_hall("h1", "LH09", 3, 3)], policyMode="COHORT"), get_settings())
    assert resp.status == "ERROR"
    assert resp.errorCode == ERR_INVALID_POLICY_CONFIGURATION


def test_multi_component_request_rejected_by_solve_domain():
    cands = [make_candidate(i, "CLS", f"D{i}") for i in range(8)]
    halls = [make_hall("h1", "LH09", 2, 2), make_hall("h2", "LH13", 2, 2)]
    resp = solve_domain(_req(cands, halls), get_settings())
    assert resp.status == "ERROR"
    assert resp.errorCode == "ERR_INVALID_DOMAIN_ASSIGNMENT"


def test_partitioned_solves_multi_hall_request():
    cands = [make_candidate(i, "CLS", f"D{i}") for i in range(8)]
    halls = [make_hall("h1", "LH09", 2, 2), make_hall("h2", "LH13", 2, 2)]
    resp = solve_partitioned(_req(cands, halls), get_settings())
    assert resp.status == "OPTIMAL"
    assert resp.assignedCount == 8
    assert resp.unassignedCount == 0
    assert resp.objectiveValue == 0


def test_oversized_domain_rejected_before_solve():
    # 33x31 grid = 1023 seats, 1001 candidates -> single domain exceeds ceiling 1000
    cands = [make_candidate(i, "CLS", f"D{i % 5}") for i in range(1001)]
    hall = make_hall("h1", "LH09", 33, 31)
    resp = solve_domain(_req(cands, [hall]), get_settings())
    assert resp.status == "ERROR"
    assert resp.errorCode == ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT


def test_composition_reject_returns_imbalance_error():
    cands = [make_candidate(i, "CLS", "SAME") for i in range(4)]
    resp = solve_domain(_req(cands, [make_hall("h1", "LH09", 3, 3)], compositionAction="reject"), get_settings())
    assert resp.status == "ERROR"
    assert resp.errorCode == ERR_DOMAIN_COMPOSITION_IMBALANCE


def test_assignments_are_valid_and_non_duplicating():
    cands = [make_candidate(i, "CLS", f"D{i}") for i in range(4)]
    resp = solve_domain(_req(cands, [make_hall("h1", "LH09", 3, 3)]), get_settings())
    ids = [a.candidateId for a in resp.assignments]
    seats = [a.hallSeatId for a in resp.assignments]
    assert len(ids) == len(set(ids))
    assert len(seats) == len(set(seats))