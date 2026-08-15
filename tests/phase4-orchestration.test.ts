import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { partitionCandidates, computeCompositionGuard } from "../src/phase4/partition";
import {
  buildPhysicalGraph,
  verifyPartitionInvariants,
} from "../src/phase4/topology";
import type { DomainCandidate, DomainHall } from "../src/phase4/types";
import {
  validateDomainResult,
  validateMerge,
} from "../src/phase4/validateMerge";
import { mapWithConcurrency } from "../src/phase4/workerPool";
import { solveDomain, resolveSolverToken } from "../src/phase4/solverClient";
import { runGeneration } from "../src/phase4/generation.service";
import type { DomainSolveResult, SolverDispatch } from "../src/phase4/types";
import { generateProforma1, buildProformaInput } from "../src/phase4/proforma";
import { extractPdfText } from "../src/services/exam-document/pdf";
import {
  segmentDocumentIntoGroups,
  summarizeGroups,
} from "../src/services/exam-document/groups";
import { DEFAULT_EXTRACTOR_CONFIG } from "../src/services/exam-document/extractorConfig";

function makeCandidate(n: number, department = "CSE"): DomainCandidate {
  const id = `cand-${n}`;
  return {
    id,
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

describe("phase4 partition", () => {
  it("allocates every candidate to a domain with sufficient capacity", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2)];
    const result = partitionCandidates({ candidates, halls });
    expect(result.blocked).toBe(false);
    const total = result.domains.reduce((sum, d) => sum + d.candidateCount, 0);
    expect(total).toBe(30);
    expect(result.unallocatedCount).toBe(0);
  });

  it("blocks when aggregate capacity is insufficient", () => {
    const candidates = Array.from({ length: 40 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1)]; // 25 seats
    const result = partitionCandidates({ candidates, halls });
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toBe("insufficient aggregate seat capacity");
  });

  it("marks a domain INSUFFICIENT_CAPACITY when candidates exceed seats", () => {
    const guard = computeCompositionGuard(Array.from({ length: 26 }, (_, i) => makeCandidate(i)), 25);
    expect(guard.classification).toBe("INSUFFICIENT_CAPACITY");
  });

  it("flags composition imbalance risk without blocking", () => {
    const single = Array.from({ length: 10 }, (_, i) => makeCandidate(i, "CSE"));
    const guard = computeCompositionGuard(single, 25);
    expect(guard.classification).toBe("IMBALANCE_RISK");
    expect(guard.riskViolations.length).toBeGreaterThan(0);
  });
});

