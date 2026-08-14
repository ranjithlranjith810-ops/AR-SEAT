"""Stage-2 deterministic O(N) candidate -> seat bijection.

Candidates of a class are placed, in registerNumber order, onto that class's seats in
hall -> row -> column order (§14). No CP-SAT candidate x seat matrix is involved.
"""
from __future__ import annotations

from collections import defaultdict

from . import constraints as cst
from .models import Assignment, Candidate, SolveRequest


def group_key(candidate: Candidate, scope: str) -> str:
    return candidate.class_ if scope == "class" else candidate.department


def assign_candidates(
    request: SolveRequest,
    seats: list[cst.SeatNode],
    pattern: dict[int, str],
) -> list[Assignment]:
    scope = request.solverConfig.hardRuleScope
    candidates = cst.ordered_candidates(request)

    candidates_by_group: dict[str, list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        candidates_by_group[group_key(candidate, scope)].append(candidate)

    seats_by_group: dict[str, list[int]] = defaultdict(list)
    for seat_index, group in pattern.items():
        seats_by_group[group].append(seat_index)

    assignments: list[Assignment] = []
    for group in sorted(candidates_by_group):
        group_candidates = candidates_by_group[group]
        group_seats = sorted(seats_by_group.get(group, []))
        for candidate, seat_index in zip(group_candidates, group_seats):
            seat = seats[seat_index]
            assignments.append(
                Assignment(candidateId=candidate.id, hallId=seat.hall_id, hallSeatId=seat.seat_id)
            )

    seat_key = {s.seat_id: (s.hall_number, s.row_index, s.column) for s in seats}
    assignments.sort(key=lambda a: seat_key[a.hallSeatId])
    return assignments
