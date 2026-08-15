/**
 * Phase 4 — failure tests (spec §23).
 *
 * A  — topology oversized component
 * B  — insufficient aggregate seat capacity
 * C  — composition guard reject (ERR_DOMAIN_COMPOSITION_IMBALANCE)
 * D  — per-domain capacity guard classification
 * E  — worker transport failure (thrown by dispatch)
 * F  — duplicate candidate assignment (validator rejects)
 * G  — duplicate seat assignment (validator rejects)
 * H  — cross-domain adjacency leak (partition invariant verifier rejects)
 *
 * Everything here must STOP the generation and publish nothing.
 */
import { describe, it, expect } from "vitest";
import { partitionCandidates, computeCompositionGuard } from "../src/phase4/partition";
import { verifyPartitionInvariants, buildPhysicalGraph } from "../src/phase4/topology";
import { runGeneration } from "../src/phase4/generation.service";
import type {
  DomainCandidate,
  DomainHall,
  DomainSolveResult,
  SolverDispatch,
} from "../src/phase4/types";
import { GUARD_ERR_CODES } from "../src/phase4/types";

function makeCandidate(n: number, department = "CSE"): DomainCandidate {
  return {
    id: `cand-${n}`,
    registerNumber: `REG${String(n).padStart(4, "0")}`,
    studentName: `Student ${n}`,
    department,
    class: "CSE-A",
    gender: "MALE",
    subjectCode: "CS8501",
    subjectName: "Theory of Computation",
  };
}

function makeHall(n: number, rows = 5, columns = 5): DomainHall {
  const hallNumber = `LH0${n}`;
  const seats = Array.from({ length: rows * columns }, (_, i) => ({
    id: `${hallNumber}-seat-${i + 1}`,
    seatPosition: `${String.fromCharCode(65 + Math.floor(i / columns))}${(i % columns) + 1}`,
    row: String.fromCharCode(65 + Math.floor(i / columns)),
    column: (i % columns) + 1,
  }));
  return {
    id: `hall-${n}`,
    hallNumber,
    name: hallNumber,
    building: null,
    rows,
    columns,
    capacity: seats.length,
    seats,
  };
}

function optimalDispatch(): SolverDispatch {
  return {
    async solveDomain(payload): Promise<DomainSolveResult> {
      const hall = payload.halls[0]!;
      return {
        requestId: payload.requestId,
        domainId: payload.requestId.split(":")[1]!,
        status: "OPTIMAL",
        assignments: payload.candidates.map((c, i) => ({
          candidateId: c.id,
          hallId: hall.id,
          hallSeatId: hall.seats[i]!.id,
        })),
        solverDurationMs: 5,
        candidateCount: payload.candidateCount,
        assignedCount: payload.candidateCount,
        unassignedCount: 0,
        reportedObjective: 0,
        rawSolverObjective: 0,
        validatorObjective: 0,
        infeasibilityReason: null,
        errorCode: null,
        errorMessage: null,
      };
    },
  };
}

function baseOptions(
  candidates: DomainCandidate[],
  halls: DomainHall[],
  dispatch: SolverDispatch,
): Parameters<typeof runGeneration>[0] {
  return {
    generationId: "gen:fail",
    examId: "exam-fail",
    candidates,
    halls,
    timeLimitSeconds: 10,
    maxParallelDomains: 2,
    solverConfig: { policyMode: "DEPARTMENT_ONLY" },
    dispatch,
  };
}

describe("phase4 failure A — oversized component", () => {
  it("stops the generation when a component exceeds the candidate ceiling", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1, 3, 3)];
    const result = await runGeneration({
      ...baseOptions(candidates, halls, optimalDispatch()),
      limits: { maxDomainCandidates: 4 },
    });
    expect(result.state).toBe("FAILED_PARTITION");
    expect(result.error?.code).toBe("ERR_PARTITION_BLOCKED");
    expect(result.error?.message).toContain(GUARD_ERR_CODES.TOPOLOGY_OVERSIZED);
    expect(result.plan).toBeNull();
  });
});

describe("phase4 failure B — insufficient aggregate capacity", () => {
  it("stops when the session has more candidates than active seats", async () => {
    const candidates = Array.from({ length: 6 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1, 2, 2)];
    const result = await runGeneration(baseOptions(candidates, halls, optimalDispatch()));
    expect(result.state).toBe("FAILED_PARTITION");
    expect(result.error?.message).toContain("insufficient aggregate seat capacity");
    expect(result.plan).toBeNull();
  });
});

describe("phase4 failure C — composition guard reject", () => {
  it("stops with ERR_DOMAIN_COMPOSITION_IMBALANCE when compositionAction=reject", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(i, "CSE"));
    const halls = [makeHall(1)]; // 25 seats, all one department -> imbalance risk
    const result = await runGeneration({
      ...baseOptions(candidates, halls, optimalDispatch()),
      solverConfig: { policyMode: "DEPARTMENT_ONLY", compositionAction: "reject" },
    });
    expect(result.state).toBe("FAILED_GUARD");
    expect(result.error?.code).toBe(GUARD_ERR_CODES.COMPOSITION_IMBALANCE);
    expect(result.plan).toBeNull();
  });
});

