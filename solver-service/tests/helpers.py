"""Shared builders for solver-service tests."""
from __future__ import annotations

from typing import Optional


def make_candidate(
    i: int,
    cls: str = "CSE-A",
    dept: str = "CSE",
    reg: Optional[str] = None,
    gender: str = "MALE",
) -> dict:
    return {
        "id": f"cand-{i}",
        "registerNumber": reg or f"REG{i:04d}",
        "studentName": f"Student {i}",
        "department": dept,
        "class": cls,
        "gender": gender,
        "subjectCode": "CS101",
        "subjectName": "Programming",
    }


def make_seat(hall_id: str, row: str, column: int) -> dict:
    return {
        "id": f"{hall_id}-{row}{column}",
        "seatPosition": f"{row}{column}",
        "row": row,
        "column": column,
    }


def make_hall(
    hall_id: str,
    hall_number: str,
    rows: int,
    columns: int,
    active_rows: Optional[list[int]] = None,
    active_columns: Optional[list[int]] = None,
    name: str = "Exam Hall",
) -> dict:
    """Create a rectangular hall. Active seats default to the full grid; pass
    ``active_rows``/``active_columns`` (0-based) to restrict which seats are active."""
    seats = []
    row_letters = [chr(ord("A") + r) for r in range(rows)]
    for r in range(rows):
        if active_rows is not None and r not in active_rows:
            continue
        for c in range(columns):
            if active_columns is not None and c not in active_columns:
                continue
            seats.append(make_seat(hall_id, row_letters[r], c + 1))
    return {
        "id": hall_id,
        "hallNumber": hall_number,
        "name": name,
        "building": None,
        "rows": rows,
        "columns": columns,
        "capacity": len(seats),
        "seats": seats,
    }


def make_request(
    candidates: list[dict],
    halls: list[dict],
    time_limit_seconds: int = 60,
    request_id: str = "req-1",
    exam_id: str = "exam-1",
    scope: str = "class",
) -> dict:
    return {
        "requestId": request_id,
        "examId": exam_id,
        "candidates": candidates,
        "halls": halls,
        "timeLimitSeconds": time_limit_seconds,
        "solverConfig": {"model": "structured", "hardRuleScope": scope, "randomSeed": 42},
    }