describe("phase4 topology partitioning", () => {
  const hallSeatId = (hall: DomainHall, row: string, column: number) =>
    hall.seats.find((s) => s.row === row && s.column === column)!.id;

  it("separates independent halls into distinct domains (no cross-hall edges)", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2)];
    const result = partitionCandidates({ candidates, halls });
    expect(result.blocked).toBe(false);
    expect(result.domains).toHaveLength(2);
    expect(result.domains[0]!.hallIds).toHaveLength(1);
    expect(result.domains[1]!.hallIds).toHaveLength(1);
    expect(result.invariantErrors).toEqual([]);
  });

  it("merges halls into one domain when a cross-hall adjacency edge is configured", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2)];
    const result = partitionCandidates({
      candidates,
      halls,
      crossHallEdges: [{ fromSeatId: hallSeatId(halls[0]!, "A", 1), toSeatId: hallSeatId(halls[1]!, "A", 1) }],
    });
    expect(result.blocked).toBe(false);
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0]!.hallIds).toHaveLength(2);
    expect(result.domains[0]!.seatCount).toBe(50);
    expect(result.invariantErrors).toEqual([]);
  });

  it("merges transitively connected halls A-B-C into a single domain", () => {
    const candidates = Array.from({ length: 40 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2), makeHall(3)];
    const result = partitionCandidates({
      candidates,
      halls,
      crossHallEdges: [
        { fromSeatId: hallSeatId(halls[0]!, "A", 1), toSeatId: hallSeatId(halls[1]!, "A", 1) },
        { fromSeatId: hallSeatId(halls[1]!, "A", 1), toSeatId: hallSeatId(halls[2]!, "A", 1) },
      ],
    });
    expect(result.blocked).toBe(false);
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0]!.hallNumbers).toEqual(["LH01", "LH02", "LH03"]);
    expect(result.invariantErrors).toEqual([]);
  });

  it("produces two components for two independent cross-hall pairs", () => {
    const candidates = Array.from({ length: 50 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2), makeHall(3), makeHall(4)];
    const result = partitionCandidates({
      candidates,
      halls,
      crossHallEdges: [
        { fromSeatId: hallSeatId(halls[0]!, "A", 1), toSeatId: hallSeatId(halls[1]!, "A", 1) },
        { fromSeatId: hallSeatId(halls[2]!, "A", 1), toSeatId: hallSeatId(halls[3]!, "A", 1) },
      ],
    });
    expect(result.blocked).toBe(false);
    expect(result.domains).toHaveLength(2);
    for (const domain of result.domains) {
      expect(domain.hallIds).toHaveLength(2);
    }
    expect(result.invariantErrors).toEqual([]);
    const total = result.domains.reduce((sum, d) => sum + d.candidateCount, 0);
    expect(total).toBe(50);
  });

  it("blocks an oversized component beyond the candidate ceiling", () => {
    const candidates = Array.from({ length: 1001 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1, 34, 30)]; // 1020 seats >= 1001
    const result = partitionCandidates({ candidates, halls });
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toBe("ERR_GRAPH_TOPOLOGY_OVERSIZED_COMPONENT");
    expect(result.domains[0]!.blocked).toBe(true);
  });

  it("keeps every seat in exactly one domain (seat completeness invariant)", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2)];
    const result = partitionCandidates({ candidates, halls });
    const seen = new Set<string>();
    for (const domain of result.domains) {
      for (const seat of domain.seats) {
        expect(seen.has(seat.id)).toBe(false);
        seen.add(seat.id);
      }
    }
    expect(seen.size).toBe(halls[0]!.seats.length + halls[1]!.seats.length);
  });

  it("flags cross-domain adjacency edges in the invariant verifier", () => {
    const halls = [makeHall(1), makeHall(2)];
    const graph = buildPhysicalGraph(halls);
    const allIndices = graph.nodes.map((_, i) => i);
    const split = 12; // cuts through hall 1 so adjacency edges span D-a / D-b
    const errors = verifyPartitionInvariants(graph, [
      { domainId: "D-a", seatIndices: allIndices.slice(0, split) },
      { domainId: "D-b", seatIndices: allIndices.slice(split) },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("cross-domain adjacency edge"))).toBe(true);
  });
});