describe("phase4 failure D — per-domain capacity guard", () => {
  it("classifies a domain as INSUFFICIENT_CAPACITY before dispatch", () => {
    const guard = computeCompositionGuard(
      Array.from({ length: 6 }, (_, i) => makeCandidate(i)),
      5,
    );
    expect(guard.classification).toBe("INSUFFICIENT_CAPACITY");
    expect(guard.riskViolations[0]).toContain(GUARD_ERR_CODES.INSUFFICIENT_CAPACITY);

    const blocked = partitionCandidates(
      { candidates: Array.from({ length: 6 }, (_, i) => makeCandidate(i)), halls: [makeHall(1, 2, 2)] },
    );
    expect(blocked.blocked).toBe(true);
  });
});

describe("phase4 failure E — worker transport failure", () => {
  it("stops as FAILED_DOMAIN when a domain worker throws", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2)];
    const throwingDispatch: SolverDispatch = {
      async solveDomain() {
        throw new Error("worker crashed");
      },
    };
    const result = await runGeneration(baseOptions(candidates, halls, throwingDispatch));
    expect(result.state).toBe("FAILED_DOMAIN");
    expect(result.error?.code).toBe("ERR_DOMAIN_FAILED");
    expect(result.error?.message).toContain("worker crashed");
    expect(result.merge).toBeNull();
    expect(result.plan).toBeNull();
  });
});

describe("phase4 failure F — duplicate candidate", () => {
  it("rejects a domain result that assigns a candidate twice", async () => {
    const candidates = Array.from({ length: 2 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1, 2, 2)];
    const duplicateDispatch: SolverDispatch = {
      async solveDomain(payload): Promise<DomainSolveResult> {
        const hall = payload.halls[0]!;
        return {
          requestId: payload.requestId,
          domainId: payload.requestId.split(":")[1]!,
          status: "OPTIMAL",
          assignments: [
            { candidateId: payload.candidates[0]!.id, hallId: hall.id, hallSeatId: hall.seats[0]!.id },
            { candidateId: payload.candidates[0]!.id, hallId: hall.id, hallSeatId: hall.seats[1]!.id },
          ],
          solverDurationMs: 5,
          candidateCount: 2,
          assignedCount: 2,
          unassignedCount: 0,
          reportedObjective: 0,
          rawSolverObjective: 0,
          validatorObjective: 0,
          infeasibilityReason: null,
          errorCode: null,
          errorMessage: null,
        };
      },
    };
    const result = await runGeneration(baseOptions(candidates, halls, duplicateDispatch));
    expect(result.state).toBe("FAILED_DOMAIN");
    expect(result.error?.code).toBe("ERR_DOMAIN_VALIDATION");
    expect(result.error?.message).toContain("duplicate candidate ids");
    expect(result.plan).toBeNull();
  });
});

describe("phase4 failure G — duplicate seat", () => {
  it("rejects a domain result that assigns two candidates to one seat", async () => {
    const candidates = Array.from({ length: 2 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1, 2, 2)];
    const duplicateSeatDispatch: SolverDispatch = {
      async solveDomain(payload): Promise<DomainSolveResult> {
        const hall = payload.halls[0]!;
        return {
          requestId: payload.requestId,
          domainId: payload.requestId.split(":")[1]!,
          status: "OPTIMAL",
          assignments: [
            { candidateId: payload.candidates[0]!.id, hallId: hall.id, hallSeatId: hall.seats[0]!.id },
            { candidateId: payload.candidates[1]!.id, hallId: hall.id, hallSeatId: hall.seats[0]!.id },
          ],
          solverDurationMs: 5,
          candidateCount: 2,
          assignedCount: 2,
          unassignedCount: 0,
          reportedObjective: 0,
          rawSolverObjective: 0,
          validatorObjective: 0,
          infeasibilityReason: null,
          errorCode: null,
          errorMessage: null,
        };
      },
    };
    const result = await runGeneration(baseOptions(candidates, halls, duplicateSeatDispatch));
    expect(result.state).toBe("FAILED_DOMAIN");
    expect(result.error?.code).toBe("ERR_DOMAIN_VALIDATION");
    expect(result.error?.message).toContain("duplicate seat ids");
    expect(result.plan).toBeNull();
  });
});

describe("phase4 failure H — cross-domain adjacency leak", () => {
  it("flags any partition that leaves an adjacency edge spanning two domains", () => {
    const halls = [makeHall(1), makeHall(2)];
    const graph = buildPhysicalGraph(halls);
    const allIndices = graph.nodes.map((_, i) => i);
    const split = 12; // cuts through hall 1, so adjacency edges span D-a / D-b
    const errors = verifyPartitionInvariants(graph, [
      { domainId: "D-a", seatIndices: allIndices.slice(0, split) },
      { domainId: "D-b", seatIndices: allIndices.slice(split) },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("cross-domain adjacency edge"))).toBe(true);
  });

  it("never produces a cross-domain adjacency edge from a valid partition", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2)];
    const partition = partitionCandidates({ candidates, halls });
    expect(partition.invariantErrors).toEqual([]);
    const graph = buildPhysicalGraph(halls);
    const edges = graph.edges;
    const seatOfDomain = new Map<number, string>();
    for (const domain of partition.domains) {
      for (const seat of domain.seats) {
        seatOfDomain.set(graph.nodes.findIndex((n) => n.seatId === seat.id), domain.domainId);
      }
    }
    const spanning = edges.filter((e) => seatOfDomain.get(e.from) !== seatOfDomain.get(e.to));
    expect(spanning).toEqual([]);
  });
});
