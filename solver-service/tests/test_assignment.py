"""Stage-2 deterministic assignment tests (§14, §15)."""
from __future__ import annotations

from app import solver
from app.config import Settings
from app.models import SolveRequest
from app.validation import OPTIMAL, structural_validation
from tests.helpers import make_candidate, make_hall, make_request

SETTINGS = Settings(internal_token="test-token", num_search_workers=1)


def test_deterministic_stage2_same_input_same_output():
    hall = make_hall("h1", "LH09", 3, 4)
    candidates = [make_candidate(i, "CSE-A", "CSE") for i in range(4)]
    req = SolveRequest(**make_request(candidates, [hall]))
    first = solver.solve_request(req, SETTINGS)
    second = solver.solve_request(req, SETTINGS)
    assert first.status == OPTIMAL and second.status == OPTIMAL
    assert first.assignments == second.assignments


def test_register_number_order_within_class():
    """Candidates of a class are assigned in registerNumber order onto that class's seats
    in seat order. Single column hall forces rows 1/3/5 for 3 same-class candidates."""
    hall = make_hall("h1", "LH09", 5, 1)
    candidates = [
        make_candidate(1, "CSE-A", "CSE", reg="REG003"),
        make_candidate(2, "CSE-A", "CSE", reg="REG001"),
        make_candidate(3, "CSE-A", "CSE", reg="REG002"),
    ]
    req = SolveRequest(**make_request(candidates, [hall]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == OPTIMAL
    assigned = {a.candidateId: a.hallSeatId for a in resp.assignments}
    assert assigned["cand-2"] == "h1-A1"
    assert assigned["cand-3"] == "h1-C1"
    assert assigned["cand-1"] == "h1-E1"


def test_response_sorted_by_hall_row_column():
    h1 = make_hall("h1", "LH09", 2, 2)
    h2 = make_hall("h2", "LH13", 2, 2)
    candidates = [make_candidate(i, f"CSE-{chr(ord('A') + i)}", "CSE") for i in range(6)]
    req = SolveRequest(**make_request(candidates, [h1, h2]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == OPTIMAL
    seat_rank = {
        "h1-A1": 0,
        "h1-A2": 1,
        "h1-B1": 2,
        "h1-B2": 3,
        "h2-A1": 4,
        "h2-A2": 5,
        "h2-B1": 6,
        "h2-B2": 7,
    }
    ranks = [seat_rank[a.hallSeatId] for a in resp.assignments]
    assert ranks == sorted(ranks)


def test_stage2_yields_no_duplicates_and_valid_structure():
    hall = make_hall("h1", "LH09", 4, 4)
    candidates = [
        make_candidate(i, "CSE-A" if i % 2 == 0 else "CSE-B", "CSE") for i in range(8)
    ]
    req = SolveRequest(**make_request(candidates, [hall]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == OPTIMAL
    assert structural_validation(req, resp.assignments) == []
    assert len(resp.assignments) == 8
    assert resp.unassignedCount == 0