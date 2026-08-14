"""Hard-constraint C1-C5 tests and stage-1 model size checks (§6.3)."""
from __future__ import annotations

from app import constraints as cst, solver
from app.config import Settings
from app.models import SolveRequest
from app.validation import OPTIMAL, compute_validation_report
from tests.helpers import make_candidate, make_hall, make_request, make_seat

SETTINGS = Settings(internal_token="test-token", num_search_workers=1)


def test_model_variable_and_constraint_counts():
    """§6.3 — variables = S*K + E; C1=S, C2=K, C3=S*K, linking=E*D."""
    hall = make_hall("h1", "LH09", 2, 2)
    candidates = [
        make_candidate(1, "CSE-A", "CSE"),
        make_candidate(2, "CSE-B", "CSE"),
        make_candidate(3, "ECE-A", "ECE"),
    ]
    req = SolveRequest(**make_request(candidates, [hall]))
    built = solver.build_stage1(req, encoding=solver.ENCODING_D)
    model = built["model"]
    s = len(built["seats"])
    k = len(built["keys"])
    e = len(built["edges"])
    d = len(built["departments"])
    var_count = len(model.Proto().variables)
    con_count = len(model.Proto().constraints)
    assert var_count == s * k + e
    # C1(s) + C2(k) + C3(s*k) + linking(e*d); the objective is not a proto constraint
    assert con_count == s + k + s * k + e * d


def test_c2_exact_quotas():
    hall = make_hall("h1", "LH09", 3, 3)
    candidates = [
        make_candidate(1, "CSE-A", "CSE"),
        make_candidate(2, "CSE-A", "CSE"),
        make_candidate(3, "CSE-B", "CSE"),
        make_candidate(4, "ECE-A", "ECE"),
    ]
    req = SolveRequest(**make_request(candidates, [hall]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == OPTIMAL
    from collections import Counter

    seen = Counter(a.candidateId for a in resp.assignments)
    assert all(v == 1 for v in seen.values())
    assert len(resp.assignments) == 4
    report = compute_validation_report(req, resp.assignments)
    assert report["assignedCount"] == 4


def test_active_seats_only():
    """C5 — candidates may only be placed on active seats (seats present in the request)."""
    hall = make_hall("h1", "LH09", 3, 3, active_rows=[0, 2], active_columns=[0, 2])
    active_ids = {s["id"] for s in hall["seats"]}
    assert len(active_ids) == 4
    candidates = [
        make_candidate(1, "CSE-A", "CSE"),
        make_candidate(2, "CSE-B", "CSE"),
        make_candidate(3, "ECE-A", "ECE"),
        make_candidate(4, "MECH-A", "MECH"),
    ]
    req = SolveRequest(**make_request(candidates, [hall]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == OPTIMAL
    assert all(a.hallSeatId in active_ids for a in resp.assignments)
    assert len(resp.assignments) == 4


def test_no_duplicate_candidate_or_seat():
    hall = make_hall("h1", "LH09", 4, 4)
    candidates = [make_candidate(i, "CSE-A", "CSE") for i in range(4)]
    req = SolveRequest(**make_request(candidates, [hall]))
    resp = solver.solve_request(req, SETTINGS)
    assert resp.status == OPTIMAL
    cand_ids = [a.candidateId for a in resp.assignments]
    seat_ids = [a.hallSeatId for a in resp.assignments]
    assert len(cand_ids) == len(set(cand_ids))
    assert len(seat_ids) == len(set(seat_ids))