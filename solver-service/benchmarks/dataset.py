"""Deterministic synthetic benchmark datasets for Phase 3.

No real student data or PII — register numbers, classes, departments and ids are
generated from fixed rules so every run is reproducible.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import SolveRequest
from tests.helpers import make_hall, make_request

# Department codes and per-department class suffixes.
DEPARTMENTS = ["CSE", "ECE", "EEE", "MECH", "CIVIL", "IT", "AIDS", "AIML", "CHEM", "EIE"]
CLASS_SUFFIXES = [chr(ord("A") + i) for i in range(10)]  # A..J

HALLS_500 = [
    (f"hall-{i+1}", name, 5, 20) for i, name in enumerate(["LH01", "LH02", "LH03", "LH04", "LH05"])
]


def distribution() -> dict:
    """Exact documented distribution for the 500-student benchmark."""
    return {
        "candidateCount": 500,
        "hallCount": len(HALLS_500),
        "seatCount": sum(rows * cols for _, _, rows, cols in HALLS_500),
        "classCount": len(DEPARTMENTS) * len(CLASS_SUFFIXES),
        "departmentCount": len(DEPARTMENTS),
        "studentsPerClass": 5,
        "studentsPerDepartment": len(CLASS_SUFFIXES) * 5,
        "rowsPerHall": 5,
        "columnsPerHall": 20,
    }


def build_500_dataset(time_limit_seconds: int = 600) -> SolveRequest:
    """500 validated candidates, 500 active seats across 5 halls (5x20 each).

    100 classes x 5 students each; 10 departments x 50 students each.
    """
    candidates = []
    idx = 0
    for dept in DEPARTMENTS:
        for suffix in CLASS_SUFFIXES:
            cls = f"{dept}-{suffix}"
            for _ in range(5):
                candidates.append(
                    {
                        "id": f"cand-{idx:03d}",
                        "registerNumber": f"REG{idx:05d}",
                        "studentName": f"Student {idx:03d}",
                        "department": dept,
                        "class": cls,
                        "gender": "MALE" if idx % 2 == 0 else "FEMALE",
                        "subjectCode": "CS101",
                        "subjectName": "Programming",
                    }
                )
                idx += 1
    assert len(candidates) == 500
    halls = [
        make_hall(hall_id, hall_number, rows, columns, name=hall_number)
        for hall_id, hall_number, rows, columns in HALLS_500
    ]
    return SolveRequest(
        **make_request(
            candidates,
            halls,
            time_limit_seconds=time_limit_seconds,
            request_id="bench-500",
            exam_id="exam-500",
        )
    )


if __name__ == "__main__":
    import json

    request = build_500_dataset()
    d = distribution()
    print("=== 500-student dataset distribution ===")
    print(json.dumps(d, indent=2))
    print(f"candidates={len(request.candidates)} seats={sum(len(h.seats) for h in request.halls)}")
    print("classes:", sorted({c.class_ for c in request.candidates}))
    print("departments:", sorted({c.department for c in request.candidates}))