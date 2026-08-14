"""Status mapping, response building, structural validation, and the authoritative
validation report (§18, §29). All metrics are computed pairwise over the active-seat
graph, never via any CP-SAT neighbourhood sum.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from ortools.sat.python import cp_model

from .models import Assignment, Candidate, SolveRequest, SolveResponse

OPTIMAL = "OPTIMAL"
FEASIBLE = "FEASIBLE"
INFEASIBLE = "INFEASIBLE"
ERROR = "ERROR"

INSUFFICIENT_SEATS = "INSUFFICIENT_SEATS"
NO_FEASIBLE_ASSIGNMENT = "NO_FEASIBLE_ASSIGNMENT"
SOLVER_TIMEOUT_NO_SOLUTION = "SOLVER_TIMEOUT_NO_SOLUTION"
INTERNAL_ERROR = "INTERNAL_ERROR"


def classify_status(cp_status: int) -> str:
    """Map a CP-SAT solution status to the §5 response status (incl. §16 timeouts)."""
    if cp_status == cp_model.OPTIMAL:
        return OPTIMAL
    if cp_status == cp_model.FEASIBLE:
        return FEASIBLE
    if cp_status == cp_model.INFEASIBLE:
        return INFEASIBLE
    return ERROR


def build_response(
    request: SolveRequest,
    status: str,
    assignments: list[Assignment],
    duration_ms: float,
    objective_value: Optional[int],
    infeasibility_reason: Optional[str] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> SolveResponse:
    assigned = len(assignments)
    return SolveResponse(
        requestId=request.requestId,
        status=status,
        assignments=list(assignments),
        solverDurationMs=int(round(duration_ms)),
        candidateCount=len(request.candidates),
        assignedCount=assigned,
        unassignedCount=len(request.candidates) - assigned,
        objectiveValue=objective_value,
        infeasibilityReason=infeasibility_reason,
        errorCode=error_code,
        errorMessage=error_message,
    )


def structural_validation(request: SolveRequest, assignments: list[Assignment]) -> list[str]:
    """§18 layer 1 — Python structural checks. Returns a list of errors (empty = pass)."""
    errors: list[str] = []
    candidate_ids = {c.id for c in request.candidates}
    seat_ids = {s.id for h in request.halls for s in h.seats}

    seen_candidates: set[str] = set()
    seen_seats: set[str] = set()
    for a in assignments:
        if a.candidateId not in candidate_ids:
            errors.append(f"unknown candidateId {a.candidateId}")
        if a.candidateId in seen_candidates:
            errors.append(f"duplicate candidateId {a.candidateId}")
        seen_candidates.add(a.candidateId)
        if a.hallSeatId not in seat_ids:
            errors.append(f"unknown hallSeatId {a.hallSeatId}")
        if a.hallSeatId in seen_seats:
            errors.append(f"duplicate hallSeatId {a.hallSeatId}")
        seen_seats.add(a.hallSeatId)

    if len(assignments) != len({a.candidateId for a in assignments}):
        errors.append("assignedCount != unique assigned candidates")
    if len(assignments) != len({a.hallSeatId for a in assignments}):
        errors.append("assignedCount != unique assigned seats")
    return errors


def compute_validation_report(request: SolveRequest, assignments: list[Assignment]) -> dict:
    """§29 — exact pairwise validation metrics over the active-seat graph."""
    candidates_by_id = {c.id: c for c in request.candidates}
    seats_by_hall: dict[str, list[tuple[str, str, int]]] = defaultdict(list)
    hall_of_seat: dict[str, str] = {}
    for hall in request.halls:
        for seat in hall.seats:
            seats_by_hall[hall.id].append((seat.id, seat.row, seat.column))
            hall_of_seat[seat.id] = hall.id

    seen_candidates: set[str] = set()
    seen_seats: set[str] = set()
    duplicate_candidate_count = 0
    duplicate_seat_count = 0
    occupant: dict[str, Candidate] = {}
    halls_used: set[str] = set()

    for a in assignments:
        if a.candidateId in seen_candidates:
            duplicate_candidate_count += 1
        seen_candidates.add(a.candidateId)
        if a.hallSeatId in seen_seats:
            duplicate_seat_count += 1
        seen_seats.add(a.hallSeatId)
        halls_used.add(a.hallId)
        occupant[a.hallSeatId] = candidates_by_id.get(a.candidateId)

    same_class_adjacent = 0
    same_department_adjacent = 0
    for hall_id, seats in seats_by_hall.items():
        ordered = sorted(seats, key=lambda t: (ord(t[1].upper()) - ord("A"), t[2]))
        for i in range(len(ordered)):
            for j in range(i + 1, len(ordered)):
                seat_a, row_a, col_a = ordered[i]
                seat_b, row_b, col_b = ordered[j]
                if max(abs(ord(row_a.upper()) - ord(row_b.upper())), abs(col_a - col_b)) != 1:
                    continue
                cand_a = occupant.get(seat_a)
                cand_b = occupant.get(seat_b)
                if cand_a is None or cand_b is None:
                    continue
                if cand_a.class_ == cand_b.class_:
                    same_class_adjacent += 1
                if cand_a.department == cand_b.department:
                    same_department_adjacent += 1

    return {
        "candidateCount": len(request.candidates),
        "assignedCount": len(assignments),
        "unassignedCount": len(request.candidates) - len(assignments),
        "duplicateCandidateCount": duplicate_candidate_count,
        "duplicateSeatCount": duplicate_seat_count,
        "sameClassAdjacentCount": same_class_adjacent,
        "sameDepartmentAdjacentCount": same_department_adjacent,
        "hallsUsed": len(halls_used),
    }


def required_zeros(report: dict) -> bool:
    """§29 — the four required V1 correctness zeros."""
    return (
        report["sameClassAdjacentCount"] == 0
        and report["unassignedCount"] == 0
        and report["duplicateCandidateCount"] == 0
        and report["duplicateSeatCount"] == 0
    )