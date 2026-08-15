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
CLASS_SUFFIXES_1000 = [chr(ord("A") + i) for i in range(20)]  # A..T
CLASS_SUFFIXES_2000 = [
    *[chr(ord("A") + i) for i in range(26)],  # A..Z
    *[f"A{chr(ord('A') + i)}" for i in range(14)],  # AA..AN
]  # 40 suffixes

HALLS_200 = [
    (f"hall-{i+1}", name, 5, 20) for i, name in enumerate(["LH01", "LH02"])
]
HALLS_800 = [
    (f"hall-{i+1}", name, 5, 20) for i, name in enumerate([f"LH{i:02d}" for i in range(1, 9)])
]
HALLS_500 = [
    (f"hall-{i+1}", name, 5, 20) for i, name in enumerate(["LH01", "LH02", "LH03", "LH04", "LH05"])
]
HALLS_1000 = [
    (f"hall-{i+1}", name, 5, 20) for i, name in enumerate([f"LH{i:02d}" for i in range(1, 11)])
]
HALLS_2000 = [
    (f"hall-{i+1}", name, 5, 20) for i, name in enumerate([f"LH{i:02d}" for i in range(1, 21)])
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


def build_n_dataset(
    candidate_count: int,
    time_limit_seconds: int = 120,
    request_id: str | None = None,
    exam_id: str | None = None,
) -> SolveRequest:
    """Deterministic dataset for exactly ``candidate_count`` candidates (multiple
    of 50, in [50, 500]) with exactly enough seats. Used for Phase D equivalence
    and small scaling checks."""
    assert candidate_count % 50 == 0 and 50 <= candidate_count <= 500, (
        f"candidate_count must be a multiple of 50 in [50, 500], got {candidate_count}"
    )
    hall_count = max(1, -(-candidate_count // 100))
    seats_per_hall = candidate_count // hall_count
    columns = seats_per_hall // 5
    halls = [
        (f"hall-{i+1}", f"LH{i:02d}", 5, columns) for i in range(hall_count)
    ]
    classes_per_dept = candidate_count // 10 // 5
    suffixes = CLASS_SUFFIXES_2000[:classes_per_dept]
    return _build(
        halls=halls,
        suffixes=suffixes,
        time_limit_seconds=time_limit_seconds,
        request_id=request_id or f"bench-{candidate_count}",
        exam_id=exam_id or f"exam-{candidate_count}",
    )


def build_200_dataset(time_limit_seconds: int = 120) -> SolveRequest:
    """200 validated candidates, 200 active seats across 2 halls (5x20 each).

    40 classes x 5 students each; 10 departments x 20 students each.
    """
    return _build(
        halls=HALLS_200,
        suffixes=CLASS_SUFFIXES[:4],  # A..D
        time_limit_seconds=time_limit_seconds,
        request_id="bench-200",
        exam_id="exam-200",
    )


def distribution_200() -> dict:
    """Exact documented distribution for the 200-student benchmark."""
    return {
        "candidateCount": len(DEPARTMENTS) * 4 * 5,
        "hallCount": len(HALLS_200),
        "seatCount": sum(rows * cols for _, _, rows, cols in HALLS_200),
        "classCount": len(DEPARTMENTS) * 4,
        "departmentCount": len(DEPARTMENTS),
        "studentsPerClass": 5,
        "studentsPerDepartment": 4 * 5,
        "rowsPerHall": 5,
        "columnsPerHall": 20,
    }


def build_500_dataset(time_limit_seconds: int = 600) -> SolveRequest:
    """500 validated candidates, 500 active seats across 5 halls (5x20 each).

    100 classes x 5 students each; 10 departments x 50 students each.
    """
    return _build(
        halls=HALLS_500,
        suffixes=CLASS_SUFFIXES,
        time_limit_seconds=time_limit_seconds,
        request_id="bench-500",
        exam_id="exam-500",
    )


def build_800_dataset(time_limit_seconds: int = 120) -> SolveRequest:
    """800 validated candidates, 800 active seats across 8 halls (5x20 each).

    160 classes x 5 students each; 10 departments x 80 students each.
    """
    return _build(
        halls=HALLS_800,
        suffixes=CLASS_SUFFIXES_1000[:16],  # A..P
        time_limit_seconds=time_limit_seconds,
        request_id="bench-800",
        exam_id="exam-800",
    )


def distribution_800() -> dict:
    """Exact documented distribution for the 800-student benchmark."""
    return {
        "candidateCount": len(DEPARTMENTS) * 16 * 5,
        "hallCount": len(HALLS_800),
        "seatCount": sum(rows * cols for _, _, rows, cols in HALLS_800),
        "classCount": len(DEPARTMENTS) * 16,
        "departmentCount": len(DEPARTMENTS),
        "studentsPerClass": 5,
        "studentsPerDepartment": 16 * 5,
        "rowsPerHall": 5,
        "columnsPerHall": 20,
    }


def build_1000_dataset(time_limit_seconds: int = 120) -> SolveRequest:
    """1000 validated candidates, 1000 active seats across 10 halls (5x20 each).

    200 classes x 5 students each; 10 departments x 100 students each.
    """
    return _build(
        halls=HALLS_1000,
        suffixes=CLASS_SUFFIXES_1000,
        time_limit_seconds=time_limit_seconds,
        request_id="bench-1000",
        exam_id="exam-1000",
    )


def distribution_1000() -> dict:
    """Exact documented distribution for the 1000-student benchmark."""
    return {
        "candidateCount": len(DEPARTMENTS) * len(CLASS_SUFFIXES_1000) * 5,
        "hallCount": len(HALLS_1000),
        "seatCount": sum(rows * cols for _, _, rows, cols in HALLS_1000),
        "classCount": len(DEPARTMENTS) * len(CLASS_SUFFIXES_1000),
        "departmentCount": len(DEPARTMENTS),
        "studentsPerClass": 5,
        "studentsPerDepartment": len(CLASS_SUFFIXES_1000) * 5,
        "rowsPerHall": 5,
        "columnsPerHall": 20,
    }


def build_2000_dataset(time_limit_seconds: int = 180) -> SolveRequest:
    """2000 validated candidates, 2000 active seats across 20 halls (5x20 each).

    400 classes x 5 students each; 10 departments x 200 students each.
    """
    return _build(
        halls=HALLS_2000,
        suffixes=CLASS_SUFFIXES_2000,
        time_limit_seconds=time_limit_seconds,
        request_id="bench-2000",
        exam_id="exam-2000",
    )


def distribution_2000() -> dict:
    """Exact documented distribution for the 2000-student benchmark."""
    return {
        "candidateCount": len(DEPARTMENTS) * len(CLASS_SUFFIXES_2000) * 5,
        "hallCount": len(HALLS_2000),
        "seatCount": sum(rows * cols for _, _, rows, cols in HALLS_2000),
        "classCount": len(DEPARTMENTS) * len(CLASS_SUFFIXES_2000),
        "departmentCount": len(DEPARTMENTS),
        "studentsPerClass": 5,
        "studentsPerDepartment": len(CLASS_SUFFIXES_2000) * 5,
        "rowsPerHall": 5,
        "columnsPerHall": 20,
    }


def _build(
    halls: list[tuple[str, str, int, int]],
    suffixes: list[str],
    time_limit_seconds: int,
    request_id: str,
    exam_id: str,
) -> SolveRequest:
    candidates = []
    idx = 0
    for dept in DEPARTMENTS:
        for suffix in suffixes:
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
    assert len(candidates) == sum(rows * cols for _, _, rows, cols in halls)
    hall_objects = [
        make_hall(hall_id, hall_number, rows, columns, name=hall_number)
        for hall_id, hall_number, rows, columns in halls
    ]
    return SolveRequest(
        **make_request(
            candidates,
            hall_objects,
            time_limit_seconds=time_limit_seconds,
            request_id=request_id,
            exam_id=exam_id,
        )
    )


if __name__ == "__main__":
    import json
    import sys

    size = sys.argv[1] if len(sys.argv) > 1 else "500"
    if size == "2000":
        request = build_2000_dataset()
        d = distribution_2000()
        label = "2000-student"
    elif size == "1000":
        request = build_1000_dataset()
        d = distribution_1000()
        label = "1000-student"
    else:
        request = build_500_dataset()
        d = distribution()
        label = "500-student"
    print(f"=== {label} dataset distribution ===")
    print(json.dumps(d, indent=2))
    print(f"candidates={len(request.candidates)} seats={sum(len(h.seats) for h in request.halls)}")
    print("classes:", sorted({c.class_ for c in request.candidates}))
    print("departments:", sorted({c.department for c in request.candidates}))