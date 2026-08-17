/**
 * Phase 4 — minimal HTTP API surface (§16) with Phase 5 authentication.
 *
 * Endpoints over node:http (no framework dependency):
 *   POST /auth/login                                -> 200 { user } + session cookie
 *   POST /auth/logout                               -> 200 { ok } + expired cookie
 *   GET  /auth/me                                   -> 200 { user } (authenticated)
 *   POST /exam-seating/generations                  -> 202 { generationId, state, pollUrl } (ADMIN)
 *   GET  /exam-seating/generations/:id              -> generation state + domain states
 *   GET  /exam-seating/generations/:id/seating      -> published seating grouped by hall
 *   POST /exam-seating/documents?examId=            -> 200 IngestReport (ADMIN; application/pdf body)
 *   GET  /exam-seating/documents/:id                -> ingestion status (document record)
 *   GET  /exam-seating/documents/:id/candidates     -> validated candidate view (paginated)
 *
 * Authentication/session validation/role authorization run BEFORE routing, so
 * an unauthenticated request never reaches candidate processing, partitioning,
 * CP-SAT dispatch, or persistence.
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
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { getExam } from "../services/exam.service";
import { getDocument } from "../services/exam-document/document.service";
import { ingestExamDocument } from "../services/exam-document/ingest";
import {
  AuthError,
  requireAdmin,
  requireAuth,
} from "./auth/guards";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  expiredSessionCookieHeader,
  readSessionToken,
  resolveSession,
  sessionCookieHeader,
  destroySession,
  createSession,
} from "./auth/session";
import { publicUser, verifyCredentials } from "./auth/users";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const PDF_MAGIC = Buffer.from("%PDF-");
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

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

    // Public authentication endpoints.
    if (method === "POST" && path === "/auth/login") {
      await handleLogin(req, res);
      return;
    }
    if (method === "POST" && path === "/auth/logout") {
      await handleLogout(req, res);
      return;
    }

    // Everything below requires a valid session.
    const user = (await resolveSession(readSessionToken(req)))?.user ?? null;

    if (method === "GET" && path === "/auth/me") {
      json(res, 200, { user: publicUser(requireAuth(user)) });
      return;
    }

    if (method === "POST" && path === "/exam-seating/generations") {
      const actor = requireAdmin(user);
      await handleCreateGeneration(req, res, options, actor.id);
      return;
    }

    const generationMatch = path.match(/^\/exam-seating\/generations\/([^/]+)$/);
    if (method === "GET" && generationMatch) {
      requireAuth(user);
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
      requireAuth(user);
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

    const documentCandidatesMatch = path.match(/^\/exam-seating\/documents\/([^/]+)\/candidates$/);
    if (method === "GET" && documentCandidatesMatch) {
      requireAuth(user);
      await handleGetDocumentCandidates(req, res, documentCandidatesMatch[1]!);
      return;
    }

    const documentMatch = path.match(/^\/exam-seating\/documents\/([^/]+)$/);
    if (method === "GET" && documentMatch) {
      requireAuth(user);
      await handleGetDocument(res, documentMatch[1]!);
      return;
    }

    if (method === "POST" && path === "/exam-seating/documents") {
      const actor = requireAdmin(user);
      await handleUploadDocument(req, res, actor.id);
      return;
    }

    json(res, 404, { error: "NOT_FOUND", message: `no route for ${method} ${path}` });
  } catch (error) {
    if (error instanceof AuthError) {
      json(res, error.status, { error: error.code, message: error.message });
      return;
    }
    if (error instanceof HttpError) {
      json(res, error.status, { error: error.code, message: error.message });
      return;
    }
    if (error instanceof SeatingError && error.code === "PLAN_NOT_FOUND") {
      json(res, 404, { error: "PLAN_NOT_FOUND" });
      return;
    }
    if (error instanceof SeatingError && error.code === "EXAM_NOT_FOUND") {
      json(res, 404, { error: "EXAM_NOT_FOUND" });
      return;
    }
    if (error instanceof SeatingError && error.code === "DOCUMENT_NOT_FOUND") {
      json(res, 404, { error: "DOCUMENT_NOT_FOUND" });
      return;
    }
    console.error("[api] unexpected error", error);
    json(res, 500, { error: "INTERNAL_ERROR", message: "An unexpected error occurred" });
  }
}

async function handleLogin(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  const body = await readBody(req);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    json(res, 400, { error: "INVALID_JSON", message: "request body must be JSON" });
    return;
  }
  const username = parsed.username;
  const password = parsed.password;
  if (typeof username !== "string" || typeof password !== "string") {
    json(res, 400, { error: "MISSING_CREDENTIALS", message: "username and password are required" });
    return;
  }
  const user = await verifyCredentials(username, password);
  if (!user) {
    json(res, 401, { error: "INVALID_CREDENTIALS", message: "invalid username or password" });
    return;
  }
  const { token } = await createSession(user.id);
  json(
    res,
    200,
    { user: publicUser(user) },
    { "Set-Cookie": sessionCookieHeader(token, DEFAULT_SESSION_TTL_SECONDS) },
  );
}

async function handleLogout(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  await destroySession(readSessionToken(req));
  json(res, 200, { ok: true }, { "Set-Cookie": expiredSessionCookieHeader() });
}

async function handleCreateGeneration(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  options: Phase4ApiOptions,
  actorId: string,
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
    requestedBy: actorId,
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

async function handleUploadDocument(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  actorId: string,
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const examId = url.searchParams.get("examId") ?? "";
  if (!examId) {
    json(res, 400, { error: "MISSING_EXAM_ID", message: "examId query parameter is required" });
    return;
  }
  // Known application condition: unknown exam -> intentional 404.
  await getExam(examId);

  const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType !== "application/pdf") {
    json(res, 400, { error: "INVALID_FILE_TYPE", message: "only application/pdf uploads are accepted" });
    return;
  }

  const body = await readBinaryBody(req, MAX_UPLOAD_BYTES);
  if (body.length === 0) {
    json(res, 400, { error: "EMPTY_UPLOAD", message: "upload body must not be empty" });
    return;
  }
  if (!PDF_MAGIC.equals(body.subarray(0, PDF_MAGIC.length))) {
    json(res, 400, { error: "INVALID_FILE_TYPE", message: "file is not a valid PDF" });
    return;
  }

  const fileName = req.headers["x-file-name"] ?? "document.pdf";
  const report = await ingestExamDocument(
    examId,
    String(fileName),
    "application/pdf",
    new Uint8Array(body),
    { actorId },
  );
  const document = await getDocument(report.documentId);
  json(res, 200, { ...report, fileName: document.fileName });
}

async function handleGetDocument(
  res: import("node:http").ServerResponse,
  id: string,
) {
  const document = await getDocument(id);
  json(res, 200, { document: serializeDocument(document) });
}

async function handleGetDocumentCandidates(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  id: string,
) {
  const document = await getDocument(id);
  const url = new URL(req.url ?? "/", "http://localhost");
  const parsedLimit = Number(url.searchParams.get("limit") ?? DEFAULT_PAGE_SIZE);
  const parsedOffset = Number(url.searchParams.get("offset") ?? 0);
  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAX_PAGE_SIZE ||
    !Number.isInteger(parsedOffset) ||
    parsedOffset < 0
  ) {
    json(res, 400, { error: "INVALID_PAGINATION", message: "limit must be 1..200 and offset must be >= 0" });
    return;
  }
  const where = { examId: document.examId, sourceDocumentId: document.id };
  const [total, candidates] = await Promise.all([
    prisma.examCandidate.count({ where }),
    prisma.examCandidate.findMany({
      where,
      orderBy: { registerNumberSnapshot: "asc" },
      skip: parsedOffset,
      take: parsedLimit,
      select: {
        id: true,
        registerNumberSnapshot: true,
        studentNameSnapshot: true,
        departmentSnapshot: true,
        genderSnapshot: true,
        classSnapshot: true,
        subjectCode: true,
        subjectName: true,
        validationStatus: true,
      },
    }),
  ]);
  json(res, 200, {
    documentId: document.id,
    total,
    offset: parsedOffset,
    limit: parsedLimit,
    candidates,
  });
}

function serializeDocument(document: {
  id: string;
  examId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  parseStatus: string;
  parseMetadata: unknown;
  uploadedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: document.id,
    examId: document.examId,
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    fileHash: document.fileHash,
    parseStatus: document.parseStatus,
    parseMetadata: document.parseMetadata,
    uploadedBy: document.uploadedBy,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function readBinaryBody(
  req: import("node:http").IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    req.on("data", (chunk) => {
      if (over) return;
      const buf = Buffer.from(chunk as Buffer);
      total += buf.length;
      if (total > maxBytes) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (over) {
        reject(new HttpError(413, "PAYLOAD_TOO_LARGE", `upload exceeds ${maxBytes} byte limit`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

function json(
  res: import("node:http").ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
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