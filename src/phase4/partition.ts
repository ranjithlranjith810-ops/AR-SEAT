/**
 * Phase 4 — physical-domain partitioning + pre-dispatch guards (§4, §5, §6).
 *
 * Domain boundary = CONNECTED COMPONENT of the physical seat graph (faithful
 * mirror of the frozen Python partitioner, partition.py). Hall names are NEVER
 * used as proof of independence: if a configured cross-hall adjacency edge
 * connects two halls, they belong to the same solver domain. The three
 * partition invariants are computed and verified explicitly.
 *
 * Guards mirror the FROZEN Python guard semantics (guards.py): risk ratios are
 * configurable scheduling signals, NOT infeasibility proofs; the only true
 * capacity error is candidateCount > seatCount.
 */
import { GUARD_ERR_CODES, MAX_DOMAIN_CANDIDATES } from "./types";
import type {
  DomainCandidate,
  DomainGuardResult,
  DomainHall,
  DomainPlan,
  GuardClassification,
} from "./types";
import {
  buildPhysicalGraph,
  connectedComponents,
  verifyPartitionInvariants,
  topologyAnomalyEvidence,
  type AdjacencyMode,
  type CrossHallEdgeInput,
} from "./topology";

export interface CompositionLimits {
  largestDepartmentRatio: number;
  largestYearRatio: number;
  largestCohortRatio: number;
  maxEmptySeatRatio: number;
  /** Topology ceiling (§24) — maximum candidates per connected component. */
  maxDomainCandidates?: number;
}

export const DEFAULT_COMPOSITION_LIMITS: CompositionLimits = {
  largestDepartmentRatio: 0.6,
  largestYearRatio: 0.7,
  largestCohortRatio: 0.5,
  maxEmptySeatRatio: 0.8,
  maxDomainCandidates: MAX_DOMAIN_CANDIDATES,
};

export interface PartitionInput {
  candidates: DomainCandidate[];
  halls: DomainHall[];
  adjacency?: AdjacencyMode;
  crossHallEdges?: CrossHallEdgeInput[];
}

export interface PartitionOutcome {
  domains: DomainPlan[];
  /** True when the session cannot be seated as requested (STOP signal). */
  blocked: boolean;
  blockedReason: string | null;
  unallocatedCount: number;
  /** Any partition-invariant violation (every seat/edge in exactly one domain). */
  invariantErrors: string[];
}

export interface ComponentTopology {
  graphNodes: number;
  graphEdges: number;
  crossHallEdgeCount: number;
  anomalyEvidence: ReturnType<typeof topologyAnomalyEvidence>;
}

/**
 * Balanced allocation: candidates are allocated round-robin across domains
 * (per department, register order) respecting seat capacity — mirroring the
 * frozen allocate_candidates_to_domains. Every domain receives a balanced mix.
 */
