"""FastAPI boundary tests (§21): auth, payload limits, statuses, 422/401/413."""
from __future__ import annotations

import app.main as main_mod
from tests.helpers import make_candidate, make_hall, make_request


def test_health_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_solve_valid_returns_optimal(client, headers):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(i, "CSE-A", "CSE") for i in range(4)], [hall])
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "OPTIMAL"
    assert data["candidateCount"] == 4
    assert data["assignedCount"] == 4
    assert data["unassignedCount"] == 0
    assert data["objectiveValue"] is not None
    assert len(data["assignments"]) == 4


def test_missing_token_is_401(client):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    resp = client.post("/solve", json=body)
    assert resp.status_code == 401


def test_wrong_token_is_401(client):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    resp = client.post("/solve", json=body, headers={"X-Internal-Token": "wrong"})
    assert resp.status_code == 401


def test_empty_halls_is_422(client, headers):
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [])
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 422


def test_missing_class_is_422(client, headers):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    del body["candidates"][0]["class"]
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 422


def test_missing_department_is_422(client, headers):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    del body["candidates"][0]["department"]
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 422


def test_seat_outside_grid_is_422(client, headers):
    hall = make_hall("h1", "LH09", 2, 2)
    hall["seats"].append({"id": "h1-C9", "seatPosition": "C9", "row": "C", "column": 9})
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 422


def test_time_limit_zero_is_422(client, headers):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall], time_limit_seconds=0)
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 422


def test_time_limit_exceeds_max_is_422(client, headers):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall], time_limit_seconds=3601)
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 422


def test_candidate_count_mismatch_is_422(client, headers):
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(1, "CSE-A", "CSE")], [hall])
    body["candidateCount"] = 2
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 422


def test_capacity_exceeded_is_422(client, headers):
    """§4 — candidateCount > availableSeatCount is a 422 at the API boundary."""
    hall = make_hall("h1", "LH09", 1, 1)
    body = make_request(
        [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-B", "CSE")],
        [hall],
    )
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 422


def test_payload_too_large_is_413(client, headers, monkeypatch):
    monkeypatch.setattr(main_mod.settings, "max_request_bytes", 64)
    hall = make_hall("h1", "LH09", 3, 3)
    body = make_request([make_candidate(i, "CSE-A", "CSE") for i in range(4)], [hall])
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 413


def test_same_class_blob_infeasible_surfaces(client, headers):
    hall = make_hall("h1", "LH09", 1, 2)
    body = make_request(
        [make_candidate(1, "CSE-A", "CSE"), make_candidate(2, "CSE-A", "CSE")],
        [hall],
    )
    resp = client.post("/solve", json=body, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "INFEASIBLE"
    assert resp.json()["infeasibilityReason"] is not None