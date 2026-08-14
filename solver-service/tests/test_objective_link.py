"""Department-mixing objective linking tests (§11)."""
from __future__ import annotations

from app import solver
from app.config import Settings
from app.models import SolveRequest
from app.validation import OPTIMAL, compute_validation_report
from tests.helpers import make_candidate, make_hall, make_request

SETTINGS = Settings(internal_token="test-token", num_search_workers=1)


def _solve(candidates, hall) -> SolveRequest:
    req = SolveRequest(**make_request(candidates, [hall]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == OPTIMAL
    report = compute_validation_report(req, resp.assignments)
    return resp, report


def test_same_department_adjacent_counts_one():
    """Two adjacent seats with the same department (different classes) force objective 1."""
    hall = make_hall("h1", "LH09", 1, 2)
    resp, report = _solve(
        [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-B", "CSE")],
        hall,
    )
    assert resp.objectiveValue == 1
    assert report["sameDepartmentAdjacentCount"] == 1


def test_different_departments_adjacent_objective_zero():
    hall = make_hall("h1", "LH09", 1, 2)
    resp, report = _solve(
        [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "ECE-A", "ECE")],
        hall,
    )
    assert resp.objectiveValue == 0
    assert report["sameDepartmentAdjacentCount"] == 0


def test_empty_seat_contributes_nothing():
    """CSE-A / EMPTY / CSE-B: the occupied pair is non-adjacent and the empty seat adds 0."""
    hall = make_hall("h1", "LH09", 1, 3)
    resp, report = _solve(
        [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "ECE-A", "ECE")],
        hall,
    )
    assert resp.objectiveValue == 0
    assert report["sameDepartmentAdjacentCount"] == 0


def test_objective_equals_same_department_adjacent_count():
    """objectiveValue == sameDepartmentAdjacentCount by construction (§29)."""
    hall = make_hall("h1", "LH09", 3, 3)
    candidates = [
        make_candidate(1, "CSE-A", "CSE"),
        make_candidate(2, "CSE-B", "CSE"),
        make_candidate(3, "CSE-C", "CSE"),
        make_candidate(4, "ECE-A", "ECE"),
        make_candidate(5, "ECE-B", "ECE"),
        make_candidate(6, "MECH-A", "MECH"),
    ]
    resp, report = _solve(candidates, hall)
    assert resp.objectiveValue == report["sameDepartmentAdjacentCount"]


def test_objective_minimizes_same_department_pairs():
    """A 1x4 hall with 2 CSE + 2 ECE can reach objective 0 by alternating branches."""
    hall = make_hall("h1", "LH09", 1, 4)
    candidates = [
        make_candidate(1, "CSE-A", "CSE"),
        make_candidate(2, "CSE-B", "CSE"),
        make_candidate(3, "ECE-A", "ECE"),
        make_candidate(4, "ECE-B", "ECE"),
    ]
    resp, report = _solve(candidates, hall)
    assert resp.objectiveValue == 0, f"alternating branches should be possible, got {resp.objectiveValue}"