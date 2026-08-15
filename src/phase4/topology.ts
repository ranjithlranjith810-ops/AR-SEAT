/**
 * Phase 4 — physical interaction graph (faithful mirror of solver-service graph.py).
 *
 * The production solver boundary is the PHYSICAL connected component, never an
 * unverified hall name. This module builds the seat graph (8/cardinal adjacency
 * within each hall, plus explicitly-configured cross-hall edges), computes
 * connected components by Union-Find, and verifies the partition invariants
 * (every seat in exactly one domain, no cross-domain adjacency edge) exactly
 * like the frozen Python partitioner.
 */
import type { DomainHall } from "./types";

export type AdjacencyMode = "eight" | "cardinal";

export interface SeatGraphNode {
  index: number;
  seatId: string;
  hallId: string;
  hallNumber: string;
  building: string | null;
  row: string;
  column: number;
}

export interface SeatGraphEdge {
  from: number;
  to: number;
}

export interface CrossHallEdgeInput {
  fromSeatId: string;
  toSeatId: string;
}

export interface PhysicalSeatGraph {
  nodes: SeatGraphNode[];
  edges: SeatGraphEdge[];
  adjacency: AdjacencyMode;
  crossHallEdges: SeatGraphEdge[];
}

export function rowIndex(row: string): number {
  return row.toUpperCase().charCodeAt(0) - 65;
}

/**
 * Build nodes + adjacency edges from active halls. Cross-hall edges are ONLY
 * added when explicitly configured; hall isolation is verified afterwards and
 * never silently assumed.
 */
export function buildPhysicalGraph(
  halls: DomainHall[],
  adjacency: AdjacencyMode = "eight",
  crossHallEdges: CrossHallEdgeInput[] = [],
): PhysicalSeatGraph {
  const nodes: SeatGraphNode[] = [];
  for (const hall of [...halls].sort((a, b) => a.hallNumber.localeCompare(b.hallNumber))) {
    for (const seat of [...hall.seats].sort(
      (a, b) => rowIndex(a.row) - rowIndex(b.row) || a.column - b.column,
    )) {
      const ri = rowIndex(seat.row);
      if (!(ri >= 0 && ri < hall.rows)) {
        throw new Error(`seat ${seat.id}: row ${seat.row} outside ${hall.rows}-row grid`);
      }
      if (!(seat.column >= 1 && seat.column <= hall.columns)) {
        throw new Error(`seat ${seat.id}: column ${seat.column} outside ${hall.columns}-column grid`);
      }
      nodes.push({
        index: nodes.length,
        seatId: seat.id,
        hallId: hall.id,
        hallNumber: hall.hallNumber,
        building: hall.building,
        row: seat.row,
        column: seat.column,
      });
    }
  }

  const seatIndexById = new Map(nodes.map((n) => [n.seatId, n.index]));
  const seen = new Set<string>();
  const edges: SeatGraphEdge[] = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (a.hallId !== b.hallId) continue;
      const dr = Math.abs(rowIndex(a.row) - rowIndex(b.row));
      const dc = Math.abs(a.column - b.column);
      const adjacent =
        adjacency === "eight" ? Math.max(dr, dc) === 1 : (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
      if (!adjacent) continue;
      const key = `${i}|${j}`;
      if (seen.has(key)) throw new Error(`duplicate adjacency edge (${i}, ${j})`);
      seen.add(key);
      edges.push({ from: i, to: j });
    }
  }

  for (const ce of crossHallEdges) {
    const i = seatIndexById.get(ce.fromSeatId);
    const j = seatIndexById.get(ce.toSeatId);
    if (i === undefined || j === undefined) {
      throw new Error(`cross-hall edge references unknown seat (${ce.fromSeatId} <-> ${ce.toSeatId})`);
    }
    if (nodes[i]!.hallId === nodes[j]!.hallId) {
      throw new Error(`cross-hall edge between same-hall seats (${ce.fromSeatId} <-> ${ce.toSeatId})`);
    }
    const key = `${i}|${j}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ from: i, to: j });
    }
  }

  const crossHallEdgesDetected = edges.filter(
    (e) => nodes[e.from]!.hallId !== nodes[e.to]!.hallId,
  );

  return { nodes, edges, adjacency, crossHallEdges: crossHallEdgesDetected };
}

export class UnionFind {
  private readonly parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(x: number): number {
    let current = x;
    while (this.parent[current] !== current) {
      const grandparent = this.parent[this.parent[current] ?? current] ?? current;
      this.parent[current] = grandparent;
      current = this.parent[current] ?? current;
    }
    return current;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

export function connectedComponents(graph: PhysicalSeatGraph): number[][] {
  const uf = new UnionFind(graph.nodes.length);
  for (const edge of graph.edges) uf.union(edge.from, edge.to);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < graph.nodes.length; i++) {
    const root = uf.find(i);
    const bucket = groups.get(root) ?? [];
    bucket.push(i);
    groups.set(root, bucket);
  }
  for (const seats of groups.values()) seats.sort((a, b) => a - b);
  return [...groups.values()];
}

export interface ComponentDomains {
  domainId: string;
  seatIndices: number[];
}

export function verifyPartitionInvariants(
  graph: PhysicalSeatGraph,
  domains: ComponentDomains[],
): string[] {
  const errors: string[] = [];
  const seatOfDomain = new Map<number, string>();
  for (const domain of domains) {
    for (const s of domain.seatIndices) {
      if (seatOfDomain.has(s)) {
        errors.push(`seat index ${s} appears in multiple domains`);
      }
      seatOfDomain.set(s, domain.domainId);
    }
  }
  for (let s = 0; s < graph.nodes.length; s++) {
    if (!seatOfDomain.has(s)) {
      errors.push(`seat index ${s} missing from every domain`);
    }
  }
  for (const edge of graph.edges) {
    if (seatOfDomain.get(edge.from) !== seatOfDomain.get(edge.to)) {
      errors.push(
        `cross-domain adjacency edge (${edge.from}, ${edge.to}): ` +
          `${seatOfDomain.get(edge.from)} <-> ${seatOfDomain.get(edge.to)}`,
      );
    }
  }
  return errors;
}

export function topologyAnomalyEvidence(
  graph: PhysicalSeatGraph,
  seatIndices: number[],
  domainId: string,
  candidateCount: number,
  seatCount: number,
  ceiling: number,
  hallIds: string[],
): {
  domainId: string;
  candidateCount: number;
  seatCount: number;
  ceiling: number;
  hallIds: string[];
  adjacencyEdgesWithinDomain: { from: string; fromHall: string; to: string; toHall: string }[];
} {
  const nodeSet = new Set(seatIndices);
  const adjacencyEdgesWithinDomain = graph.edges
    .filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to))
    .map((e) => ({
      from: graph.nodes[e.from]!.seatId,
      fromHall: graph.nodes[e.from]!.hallNumber,
      to: graph.nodes[e.to]!.seatId,
      toHall: graph.nodes[e.to]!.hallNumber,
    }));
  return {
    domainId,
    candidateCount,
    seatCount,
    ceiling,
    hallIds,
    adjacencyEdgesWithinDomain,
  };
}