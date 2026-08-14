"""Adjacency graph over active seats (8-neighbourhood) and seat/candidate ordering.

Only seats present in the request hall seat lists are "active". Seats absent from a
hall's grid (inactive) never appear here and therefore never impose restrictions.
"""
from __future__ import annotations

from dataclasses import dataclass

from .models import Candidate, Hall, SolveRequest


@dataclass(frozen=True)
class SeatNode:
    index: int
    seat_id: str
    hall_id: str
    hall_number: str
    row: str
    column: int

    @property
    def row_index(self) -> int:
        return ord(self.row.upper()) - ord("A")


def ordered_seats(request: SolveRequest) -> list[SeatNode]:
    """halls by hallNumber asc; seats by row asc then column asc (within hall) — §14."""
    seats: list[SeatNode] = []
    for hall in sorted(request.halls, key=lambda h: h.hallNumber):
        for seat in sorted(hall.seats, key=lambda s: (ord(s.row.upper()) - ord("A"), s.column)):
            seats.append(
                SeatNode(
                    index=len(seats),
                    seat_id=seat.id,
                    hall_id=hall.id,
                    hall_number=hall.hallNumber,
                    row=seat.row,
                    column=seat.column,
                )
            )
    return seats


def ordered_candidates(request: SolveRequest) -> list[Candidate]:
    """candidates by registerNumber asc, then id asc (stable) — §14."""
    return sorted(request.candidates, key=lambda c: (c.registerNumber, c.id))


def is_adjacent(a: SeatNode, b: SeatNode) -> bool:
    """Chebyshev distance exactly 1, same hall — §8."""
    if a.hall_id != b.hall_id:
        return False
    if a is b or a.seat_id == b.seat_id:
        return False
    return max(abs(a.row_index - b.row_index), abs(a.column - b.column)) == 1


def build_edges(seats: list[SeatNode]) -> list[tuple[int, int]]:
    edges: list[tuple[int, int]] = []
    for i in range(len(seats)):
        for j in range(i + 1, len(seats)):
            if is_adjacent(seats[i], seats[j]):
                edges.append((i, j))
    return edges


def neighbors_of(seats: list[SeatNode], edges: list[tuple[int, int]]) -> list[list[int]]:
    adjacency: list[list[int]] = [[] for _ in seats]
    for i, j in edges:
        adjacency[i].append(j)
        adjacency[j].append(i)
    return adjacency


def degrees(adjacency: list[list[int]]) -> list[int]:
    return [len(n) for n in adjacency]


def total_active_seats(request: SolveRequest) -> int:
    return sum(len(h.seats) for h in request.halls)


def sorted_halls(request: SolveRequest) -> list[Hall]:
    return sorted(request.halls, key=lambda h: h.hallNumber)
