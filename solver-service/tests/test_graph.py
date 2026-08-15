"""Phase A — Physical interaction graph tests (§37)."""
import pytest

from app.graph import PhysicalSeatGraph
from app.models import Hall
from tests.helpers import make_hall


def _graph(*halls, adjacency="eight", **kw):
    if len(halls) == 1 and isinstance(halls[0], (list, tuple)):
        halls = tuple(halls[0])
    return PhysicalSeatGraph.build([Hall(**h) for h in halls], adjacency=adjacency, **kw)


def test_horizontal_adjacency():
    g = _graph(make_hall("h1", "LH09", 1, 3))
    assert sorted(g.edges) == [(0, 1), (1, 2)]


def test_vertical_adjacency():
    g = _graph(make_hall("h1", "LH09", 3, 1))
    assert sorted(g.edges) == [(0, 1), (1, 2)]


def test_eight_neighbourhood_3x3():
    g = _graph(make_hall("h1", "LH09", 3, 3))
    by_id = {n.seat_id: n.index for n in g.nodes}
    deg = g.degrees()
    assert deg[by_id["h1-A1"]] == 3
    assert deg[by_id["h1-B2"]] == 8
    assert sum(deg) == 2 * len(g.edges)


def test_cardinal_mode_is_horizontal_vertical_only():
    g = _graph(make_hall("h1", "LH09", 3, 3), adjacency="cardinal")
    by_id = {n.seat_id: n.index for n in g.nodes}
    deg = g.degrees()
    assert deg[by_id["h1-A1"]] == 2
    assert deg[by_id["h1-B2"]] == 4


def test_multiple_halls_never_adjacent():
    g = _graph(make_hall("h1", "LH09", 2, 2), make_hall("h2", "LH13", 2, 2))
    assert not g.cross_hall_edges
    for i, j in g.edges:
        assert g.nodes[i].hall_id == g.nodes[j].hall_id
    assert len(g.hall_ids()) == 2


def test_invalid_row_coordinate_rejected():
    hall = make_hall("h1", "LH09", 2, 2)
    hall["seats"][0]["row"] = "Z"
    with pytest.raises(ValueError):
        _graph(hall)


def test_invalid_column_coordinate_rejected():
    hall = make_hall("h1", "LH09", 2, 2)
    hall["seats"][0]["column"] = 99
    with pytest.raises(ValueError):
        _graph(hall)


def test_unknown_adjacency_mode_rejected():
    with pytest.raises(ValueError):
        _graph(make_hall("h1", "LH09", 2, 2), adjacency="diagonal")


def test_isolation_errors_empty_for_well_formed_graph():
    g = _graph(make_hall("h1", "LH09", 2, 2), make_hall("h2", "LH13", 2, 2))
    assert g.isolation_errors() == []


def test_seat_ordering_by_hall_then_row_then_column():
    g = _graph(make_hall("h2", "LH13", 2, 2), make_hall("h1", "LH09", 2, 2))
    assert [n.seat_id for n in g.nodes] == [
        "h1-A1", "h1-A2", "h1-B1", "h1-B2", "h2-A1", "h2-A2", "h2-B1", "h2-B2",
    ]