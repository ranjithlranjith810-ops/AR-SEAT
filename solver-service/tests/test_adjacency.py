"""Adjacency (8-neighbourhood) computation tests."""
from app import constraints as cst
from app.models import SolveRequest
from tests.helpers import make_hall, make_request


def _req() -> SolveRequest:
    return SolveRequest(**make_request([], [make_hall("h1", "LH09", 3, 3)]))


def test_adjacent_pairs_3x3():
    seats = cst.ordered_seats(_req())
    edges = cst.build_edges(seats)
    by_id = {s.seat_id: s for s in seats}

    def adjacent(a: str, b: str) -> bool:
        return cst.is_adjacent(by_id[a], by_id[b])

    assert adjacent("h1-A1", "h1-A2")
    assert adjacent("h1-A1", "h1-B1")
    assert adjacent("h1-A1", "h1-B2")
    assert not adjacent("h1-A1", "h1-A3")
    assert not adjacent("h1-A1", "h1-C1")
    assert not adjacent("h1-A1", "h1-C3")
    assert not adjacent("h1-A1", "h1-A1")


def test_degree_3x3():
    seats = cst.ordered_seats(_req())
    edges = cst.build_edges(seats)
    adjacency = cst.neighbors_of(seats, edges)
    deg = cst.degrees(adjacency)
    by_id = {s.seat_id: s.index for s in seats}
    assert deg[by_id["h1-A1"]] == 3
    assert deg[by_id["h1-A2"]] == 5
    assert deg[by_id["h1-B2"]] == 8
    assert sum(deg) == 2 * len(edges)


def test_inactive_seats_are_not_neighbours():
    hall = make_hall("h1", "LH09", 3, 3, active_rows=[0], active_columns=[0, 1])
    seats = cst.ordered_seats(SolveRequest(**make_request([], [hall])))
    edges = cst.build_edges(seats)
    assert len(seats) == 2
    assert len(edges) == 1
    assert edges == [(0, 1)]


def test_different_halls_never_adjacent():
    h1 = make_hall("h1", "LH09", 2, 2)
    h2 = make_hall("h2", "LH13", 2, 2)
    req = SolveRequest(**make_request([], [h1, h2]))
    seats = cst.ordered_seats(req)
    edges = cst.build_edges(seats)
    hall_sets = [s.hall_id for s in seats]
    for a, b in edges:
        assert hall_sets[a] == hall_sets[b]


def test_ordering_hall_then_row_then_column():
    h2 = make_hall("h2", "LH13", 2, 3)
    h1 = make_hall("h1", "LH09", 2, 3)
    req = SolveRequest(**make_request([], [h2, h1]))
    seats = cst.ordered_seats(req)
    assert [s.seat_id for s in seats] == [
        "h1-A1",
        "h1-A2",
        "h1-A3",
        "h1-B1",
        "h1-B2",
        "h1-B3",
        "h2-A1",
        "h2-A2",
        "h2-A3",
        "h2-B1",
        "h2-B2",
        "h2-B3",
    ]