describe("phase4 validation & merge", () => {
  function completedResult(candidates: DomainCandidate[], hall: DomainHall): DomainSolveResult {
    return {
      requestId: "gen:1:D-1",
      domainId: "D-1",
      status: "OPTIMAL",
      assignments: candidates.map((c, i) => ({
        candidateId: c.id,
        hallId: hall.id,
        hallSeatId: hall.seats[i]!.id,
      })),
      solverDurationMs: 10,
      candidateCount: candidates.length,
      assignedCount: candidates.length,
      unassignedCount: 0,
      reportedObjective: 0,
      rawSolverObjective: 0,
      validatorObjective: 0,
      infeasibilityReason: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  it("accepts a valid OPTIMAL domain result", () => {
    const hall = makeHall(1);
    const candidates = [makeCandidate(0), makeCandidate(1)];
    const plan = {
      domainId: "D-1",
      hallIds: [hall.id],
      hallNumbers: [hall.hallNumber],
      halls: [hall],
      seats: hall.seats,
      candidates,
      seatCount: hall.capacity,
      candidateCount: 2,
      guard: { classification: "BALANCED" as const, riskViolations: [] },
      blocked: false,
      blockedReason: null,
    };
    const validation = validateDomainResult(plan, completedResult(candidates, hall));
    expect(validation.valid).toBe(true);
    expect(validation.structuralErrors).toEqual([]);
  });

  it("rejects a result with duplicate seats", () => {
    const hall = makeHall(1);
    const candidates = [makeCandidate(0), makeCandidate(1)];
    const plan = {
      domainId: "D-1",
      hallIds: [hall.id],
      hallNumbers: [hall.hallNumber],
      halls: [hall],
      seats: hall.seats,
      candidates,
      seatCount: hall.capacity,
      candidateCount: 2,
      guard: { classification: "BALANCED" as const, riskViolations: [] },
      blocked: false,
      blockedReason: null,
    };
    const result = completedResult(candidates, hall);
    result.assignments[1]!.hallSeatId = result.assignments[0]!.hallSeatId;
    const validation = validateDomainResult(plan, result);
    expect(validation.valid).toBe(false);
    expect(validation.duplicateSeatIds).toHaveLength(1);
  });

  it("validates a clean merge and detects duplicates", () => {
    const hall = makeHall(1);
    const candidates = [makeCandidate(0), makeCandidate(1)];
    const records = [
      {
        domainId: "D-1",
        state: "COMPLETED" as const,
        plan: {
          domainId: "D-1",
          hallIds: [hall.id],
          hallNumbers: [hall.hallNumber],
          halls: [hall],
          seats: hall.seats,
          candidates,
          seatCount: hall.capacity,
          candidateCount: 2,
          guard: { classification: "BALANCED" as const, riskViolations: [] },
          blocked: false,
          blockedReason: null,
        },
        result: completedResult(candidates, hall),
        startedAt: 0,
        finishedAt: 1,
        errorMessage: null,
      },
    ];
    const merge = validateMerge(records, candidates, [hall]);
    expect(merge.valid).toBe(true);
    expect(merge.assignedCandidateCount).toBe(2);
    expect(merge.duplicateCandidateIds).toEqual([]);
  });

  it("detects a missing candidate in the merge", () => {
    const hall = makeHall(1);
    const candidates = [makeCandidate(0), makeCandidate(1)];
    const result = completedResult([candidates[0]!], hall);
    const records = [
      {
        domainId: "D-1",
        state: "COMPLETED" as const,
        plan: {
          domainId: "D-1",
          hallIds: [hall.id],
          hallNumbers: [hall.hallNumber],
          halls: [hall],
          seats: hall.seats,
          candidates,
          seatCount: hall.capacity,
          candidateCount: 2,
          guard: { classification: "BALANCED" as const, riskViolations: [] },
          blocked: false,
          blockedReason: null,
        },
        result,
        startedAt: 0,
        finishedAt: 1,
        errorMessage: null,
      },
    ];
    const merge = validateMerge(records, candidates, [hall]);
    expect(merge.valid).toBe(false);
    expect(merge.missingCandidateCount).toBe(1);
  });
});

describe("phase4 worker pool", () => {
  it("runs tasks with bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    const outcome = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7, 8],
      async (item) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return item * 2;
      },
      { limit: 2 },
    );
    expect(peak).toBe(2);
    expect(outcome.results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(outcome.failures).toEqual([]);
  });

  it("collects failures without aborting other tasks", async () => {
    const outcome = await mapWithConcurrency(
      [1, 2, 3],
      async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      },
      { limit: 1 },
    );
    expect(outcome.results).toEqual([1, 3]);
    expect(outcome.failures).toHaveLength(1);
  });
});

