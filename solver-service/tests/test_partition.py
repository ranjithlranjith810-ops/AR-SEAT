"""Phase B — Domain partitioner tests (§38)."""
from app.graph import PhysicalSeatGraph
from app.models import Candidate, Hall
from app.partition import (
    ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT,
    DomainPartitioner,
    allocate_candidates_to_domains,
    partition_request,
    topology_anomaly_evidence,
)
from tests.helpers import make_candidate, make_hall


def _halls(*halls):
    return [Hall(**h) for h in halls]


def _cands(ids, dept_fn):
    return [Candidate(**make_candidate(i, "CSE-A", dept_fn(i))) for i in ids]


def test_single_hall_is_one_component():
    g = PhysicalSeatGraph.build(_halls(make_hall("h1", "LH09", 3, 3)))
    p = DomainPartitioner(g)
    assert len(p.domains()) == 1
    assert p.domains()[0].seat_count == 9


def test_isolated_halls_are_separate_components():
    g = PhysicalSeatGraph.build(_halls(make_hall("h1", "LH09", 2, 2), make_hall("h2", "LH13", 2, 2)))
    p = DomainPartitioner(g)
    domains = p.domains()
    assert len(domains) == 2
    assert all(d.seat_count == 4 for d in domains)
    assert domains[0].hall_ids != domains[1].hall_ids


def test_partition_invariants_hold():
    g = PhysicalSeatGraph.build(_halls(make_hall("h1", "LH09", 2, 3), make_hall("h2", "LH13", 2, 2)))
    p = DomainPartitioner(g)
    assert p.verify_partition_invariants() == []


def test_every_candidate_allocated_exactly_once():
    g = PhysicalSeatGraph.build(_halls(make_hall("h1", "LH09", 2, 2), make_hall("h2", "LH13", 2, 2)))
    candidates = _cands(range(8), lambda i: f"D{i % 2}")
    p = DomainPartitioner(g)
    domains = allocate_candidates_to_domains(candidates, p.domains())
    all_ids = [cid for d in domains for cid in d.candidate_ids]
    assert sorted(all_ids) == sorted(f"cand-{i}" for i in range(8))


def test_allocation_respects_seat_capacity():
    g = PhysicalSeatGraph.build(_halls(make_hall("h1", "LH09", 2, 2), make_hall("h2", "LH13", 2, 2)))
    candidates = _cands(range(8), lambda i: f"D{i % 2}")
    p = DomainPartitioner(g)
    domains = allocate_candidates_to_domains(candidates, p.domains())
    assert all(d.candidate_count <= d.seat_count for d in domains)


def test_oversized_component_flagged():
    # 4x3 hall = 12 seats, 12 candidates, ceiling 10 -> capacity ok but oversized
    g = PhysicalSeatGraph.build(_halls(make_hall("h1", "LH09", 4, 3)))
    candidates = _cands(range(12), lambda i: f"D{i % 2}")
    result = partition_request(candidates, g, max_domain_candidates=10)
    assert result.oversized
    assert any(ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT in e for e in result.errors)


def test_topology_anomaly_evidence():
    g = PhysicalSeatGraph.build(_halls(make_hall("h1", "LH09", 4, 3)))
    candidates = _cands(range(12), lambda i: "D")
    result = partition_request(candidates, g, max_domain_candidates=10)
    d = result.oversized[0]
    evidence = topology_anomaly_evidence(d, max_domain_candidates=10, graph=g)
    assert evidence["candidate_count"] == 12
    assert evidence["ceiling"] == 10
    assert evidence["adjacency_edges_within_domain"]


def test_allocation_error_when_capacity_exhausted():
    g = PhysicalSeatGraph.build(_halls(make_hall("h1", "LH09", 2, 2)))
    candidates = _cands(range(9), lambda i: "D")
    result = partition_request(candidates, g)
    assert any("no domain has free seat capacity" in e for e in result.errors)