export function partitionCandidates(
  input: PartitionInput,
  limits: CompositionLimits = DEFAULT_COMPOSITION_LIMITS,
  maxDomainCandidates: number = MAX_DOMAIN_CANDIDATES,
): PartitionOutcome {
  const { candidates, halls } = input;
  const adjacency = input.adjacency ?? "eight";
  const crossHallEdges = input.crossHallEdges ?? [];

  const graph = buildPhysicalGraph(halls, adjacency, crossHallEdges);
  const components = connectedComponents(graph);
  const indexBySeatId = new Map(graph.nodes.map((n) => [n.seatId, n.index]));

  const totalCapacity = halls.reduce((sum, h) => sum + h.capacity, 0);
  if (candidates.length > totalCapacity) {
    return {
      domains: [],
      blocked: true,
      blockedReason: "insufficient aggregate seat capacity",
      unallocatedCount: candidates.length - totalCapacity,
      invariantErrors: [],
    };
  }

  const domains: DomainPlan[] = components.map((seatIndices, i) => {
    const componentHalls = new Map<string, DomainHall>();
    for (const idx of seatIndices) {
      const node = graph.nodes[idx]!;
      const hall = halls.find((h) => h.id === node.hallId);
      if (hall) componentHalls.set(hall.id, hall);
    }
    const hallList = [...componentHalls.values()].sort((a, b) =>
      a.hallNumber.localeCompare(b.hallNumber),
    );
    const domainId = `D-${hallList.map((h) => h.hallNumber).join("+") || `component-${i}`}`;
    return {
      domainId,
      hallIds: hallList.map((h) => h.id),
      hallNumbers: hallList.map((h) => h.hallNumber),
      halls: hallList,
      seats: hallList.flatMap((h) => h.seats),
      candidates: [],
      seatCount: hallList.reduce((sum, h) => sum + h.capacity, 0),
      candidateCount: 0,
      guard: { classification: "BALANCED", riskViolations: [] },
      blocked: false,
      blockedReason: null,
    };
  });

  // Partition invariants (explicit, not assumed): every seat in exactly one
  // domain and no adjacency edge spans two domains.
  const invariantErrors = verifyPartitionInvariants(
    graph,
    domains.map((d) => ({
      domainId: d.domainId,
      seatIndices: d.seats
        .map((s) => indexBySeatId.get(s.id))
        .filter((idx): idx is number => idx !== undefined),
    })),
  );

  // Candidate allocation: per department (sorted), round-robin across domains.
  const byDepartment = new Map<string, DomainCandidate[]>();
  for (const c of candidates) {
    const bucket = byDepartment.get(c.department) ?? [];
    bucket.push(c);
    byDepartment.set(c.department, bucket);
  }

  const capacityByDomain = domains.map((d) => d.seatCount);
  const assigned = domains.map(() => 0);
  const domainCount = domains.length;
  let allocationFailed: string | null = null;

  for (const dept of [...byDepartment.keys()].sort()) {
    let cursor = 0;
    const sorted = byDepartment.get(dept)!.slice().sort((a, b) => {
      const reg = a.registerNumber.localeCompare(b.registerNumber);
      return reg !== 0 ? reg : a.id.localeCompare(b.id);
    });
    candidateLoop: for (const candidate of sorted) {
      for (let attempt = 0; attempt < domainCount; attempt++) {
        const d = cursor % domainCount;
        cursor += 1;
        if (assigned[d]! < capacityByDomain[d]!) {
          domains[d]!.candidates.push(candidate);
          assigned[d] = (assigned[d] ?? 0) + 1;
          continue candidateLoop;
        }
      }
      allocationFailed =
        allocationFailed ?? `no domain has free seat capacity for candidate ${candidate.id}`;
    }
  }

  // Guards (pre-dispatch validation per domain, §6) + topology ceiling (§24).
  let blocked = false;
  let blockedReason: string | null = null;
  for (const domain of domains) {
    domain.candidateCount = domain.candidates.length;
    domain.guard = computeCompositionGuard(domain.candidates, domain.seatCount, limits);
    if (domain.guard.classification === "INSUFFICIENT_CAPACITY") {
      domain.blocked = true;
      domain.blockedReason = GUARD_ERR_CODES.INSUFFICIENT_CAPACITY;
      blocked = true;
      blockedReason = blockedReason ?? `${domain.domainId}: candidates > seats`;
    } else if (domain.candidateCount > (limits.maxDomainCandidates ?? maxDomainCandidates)) {
      domain.blocked = true;
      domain.blockedReason = GUARD_ERR_CODES.TOPOLOGY_OVERSIZED;
      blocked = true;
      blockedReason = blockedReason ?? GUARD_ERR_CODES.TOPOLOGY_OVERSIZED;
    }
  }

  const unallocatedCount = candidates.length - assigned.reduce((a, b) => a + b, 0);
  if (allocationFailed) {
    blocked = true;
    blockedReason = allocationFailed;
  }
  if (invariantErrors.length > 0) {
    blocked = true;
    blockedReason = blockedReason ?? invariantErrors[0]!;
  }

  return { domains, blocked, blockedReason, unallocatedCount, invariantErrors };
}