describe("phase4 solver client", () => {
  function stubSolverServer(handler: (req: unknown) => unknown): Server {
    return createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const payload = JSON.parse(body) as { requestId: string };
        const reply = handler(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(reply));
      });
    });
  }

  it("derives the objective triple from an OPTIMAL response", async () => {
    const server = stubSolverServer((req) => ({
      requestId: (req as { requestId: string }).requestId,
      status: "OPTIMAL",
      assignments: [],
      solverDurationMs: 5,
      candidateCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      objectiveValue: 0,
    }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const result = await solveDomain(
        {
          requestId: "gen:1:D-1",
          examId: "exam-1",
          candidates: [],
          halls: [makeHall(1)],
          timeLimitSeconds: 5,
          solverConfig: {
            policyMode: "DEPARTMENT_ONLY",
            adjacency: "eight",
            compositionAction: "warn",
            randomSeed: 0,
            numSearchWorkers: null,
          },
          candidateCount: 0,
          availableSeatCount: 25,
        },
        { baseUrl: `http://127.0.0.1:${port}` },
      );
      expect(result.status).toBe("OPTIMAL");
      expect(result.reportedObjective).toBe(0);
      expect(result.rawSolverObjective).toBe(0);
      expect(result.validatorObjective).toBe(0);
    } finally {
      server.close();
    }
  });

  it("sends the configured X-Internal-Token header on every request", async () => {
    const previous = process.env.SOLVER_INTERNAL_TOKEN;
    process.env.SOLVER_INTERNAL_TOKEN = "test-internal-token";
    let seenHeader: string | undefined;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seenHeader = req.headers["x-internal-token"] as string | undefined;
        const payload = JSON.parse(body) as { requestId: string };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            requestId: payload.requestId,
            status: "OPTIMAL",
            assignments: [],
            solverDurationMs: 1,
            candidateCount: 0,
            assignedCount: 0,
            unassignedCount: 0,
            objectiveValue: 0,
          }),
        );
      });
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const result = await solveDomain(
        {
          requestId: "gen:1:D-1",
          examId: "exam-1",
          candidates: [],
          halls: [makeHall(1)],
          timeLimitSeconds: 5,
          solverConfig: {
            policyMode: "DEPARTMENT_ONLY",
            adjacency: "eight",
            compositionAction: "warn",
            randomSeed: 0,
            numSearchWorkers: null,
          },
          candidateCount: 0,
          availableSeatCount: 25,
        },
        { baseUrl: `http://127.0.0.1:${port}` },
      );
      expect(result.status).toBe("OPTIMAL");
      expect(seenHeader).toBe("test-internal-token");
    } finally {
      server.close();
      if (previous === undefined) delete process.env.SOLVER_INTERNAL_TOKEN;
      else process.env.SOLVER_INTERNAL_TOKEN = previous;
    }
  });

  it("refuses to call the solver when SOLVER_INTERNAL_TOKEN is unset", () => {
    const previous = process.env.SOLVER_INTERNAL_TOKEN;
    delete process.env.SOLVER_INTERNAL_TOKEN;
    try {
      expect(() => resolveSolverToken()).toThrow(/SOLVER_INTERNAL_TOKEN is not set/);
    } finally {
      if (previous === undefined) delete process.env.SOLVER_INTERNAL_TOKEN;
      else process.env.SOLVER_INTERNAL_TOKEN = previous;
    }
  });

  it("refuses to call the solver with the known dev-default token", () => {
    const previous = process.env.SOLVER_INTERNAL_TOKEN;
    process.env.SOLVER_INTERNAL_TOKEN = "dev-internal-token";
    try {
      expect(() => resolveSolverToken()).toThrow(/must not be the known default/);
    } finally {
      if (previous === undefined) delete process.env.SOLVER_INTERNAL_TOKEN;
      else process.env.SOLVER_INTERNAL_TOKEN = previous;
    }
  });

  it("classifies a refused connection as RESOURCE_FAILURE", async () => {
    await expect(
      solveDomain(
        {
          requestId: "gen:1:D-1",
          examId: "exam-1",
          candidates: [],
          halls: [makeHall(1)],
          timeLimitSeconds: 1,
          solverConfig: {
            policyMode: "DEPARTMENT_ONLY",
            adjacency: "eight",
            compositionAction: "warn",
            randomSeed: 0,
            numSearchWorkers: null,
          },
          candidateCount: 0,
          availableSeatCount: 25,
        },
        { baseUrl: "http://127.0.0.1:1", timeoutBufferSeconds: 2 },
      ),
    ).rejects.toMatchObject({ kind: "RESOURCE_FAILURE" });
  });
});

