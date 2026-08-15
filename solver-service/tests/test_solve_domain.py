"""Phase 4 — /solve-domain boundary tests.

The orchestration endpoint must reuse the FROZEN seat-label engine
(seatlabel.solve_domain): one connected component per request, same auth and
422 semantics as /solve, and OPTIMAL domains must report objective == validator.
No solver formulation, partition, or guard logic is exercised beyond what
solve_domain already applies.
"""
from __future__ import annotations

from tests.helpers import make_candidate, make_hall, make_request


def test_solve_domain_single_hall_optimal(client, headers):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(i, "CSE-A", "CSE") for i in range(4)], [hall])
    resp = client.post("/solve-domain", json=body, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "OPTIMAL"
    assert data["candidateCount"] == 4
    assert data["assignedCount"] == 4
    assert data["unassignedCount"] == 0
    assert data["objectiveValue"] == 0
    assert len(data["assignments"]) == 4


def test_solve_domain_multi_component_rejected(client, headers):
    """Two disconnected halls -> the request spans 2 components; the frozen
    solve_domain contract requires exactly one, so it must return ERROR with
    ERR_INVALID_DOMAIN_ASSIGNMENT (orchestrator splits domains)."""
    hall_a = make_hall("h1", "LH09", 2, 2)
    hall_b = make_hall("h2", "LH10", 2, 2)
    body = make_request(
        [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-B", "CSE")],
        [hall_a, hall_b],
    )
    resp = client.post("/solve-domain", json=body, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ERROR"
    assert data["errorCode"] == "ERR_INVALID_DOMAIN_ASSIGNMENT"


def test_solve_domain_missing_token_is_401(client):
    hall = make_hall("h1", "LH09", 2, 2)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    resp = client.post("/solve-domain", json=body)
    assert resp.status_code == 401


def test_solve_domain_wrong_token_is_401(client):
    hall = make_hall("h1", "LH09", 2, 2)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    resp = client.post("/solve-domain", json=body, headers={"X-Internal-Token": "wrong"})
    assert resp.status_code == 401


def test_solve_domain_dev_default_token_rejected(client, monkeypatch):
    """TB3 fail-closed: even a CORRECT match against the well-known default
    token must be rejected — the server refuses to run with that secret."""
    import app.main as main_mod

    monkeypatch.setattr(main_mod.settings, "internal_token", "dev-internal-token")
    hall = make_hall("h1", "LH09", 2, 2)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    resp = client.post(
        "/solve-domain",
        json=body,
        headers={"X-Internal-Token": "dev-internal-token"},
    )
    assert resp.status_code == 401


def test_solve_domain_blank_config_rejected(client, monkeypatch):
    """TB3 fail-closed: a server configured with a blank token accepts nothing."""
    import app.main as main_mod

    monkeypatch.setattr(main_mod.settings, "internal_token", "")
    hall = make_hall("h1", "LH09", 2, 2)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    resp = client.post("/solve-domain", json=body, headers={"X-Internal-Token": ""})
    assert resp.status_code == 401


def test_invalid_token_rejected_before_payload_validation(client, monkeypatch):
    """TB3 auth-order: a bad token must yield 401 (NOT 422) even with a
    malformed body, and the solver must never be invoked — the request stops
    at the shared authentication dependency."""
    import app.main as main_mod

    invoked: list[str] = []
    monkeypatch.setattr(
        main_mod.seatlabel,
        "solve_domain",
        lambda *a, **k: invoked.append("called") or {},
    )
    body = {
        "requestId": "x",
        "examId": "y",
        "candidates": [{"id": "c1", "department": "CSE"}],
        "halls": {},
    }
    resp = client.post("/solve-domain", json=body, headers={"X-Internal-Token": "wrong"})
    assert resp.status_code == 401
    assert resp.json() == {"detail": "unauthorized"}
    assert invoked == []


def test_solve_domain_capacity_exceeded_is_422(client, headers):
    hall = make_hall("h1", "LH09", 1, 1)
    body = make_request(
        [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-B", "CSE")],
        [hall],
    )
    resp = client.post("/solve-domain", json=body, headers=headers)
    assert resp.status_code == 422


def test_solve_domain_infeasible_surfaces(client, headers):
    """Two same-class candidates on a 1x2 grid are adjacent -> infeasible."""
    hall = make_hall("h1", "LH09", 1, 2)
    body = make_request(
        [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-A", "CSE")],
        [hall],
    )
    resp = client.post("/solve-domain", json=body, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "INFEASIBLE"
    assert data["infeasibilityReason"] is not None