/** Faithful mirror of the frozen Python composition guard (guards.py). */
export function computeCompositionGuard(
  candidates: DomainCandidate[],
  seatCount: number,
  limits: CompositionLimits = DEFAULT_COMPOSITION_LIMITS,
): DomainGuardResult {
  const candidateCount = candidates.length;
  if (candidateCount > seatCount) {
    return {
      classification: "INSUFFICIENT_CAPACITY",
      riskViolations: [
        `${GUARD_ERR_CODES.INSUFFICIENT_CAPACITY}: candidates=${candidateCount} > seats=${seatCount}`,
      ],
    };
  }

  const departmentCounts = new Map<string, number>();
  const yearCounts = new Map<string, number>();
  const cohortCounts = new Map<string, number>();
  for (const c of candidates) {
    departmentCounts.set(c.department, (departmentCounts.get(c.department) ?? 0) + 1);
    const year = c.year ?? "<none>";
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    const cohort = `${c.department}/${year}`;
    cohortCounts.set(cohort, (cohortCounts.get(cohort) ?? 0) + 1);
  }

  const largestDepartmentCount = maxOf(departmentCounts.values());
  const largestYearCount = maxOf(yearCounts.values());
  const largestCohortCount = maxOf(cohortCounts.values());

  const largestDepartmentRatio = candidateCount ? largestDepartmentCount / candidateCount : 0;
  const largestYearRatio = candidateCount ? largestYearCount / candidateCount : 0;
  const largestCohortRatio = candidateCount ? largestCohortCount / candidateCount : 0;
  const emptySeatRatio = seatCount ? (seatCount - candidateCount) / seatCount : 0;

  const riskViolations: string[] = [];
  if (largestDepartmentRatio > limits.largestDepartmentRatio) {
    riskViolations.push(
      `largestDepartmentRatio=${largestDepartmentRatio.toFixed(2)} > limit ${limits.largestDepartmentRatio}`,
    );
  }
  if (yearCounts.size >= 2 && largestYearRatio > limits.largestYearRatio) {
    riskViolations.push(
      `largestYearRatio=${largestYearRatio.toFixed(2)} > limit ${limits.largestYearRatio}`,
    );
  }
  if (cohortCounts.size >= 2 && largestCohortRatio > limits.largestCohortRatio) {
    riskViolations.push(
      `largestCohortRatio=${largestCohortRatio.toFixed(2)} > limit ${limits.largestCohortRatio}`,
    );
  }
  if (emptySeatRatio > limits.maxEmptySeatRatio) {
    riskViolations.push(`emptySeatRatio=${emptySeatRatio.toFixed(2)} > limit ${limits.maxEmptySeatRatio}`);
  }

  const classification: GuardClassification =
    riskViolations.length === 0 ? "BALANCED" : "IMBALANCE_RISK";
  return { classification, riskViolations };
}

function maxOf(values: Iterable<number>): number {
  let max = 0;
  for (const v of values) max = Math.max(max, v);
  return max;
}

export function componentTopology(
  domain: DomainPlan,
  adjacency: AdjacencyMode = "eight",
  crossHallEdges: CrossHallEdgeInput[] = [],
): ComponentTopology {
  const graph = buildPhysicalGraph(domain.halls, adjacency, crossHallEdges);
  return {
    graphNodes: graph.nodes.length,
    graphEdges: graph.edges.length,
    crossHallEdgeCount: graph.crossHallEdges.length,
    anomalyEvidence: topologyAnomalyEvidence(
      graph,
      domain.seats.map((s) => graph.nodes.findIndex((n) => n.seatId === s.id)),
      domain.domainId,
      domain.candidateCount,
      domain.seatCount,
      MAX_DOMAIN_CANDIDATES,
      domain.hallIds,
    ),
  };
}