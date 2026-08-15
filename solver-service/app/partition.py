"""Phase B — Dynamic domain partitioner (§22, §23, §38).

Computes connected components of the physical interaction graph. Each connected
component is a candidate solver domain. The partitioner enforces the three
partition invariants (§9, §10, §38):

- every candidate -> exactly one domain
- every seat -> exactly one domain
- every adjacency edge -> one domain

and provides the topology ceiling guard (§24) with topology anomaly evidence
(§25). An oversized domain is rejected before CP-SAT is ever instantiated.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from .graph import PhysicalSeatGraph
from .models import Candidate

MAX_DOMAIN_CANDIDATES_DEFAULT = 1000

ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT = "ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT"
ERR_INVALID_DOMAIN_ASSIGNMENT = "ERR_INVALID_DOMAIN_ASSIGNMENT"


@dataclass
class Domain:
    domain_id: str
    seat_indices: list[int] = field(default_factory=list)
    hall_ids: list[str] = field(default_factory=list)
    building_ids: list[str] = field(default_factory=list)
    candidate_ids: list[str] = field(default_factory=list)

    @property
    def seat_count(self) -> int:
        return len(self.seat_indices)

    @property
    def candidate_count(self) -> int:
        return len(self.candidate_ids)


@dataclass
class PartitionResult:
    domains: list[Domain]
    errors: list[str] = field(default_factory=list)
    oversized: list[Domain] = field(default_factory=list)


class _UnionFind:
    def __init__(self, n: int) -> None:
        self._parent = list(range(n))

    def find(self, x: int) -> int:
        while self._parent[x] != x:
            self._parent[x] = self._parent[self._parent[x]]
            x = self._parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self._parent[rb] = ra


class DomainPartitioner:
    """Connected components of the seat graph; each component is one domain."""

    def __init__(self, graph: PhysicalSeatGraph) -> None:
        self.graph = graph
        self._components = self._connected_components()

    def _connected_components(self) -> list[list[int]]:
        uf = _UnionFind(len(self.graph.nodes))
        for i, j in self.graph.edges:
            uf.union(i, j)
        groups: dict[int, list[int]] = {}
        for idx in range(len(self.graph.nodes)):
            root = uf.find(idx)
            groups.setdefault(root, []).append(idx)
        for seats in groups.values():
            seats.sort()
        return list(groups.values())

    def domains(self) -> list[Domain]:
        domains: list[Domain] = []
        for i, seats in enumerate(self._components):
            hall_ids: list[str] = []
            building_ids: list[str] = []
            for s in seats:
                node = self.graph.nodes[s]
                if node.hall_id not in hall_ids:
                    hall_ids.append(node.hall_id)
                if node.building is not None and node.building not in building_ids:
                    building_ids.append(node.building)
            domains.append(
                Domain(
                    domain_id=f"component-{i:02d}",
                    seat_indices=seats,
                    hall_ids=hall_ids,
                    building_ids=building_ids,
                )
            )
        return domains

    def verify_partition_invariants(self) -> list[str]:
        """§38 invariants: every seat/edge in exactly one domain; edges never cross domains."""
        errors: list[str] = []
        seat_of_domain: dict[int, str] = {}
        for domain in self.domains():
            for s in domain.seat_indices:
                if s in seat_of_domain:
                    errors.append(f"seat index {s} appears in multiple domains")
                seat_of_domain[s] = domain.domain_id
        for s in range(len(self.graph.nodes)):
            if s not in seat_of_domain:
                errors.append(f"seat index {s} missing from every domain")
        for i, j in self.graph.edges:
            if seat_of_domain.get(i) != seat_of_domain.get(j):
                errors.append(
                    f"cross-domain adjacency edge ({i}, {j}): "
                    f"{seat_of_domain.get(i)} <-> {seat_of_domain.get(j)}"
                )
        return errors

def allocate_candidates_to_domains(
    candidates: list[Candidate],
    domains: list[Domain],
    department_key: Callable[[Candidate], str] = lambda c: c.department,
) -> list[Domain]:
    """Deterministic balanced candidate allocation for benchmarking/scheduling.

    Candidates of each department (in register order) are distributed
    round-robin across domains that still have free seat capacity. This keeps
    every domain's department mix balanced and its count within its seat count.
    """
    seat_counts = [d.seat_count for d in domains]
    filled = [0] * len(domains)
    assigned: list[list[str]] = [[] for _ in domains]

    by_department: dict[str, list[Candidate]] = {}
    for c in candidates:
        by_department.setdefault(department_key(c), []).append(c)

    domain_order = list(range(len(domains)))
    for dept in sorted(by_department):
        cursor = 0
        for candidate in sorted(by_department[dept], key=lambda c: (c.registerNumber, c.id)):
            for _ in range(len(domains)):
                d = domain_order[cursor % len(domain_order)]
                cursor += 1
                if filled[d] < seat_counts[d]:
                    assigned[d].append(candidate.id)
                    filled[d] += 1
                    break
            else:
                raise ValueError(f"no domain has free seat capacity for candidate {candidate.id}")

    for d, domain in enumerate(domains):
        domain.candidate_ids = assigned[d]
    return domains


def partition_request(
    candidates: list[Candidate],
    graph: PhysicalSeatGraph,
    max_domain_candidates: int = MAX_DOMAIN_CANDIDATES_DEFAULT,
) -> PartitionResult:
    """Full §38 pipeline: build domains, verify invariants, allocate candidates, ceiling."""
    partitioner = DomainPartitioner(graph)
    domains = partitioner.domains()
    errors = partitioner.verify_partition_invariants()

    try:
        allocate_candidates_to_domains(candidates, domains)
    except ValueError as exc:
        errors.append(f"{ERR_INVALID_DOMAIN_ASSIGNMENT}: {exc}")

    oversized = [d for d in domains if d.candidate_count > max_domain_candidates]
    for d in oversized:
        errors.append(
            f"{ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT}: domain {d.domain_id} "
            f"candidates={d.candidate_count} exceeds ceiling {max_domain_candidates}"
        )
    return PartitionResult(domains=domains, errors=errors, oversized=oversized)


def topology_anomaly_evidence(
    domain: Domain,
    max_domain_candidates: int = MAX_DOMAIN_CANDIDATES_DEFAULT,
    graph: Optional[PhysicalSeatGraph] = None,
) -> dict:
    """§25 — structured evidence for an oversized domain (recorded, solver must not run)."""
    bridge_edges: list[dict] = []
    if graph is not None:
        nodes = graph.nodes
        for i, j in graph.edges:
            if i in domain.seat_indices and j in domain.seat_indices:
                bridge_edges.append(
                    {
                        "from": nodes[i].seat_id,
                        "fromHall": nodes[i].hall_number,
                        "to": nodes[j].seat_id,
                        "toHall": nodes[j].hall_number,
                    }
                )
    return {
        "domain_id": domain.domain_id,
        "candidate_count": domain.candidate_count,
        "seat_count": domain.seat_count,
        "ceiling": max_domain_candidates,
        "hall_ids": domain.hall_ids,
        "building_ids": domain.building_ids,
        "adjacency_edges_within_domain": bridge_edges,
    }