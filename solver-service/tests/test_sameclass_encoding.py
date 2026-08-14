"""Same-class encoding correctness — Encoding D regressions (§6.6) and D==B fuzz."""
from __future__ import annotations

import random

from ortools.sat.python import cp_model

from app import solver
from app.config import Settings
from app.models import SolveRequest
from app.validation import FEASIBLE, INFEASIBLE, OPTIMAL, classify_status, compute_validation_report
from tests.helpers import make_candidate, make_hall, make_request, make_seat

SETTINGS = Settings(internal_token="test-token", num_search_workers=1)


def _assert_status(request: SolveRequest, expected: str):
    resp = solver.solve_request(request, SETTINGS)
    assert resp.status == expected, f"expected {expected}, got {resp.status} ({resp.errorMessage})"
    return resp


def test_adjacent_same_class_infeasible():
    """Two same-class candidates on two adjacent seats are infeasible (positive C3)."""
    hall = make_hall("h1", "LH09", 1, 2)
    req = SolveRequest(
        **make_request(
            [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-A", "CSE")],
            [hall],
        )
    )
    _assert_status(req, INFEASIBLE)


def test_empty_seat_between_same_class_feasible():
    """CSE-A / EMPTY / CSE-A must be feasible (§6.6 regression A)."""
    hall = make_hall("h1", "LH09", 1, 3)
    req = SolveRequest(
        **make_request(
            [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-A", "CSE")],
            [hall],
        )
    )
    resp = _assert_status(req, OPTIMAL)
    report = compute_validation_report(req, resp.assignments)
    assert report["sameClassAdjacentCount"] == 0
    assert report["assignedCount"] == 2


def test_common_neighbour_not_adjacent_feasible():
    """Two same-class seats sharing a common neighbour but not adjacent must be feasible."""
    hall = make_hall("h1", "LH09", 2, 3)
    req = SolveRequest(
        **make_request(
            [
                make_candidate(1, "CSE-A", "CSE"),
                make_candidate(2, "CSE-A", "CSE"),
                make_candidate(3, "CSE-B", "CSE"),
            ],
            [hall],
        )
    )
    resp = _assert_status(req, OPTIMAL)
    report = compute_validation_report(req, resp.assignments)
    assert report["sameClassAdjacentCount"] == 0
    assert report["assignedCount"] == 3


def test_empty_seat_places_no_restriction():
    """An empty seat must place no restriction on its neighbours."""
    hall = make_hall("h1", "LH09", 1, 3)
    req = SolveRequest(
        **make_request(
            [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-B", "CSE")],
            [hall],
        )
    )
    resp = _assert_status(req, OPTIMAL)
    report = compute_validation_report(req, resp.assignments)
    assert report["assignedCount"] == 2
    # the third seat stays empty; nothing may be forced to violate C3 because of it


def _solve_encoding(request: SolveRequest, encoding: str):
    built = solver.build_stage1(request, encoding=encoding)
    sol = cp_model.CpSolver()
    sol.parameters.max_time_in_seconds = float(request.timeLimitSeconds)
    sol.parameters.random_seed = 42
    sol.parameters.num_search_workers = 1
    status = sol.Solve(built["model"])
    label = classify_status(status)
    objective = int(round(sol.ObjectiveValue())) if label in (OPTIMAL, FEASIBLE) else None
    return label, objective


def _random_fuzz_requests(seed: int = 12345, count: int = 40) -> list[SolveRequest]:
    rng = random.Random(seed)
    class_pool = [("CSE-A", "CSE"), ("CSE-B", "CSE"), ("ECE-A", "ECE"), ("MECH-A", "MECH")]
    requests: list[SolveRequest] = []
    for _ in range(count):
        rows = rng.randint(1, 4)
        cols = rng.randint(1, 4)
        grid = [(r, c) for r in range(rows) for c in range(cols)]
        rng.shuffle(grid)
        grid = grid[: rng.randint(1, len(grid))]
        seats = [make_seat("h1", chr(ord("A") + r), c + 1) for r, c in sorted(grid)]
        hall = {
            "id": "h1",
            "hallNumber": "LH09",
            "name": "H",
            "building": None,
            "rows": rows,
            "columns": cols,
            "capacity": len(seats),
            "seats": seats,
        }
        n = rng.randint(1, len(seats))
        all_same = rng.random() < 0.3
        candidates = []
        for i in range(n):
            cls, dept = class_pool[0] if all_same else class_pool[rng.randrange(len(class_pool))]
            candidates.append(make_candidate(i, cls, dept))
        requests.append(SolveRequest(**make_request(candidates, [hall])))
    return requests


def test_encoding_d_equals_encoding_b_fuzz():
    """Encoding D and the exact pairwise edge rule admit exactly the same solutions
    (feasibility and optimal objective)."""
    for req in _random_fuzz_requests():
        label_d, obj_d = _solve_encoding(req, solver.ENCODING_D)
        label_b, obj_b = _solve_encoding(req, solver.ENCODING_B)
        assert label_d == label_b, (
            f"feasibility mismatch: D={label_d} B={label_b} for {req.candidates} seats={len(req.halls[0].seats)}"
        )
        if label_d in (OPTIMAL, FEASIBLE):
            assert obj_d == obj_b, f"objective mismatch D={obj_d} B={obj_b}"