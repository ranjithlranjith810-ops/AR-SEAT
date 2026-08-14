"""Status mapping, structural validation, and validation report tests (§16, §18, §29)."""
from __future__ import annotations

from ortools.sat.python import cp_model

from app import solver
from app.config import Settings
from app.models import Assignment, SolveRequest
from app.validation import (
    ERROR,
    FEASIBLE,
    INFEASIBLE,
    INSUFFICIENT_SEATS,
    NO_FEASIBLE_ASSIGNMENT,
    OPTIMAL,
    SOLVER_TIMEOUT_NO_SOLUTION,
    classify_status,
    compute_validation_report,
    required_zeros,
    structural_validation,
)
from tests.helpers import make_candidate, make_hall, make_request

SETTINGS = Settings(internal_token="test-token", num_search_workers=1)


def test_classify_status_mapping():
    assert classify_status(cp_model.OPTIMAL) == OPTIMAL
    assert classify_status(cp_model.FEASIBLE) == FEASIBLE
    assert classify_status(cp_model.INFEASIBLE) == INFEASIBLE
    assert classify_status(cp_model.UNKNOWN) == ERROR


def test_insufficient_seats_core_infeasible():
    """§20 — mandatory cheap capacity check at the core returns INFEASIBLE/INSUFFICIENT_SEATS."""
    hall = make_hall("h1", "LH09", 1, 2)
    candidates = [make_candidate(i, "CSE-A", "CSE") for i in range(3)]
    req = SolveRequest(**make_request(candidates, [hall]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == INFEASIBLE
    assert resp.infeasibilityReason == INSUFFICIENT_SEATS
    assert resp.assignments == []


def test_timeout_with_solution_is_feasible(monkeypatch):
    """§16 — a solver status FEASIBLE must surface as FEASIBLE with a valid arrangement."""
    hall = make_hall("h1", "LH09", 3, 3)
    candidates = [make_candidate(i, "CSE-A", "CSE") for i in range(4)]
    req = SolveRequest(**make_request(candidates, [hall]))
    real_solver, _status, model, z, o, seats, keys, key_index = solver.solve_pattern(req, SETTINGS)

    def fake_pattern(request_, settings_):
        return real_solver, cp_model.FEASIBLE, model, z, o, seats, keys, key_index

    monkeypatch.setattr(solver, "solve_pattern", fake_pattern)
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == FEASIBLE
    assert resp.objectiveValue is not None
    assert len(resp.assignments) == 4
    assert structural_validation(req, resp.assignments) == []


def test_timeout_without_solution_is_error(monkeypatch):
    """§16 — timeout with no solution (UNKNOWN) is ERROR/SOLVER_TIMEOUT_NO_SOLUTION."""
    hall = make_hall("h1", "LH09", 3, 3)
    candidates = [make_candidate(i, "CSE-A", "CSE") for i in range(4)]
    req = SolveRequest(**make_request(candidates, [hall]))

    def fake_pattern(request_, settings_):
        return None, cp_model.UNKNOWN, None, None, None, None, None, None

    monkeypatch.setattr(solver, "solve_pattern", fake_pattern)
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == ERROR
    assert resp.errorCode == SOLVER_TIMEOUT_NO_SOLUTION
    assert resp.assignments == []
    assert resp.objectiveValue is None


def test_never_reports_unproven_infeasibility(monkeypatch):
    hall = make_hall("h1", "LH09", 3, 3)
    candidates = [make_candidate(i, "CSE-A", "CSE") for i in range(4)]
    req = SolveRequest(**make_request(candidates, [hall]))

    def fake_pattern(request_, settings_):
        return None, cp_model.UNKNOWN, None, None, None, None, None, None

    monkeypatch.setattr(solver, "solve_pattern", fake_pattern)
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == ERROR
    assert resp.infeasibilityReason is None


def test_proven_infeasible_reason():
    hall = make_hall("h1", "LH09", 1, 2)
    candidates = [make_candidate(i, "CSE-A", "CSE") for i in range(2)]
    req = SolveRequest(**make_request(candidates, [hall]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == INFEASIBLE
    assert resp.infeasibilityReason == NO_FEASIBLE_ASSIGNMENT


def test_structural_validation_flags_errors():
    hall = make_hall("h1", "LH09", 2, 2)
    req = SolveRequest(
        **make_request(
            [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-B", "CSE")],
            [hall],
        )
    )
    good = [Assignment(candidateId="cand-1", hallId="h1", hallSeatId="h1-A1"),
            Assignment(candidateId="cand-2", hallId="h1", hallSeatId="h1-A2")]
    assert structural_validation(req, good) == []
    assert structural_validation(
        req,
        [Assignment(candidateId="cand-99", hallId="h1", hallSeatId="h1-A1")],
    ) != []
    assert structural_validation(
        req,
        [Assignment(candidateId="cand-1", hallId="h1", hallSeatId="h1-A1"),
         Assignment(candidateId="cand-1", hallId="h1", hallSeatId="h1-A2")],
    ) != []
    assert structural_validation(
        req,
        [Assignment(candidateId="cand-1", hallId="h1", hallSeatId="h1-ZZ")],
    ) != []


def test_validation_report_metrics():
    hall = make_hall("h1", "LH09", 1, 3)
    candidates = [
        make_candidate(1, "CSE-A", "CSE"),
        make_candidate(2, "CSE-B", "CSE"),
        make_candidate(3, "ECE-A", "ECE"),
    ]
    req = SolveRequest(**make_request(candidates, [hall]))
    assignments = [
        Assignment(candidateId="cand-1", hallId="h1", hallSeatId="h1-A1"),
        Assignment(candidateId="cand-2", hallId="h1", hallSeatId="h1-A2"),
        Assignment(candidateId="cand-3", hallId="h1", hallSeatId="h1-A3"),
    ]
    report = compute_validation_report(req, assignments)
    assert report["sameClassAdjacentCount"] == 0
    assert report["sameDepartmentAdjacentCount"] == 1  # CSE-A and CSE-B adjacent
    assert report["unassignedCount"] == 0
    assert report["duplicateCandidateCount"] == 0
    assert report["duplicateSeatCount"] == 0
    assert report["hallsUsed"] == 1
    assert required_zeros(report)


def test_validation_report_catches_same_class_adjacency():
    hall = make_hall("h1", "LH09", 1, 2)
    candidates = [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-A", "CSE")]
    req = SolveRequest(**make_request(candidates, [hall]))
    assignments = [
        Assignment(candidateId="cand-1", hallId="h1", hallSeatId="h1-A1"),
        Assignment(candidateId="cand-2", hallId="h1", hallSeatId="h1-A2"),
    ]
    report = compute_validation_report(req, assignments)
    assert report["sameClassAdjacentCount"] == 1
    assert not required_zeros(report)