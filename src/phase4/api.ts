/**
 * Phase 4 — minimal HTTP API surface (§16).
 *
 * Three endpoints over node:http (no framework dependency):
 *   POST /exam-seating/generations          -> 202 { generationId, state, pollUrl }
 *   GET  /exam-seating/generations/:id      -> generation state + domain states
 *   GET  /exam-seating/generations/:id/seating -> published seating grouped by hall
 *
 * The in-memory registry is the generation state source of truth for the
 * polling surface; the authoritative record is the SolveJob + SeatingPlan row.
 */
import { createServer, type Server } from "node:http";
import type {
  GenerationResult,
  GenerateOptions,
} from "./types";
import { runSeatingGeneration } from "./integration";
import { getSeatingPlanForExam } from "./persist";

export interface Phase4ApiOptions extends GenerateOptions {
  registry: GenerationRegistry;
  requestedBy?: string;
}

export type GenerationRegistry = Map<string, GenerationResult>;

export function createPhase4Server(options: Phase4ApiOptions): Server {
  const server = createServer((req, res) => {
    void handleRequest(req, res, options);
  });
  return server;
}

async function handleRequest(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  options: Phase4ApiOptions,
) {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "POST" && path === "/exam-seating/generations") {
      await handleCreateGeneration(req, res, options);
      return;
    }

    const generationMatch = path.match(/^\/exam-seating\/generations\/([^/]+)$/);
    if (method === "GET" && generationMatch) {
      const generationId = generationMatch[1]!;
      const result = options.registry.get(generationId);
      if (!result) {
        json(res, 404, { error: "GENERATION_NOT_FOUND", message: `generation ${generationId} not found` });
        return;
      }
      json(res, 200, serializeGeneration(result));
      return;
    }

    const seatingMatch = path.match(/^\/exam-seating\/generations\/([^/]+)\/seating$/);
    if (method === "GET" && seatingMatch) {
      const generationId = seatingMatch[1]!;
      const result = options.registry.get(generationId);
      if (!result) {
        json(res, 404, { error: "GENERATION_NOT_FOUND", message: `generation ${generationId} not found` });
        return;
      }
      const plan = await getSeatingPlanForExam(result.examId);
      json(res, 200, serializeSeating(plan));
      return;
    }

    json(res, 404, { error: "NOT_FOUND", message: `no route for ${method} ${path}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 500, { error: "INTERNAL_ERROR", message });
  }
}

async function handleCreateGeneration(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  options: Phase4ApiOptions,
) {
  const body = await readBody(req);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    json(res, 400, { error: "INVALID_JSON", message: "request body must be JSON" });
    return;
  }

  const examId = parsed.examId;
  if (typeof examId !== "string" || examId.length === 0) {
    json(res, 400, { error: "MISSING_EXAM_ID", message: "examId is required" });
    return;
  }

  const run = await runSeatingGeneration({
    examId,
    requestedBy: options.requestedBy ?? "api",
    timeLimitSeconds:
      typeof parsed.timeLimitSeconds === "number" ? parsed.timeLimitSeconds : options.timeLimitSeconds,
    maxParallelDomains:
      typeof parsed.maxParallelDomains === "number"
        ? parsed.maxParallelDomains
        : options.maxParallelDomains,
    solverConfig: options.solverConfig,
    dispatch: options.dispatch,
  });

  options.registry.set(run.result.generationId, run.result);

  if (!run.jobCreated) {
    json(res, 409, {
      error: "ERR_JOB_ALREADY_ACTIVE",
      message: run.result.error?.message ?? "active generation already exists",
      generationId: run.result.generationId,
    });
    return;
  }

  const accepted = run.result.state === "COMPLETED" || run.result.state.startsWith("FAILED");
  json(res, accepted ? 200 : 202, {
    generationId: run.result.generationId,
    state: run.result.state,
    pollUrl: `/exam-seating/generations/${run.result.generationId}`,
    jobId: run.jobId,
  });
}

function serializeGeneration(result: GenerationResult) {
  return {
    generationId: result.generationId,
    state: result.state,
    sessionCandidateCount: result.sessionCandidateCount,
    domainCount: result.domainCount,
    completedDomainCount: result.completedDomainCount,
    failedDomainCount: result.failedDomainCount,
    failedDomainIds: result.failedDomainIds,
    blockedDomainIds: result.blockedDomainIds,
    error: result.error,
    timings: result.timings,
    domains: result.domains.map((d) => ({
      domainId: d.domainId,
      state: d.state,
      hallIds: d.plan?.hallIds,
      candidateCount: d.plan?.candidateCount,
      resultStatus: d.result?.status,
      solverDurationMs: d.result?.solverDurationMs,
      errorMessage: d.errorMessage,
    })),
    plan: result.plan
      ? {
          seatingPlanId: result.plan.seatingPlanId,
          version: result.plan.version,
          solverStatus: result.plan.solverStatus,
        }
      : null,
  };
}

function serializeSeating(plan: unknown) {
  return { plan };
}

function json(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}