"""Phase A — Physical interaction graph (§20, §21, §37).

A physical seating domain is defined by the interaction graph, not merely by a
building name. Each seat is a graph node; an edge exists when two seats have an
adjacency relationship relevant to the seating policy.

Adjacency is explicit configuration (never inferred): the default is the
8-neighbourhood within the same hall (horizontal + vertical + diagonal, matching
the legacy formulation so Phase D equivalence holds); ``cardinal`` restricts to
horizontal + vertical only. Cross-hall adjacency is forbidden by default and any
cross-hall edge is reported as a hall-isolation violation (§23).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .models import Hall

ADJACENCY_EIGHT = "eight"
ADJACENCY_CARDINAL = "cardinal"


@dataclass(frozen=True)
class SeatNode:
    index: int
    seat_id: str
    hall_id: str
    hall_number: str
    building: Optional[str]
    row: str
    column: int

    @property
    def row_index(self) -> int:
        return ord(self.row.upper()) - ord("A")


class PhysicalSeatGraph:
    """Seat nodes + adjacency edges, with geometry and isolation validation."""

    def __init__(
        self,
        nodes: list[SeatNode],
        edges: list[tuple[int, int]],
        adjacency: str,
        cross_hall_edges: list[tuple[int, int]],
    ) -> None:
        self.nodes = nodes
        self.edges = edges
        self.adjacency = adjacency
        self.cross_hall_edges = cross_hall_edges
        self._adjacency_list: list[list[int]] = [[] for _ in nodes]
        for i, j in edges:
            self._adjacency_list[i].append(j)
            self._adjacency_list[j].append(i)

    @classmethod
    def build(
        cls,
        halls: list[Hall],
        adjacency: str = ADJACENCY_EIGHT,
        allow_cross_hall_adjacency: bool = False,
    ) -> "PhysicalSeatGraph":
        """Build the physical seat graph from active hall seats.

        Raises ``ValueError`` on invalid geometry (seat outside grid) or when a
        cross-hall adjacency is produced but not allowed.
        """
        if adjacency not in (ADJACENCY_EIGHT, ADJACENCY_CARDINAL):
            raise ValueError(f"unknown adjacency mode {adjacency!r}")

        nodes: list[SeatNode] = []
        for hall in sorted(halls, key=lambda h: h.hallNumber):
            for seat in sorted(hall.seats, key=lambda s: (ord(s.row.upper()) - ord("A"), s.column)):
                row_index = ord(seat.row.upper()) - ord("A")
                if not (0 <= row_index < hall.rows):
                    raise ValueError(f"seat {seat.id!r}: row {seat.row!r} outside {hall.rows}-row grid")
                if not (1 <= seat.column <= hall.columns):
                    raise ValueError(f"seat {seat.id!r}: column {seat.column} outside {hall.columns}-column grid")
                nodes.append(
                    SeatNode(
                        index=len(nodes),
                        seat_id=seat.id,
                        hall_id=hall.id,
                        hall_number=hall.hallNumber,
                        building=hall.building,
                        row=seat.row,
                        column=seat.column,
                    )
                )

        edges: list[tuple[int, int]] = []
        seen: set[tuple[int, int]] = set()
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                a, b = nodes[i], nodes[j]
                if a.hall_id != b.hall_id:
                    continue
                dr = abs(a.row_index - b.row_index)
                dc = abs(a.column - b.column)
                if adjacency == ADJACENCY_EIGHT:
                    adjacent = max(dr, dc) == 1
                else:
                    adjacent = (dr == 1 and dc == 0) or (dr == 0 and dc == 1)
                if not adjacent:
                    continue
                if (i, j) in seen:
                    raise ValueError(f"duplicate adjacency edge ({i}, {j})")
                seen.add((i, j))
                edges.append((i, j))

        cross_hall_edges: list[tuple[int, int]] = []
        for i, j in edges:
            if nodes[i].hall_id != nodes[j].hall_id:
                cross_hall_edges.append((i, j))

        if cross_hall_edges and not allow_cross_hall_adjacency:
            raise ValueError(
                f"cross-hall adjacency produced ({len(cross_hall_edges)} edge(s)); "
                "hall isolation violated"
            )

        return cls(nodes=nodes, edges=edges, adjacency=adjacency, cross_hall_edges=cross_hall_edges)

    def adjacency_list(self) -> list[list[int]]:
        return self._adjacency_list

    def degrees(self) -> list[int]:
        return [len(n) for n in self._adjacency_list]

    def hall_ids(self) -> list[str]:
        seen: list[str] = []
        for node in self.nodes:
            if node.hall_id not in seen:
                seen.append(node.hall_id)
        return seen

    def edge_seat_pairs(self) -> list[tuple[SeatNode, SeatNode]]:
        return [(self.nodes[i], self.nodes[j]) for i, j in self.edges]

    def isolation_errors(self) -> list[str]:
        """Hall-isolation check: every edge must be within one hall (§23)."""
        errors: list[str] = []
        for i, j in self.cross_hall_edges:
            errors.append(
                f"cross-hall adjacency: {self.nodes[i].seat_id} ({self.nodes[i].hall_number}) "
                f"<-> {self.nodes[j].seat_id} ({self.nodes[j].hall_number})"
            )
        return errors

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"PhysicalSeatGraph(nodes={len(self.nodes)}, edges={len(self.edges)}, "
            f"adjacency={self.adjacency!r}, crossHallEdges={len(self.cross_hall_edges)})"
        )