describe("phase4 generation pipeline", () => {
  function stubDispatch(): SolverDispatch {
    return {
      async solveDomain(payload) {
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

  it("completes a multi-domain generation and validates the merge", async () => {
    const candidates = Array.from({ length: 40 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2)];
    const result = await runGeneration({
      generationId: "gen:test",
      examId: "exam-test",
      candidates,
      halls,
      timeLimitSeconds: 10,
      maxParallelDomains: 2,
      solverConfig: { policyMode: "DEPARTMENT_ONLY" },
      dispatch: stubDispatch(),
    });
    expect(result.state).toBe("COMPLETED");
    expect(result.domainCount).toBe(2);
    expect(result.completedDomainCount).toBe(2);
    expect(result.merge?.valid).toBe(true);
    expect(result.merge?.assignedCandidateCount).toBe(40);
  });

  it("fails the generation when a domain is infeasible", async () => {
    const candidates = Array.from({ length: 40 }, (_, i) => makeCandidate(i));
    const halls = [makeHall(1), makeHall(2)];
    const dispatch: SolverDispatch = {
      async solveDomain(payload) {
        return {
          requestId: payload.requestId,
          domainId: payload.requestId.split(":")[1]!,
          status: "INFEASIBLE",
          assignments: [],
          solverDurationMs: 5,
          candidateCount: payload.candidateCount,
          assignedCount: 0,
          unassignedCount: payload.candidateCount,
          reportedObjective: null,
          rawSolverObjective: null,
          validatorObjective: null,
          infeasibilityReason: "no feasible arrangement",
          errorCode: null,
          errorMessage: null,
        };
      },
    };
    const result = await runGeneration({
      generationId: "gen:test",
      examId: "exam-test",
      candidates,
      halls,
      timeLimitSeconds: 10,
      maxParallelDomains: 2,
      solverConfig: { policyMode: "DEPARTMENT_ONLY" },
      dispatch,
    });
    expect(result.state).toBe("FAILED_DOMAIN");
    expect(result.error?.code).toBe("ERR_DOMAIN_INFEASIBLE");
  });
});

describe("phase4 proforma", () => {
  it("renders and round-trips through pdfjs", async () => {
    const input = buildProformaInput(
      { institutionName: "Anna University", title: "University Examinations", date: "01.12.2025", session: "AN" },
      [{ hallNumber: "LH09", rows: 5, columns: 5 }],
      [
        { registerNumber: "REG0001", department: "CSE", seatRow: 1, seatColumn: 1, hallNumber: "LH09" },
        { registerNumber: "REG0002", department: "ECE", seatRow: 1, seatColumn: 2, hallNumber: "LH09" },
      ],
    );
    const output = await generateProforma1(input);
    expect(output.pageCount).toBe(2);
    expect(output.summaryPageIndex).toBe(1);

    const pages = await extractPdfText(output.pdf);
    const allText = pages.map((p) => p.text).join("\n");
    expect(allText).toContain("PROFORMA - 1");
    expect(allText).toContain("LH09");
    expect(allText).toContain("REG0001");
    expect(allText).toContain("GRAND TOTAL");
    expect(allText).toContain("2");
  });
});

describe("phase4 document groups", () => {
  it("segments a multi-subject PDF into distinct exam groups", () => {
    const config = DEFAULT_EXTRACTOR_CONFIG;
    const pages = [
      {
        pageNumber: 1,
        text: [
          "Anna University",
          "Regulation 2021",
          "CS8501 Theory of Computation  01.12.2025  FN",
          "S.No Reg No Name",
          "1 953022104001 Alice",
          "2 953022104002 Bob",
          "EC3451 Digital Signal Processing  01.12.2025  AN",
          "1 953022104011 Carol",
          "2 953022104012 Dave",
        ].join("\n"),
      },
    ];
    const result = segmentDocumentIntoGroups(pages, config);
    expect(result.ambiguous).toBe(false);
    const summary = summarizeGroups(result);
    expect(summary.groupCount).toBe(2);
    expect(summary.groups[0]!.subjectCode).toBe("CS8501");
    expect(summary.groups[0]!.session).toBe("FN");
    expect(summary.groups[0]!.rowCount).toBe(2);
    expect(summary.groups[1]!.subjectCode).toBe("EC3451");
    expect(summary.groups[1]!.session).toBe("AN");
    expect(summary.groups[1]!.rowCount).toBe(2);
  });
});