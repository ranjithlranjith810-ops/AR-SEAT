/**
 * Phase 4 — minimal HTTP API surface (§16) with Phase 5 authentication.
 *
 * Endpoints over node:http (no framework dependency):
 *   POST /auth/login                                -> 200 { user } + session cookie
 *   POST /auth/logout                               -> 200 { ok } + expired cookie
 *   GET  /auth/me                                   -> 200 { user } (authenticated)
 *   POST /exam-seating/generations                  -> 202 { generationId, state, pollUrl } (ADMIN)
 *   GET  /exam-seating/exams                        -> 200 { exams } (ADMIN)
 *   GET  /exam-seating/audit-logs                    -> 200 { items, total, limit, offset } (ADMIN)
 *   GET  /exam-seating/generations/:id              -> generation state + domain states
 *   GET  /exam-seating/generations/:id/seating      -> published seating grouped by hall
 *   GET  /exam-seating/plans/:seatingPlanId         -> seating plan by id (any status)
 *   POST /exam-seating/plans/:seatingPlanId/approve -> 200 plan (ADMIN; DRAFT -> APPROVED)
 *   POST /exam-seating/plans/:seatingPlanId/publish -> 200 plan (ADMIN; APPROVED -> PUBLISHED)
 *   POST /exam-seating/documents?examId=            -> 200 IngestReport (ADMIN; application/pdf body)
 *   GET  /exam-seating/documents/:id                -> ingestion status (document record)
 *   GET  /exam-seating/documents/:id/candidates     -> validated candidate view (paginated)
 *   GET  /exam-seating/exams/:id/conflicts          -> 200 conflict report (ADMIN)
 *   GET  /exam-seating/exams/:id/candidates         -> 200 exam-wide candidate roster (ADMIN)
 *   POST /exam-seating/exams/:id/candidates         -> 200 candidate added from master (ADMIN)
 *   POST /exam-seating/exams/:id/candidates/:cid/exclude   -> 200 candidate excluded (ADMIN)
 *   POST /exam-seating/exams/:id/candidates/:cid/reinstate -> 200 candidate reinstated (ADMIN)
 *   POST /exam-seating/exams/:id/cancel             -> 200 exam cancelled (ADMIN)
 *
 * Authentication/session validation/role authorization run BEFORE routing, so
 * an unauthenticated request never reaches candidate processing, partitioning,
 * CP-SAT dispatch, or persistence.
 *
 * The in-memory registry is the generation state source of truth for the
 * polling surface; the authoritative record is the SolveJob + SeatingPlan row.
 */
import { createServer, type Server } from "node:http";
import { AuditAction, Prisma } from "@prisma/client";
import type {
  GenerationResult,
  GenerateOptions,
} from "./types";
import { runSeatingGeneration } from "./integration";
import { getSeatingPlanById, getSeatingPlanForExam } from "./persist";
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "../services/audit.service";
import { getExam, listExams, cancelExam } from "../services/exam.service";
import { approvePlan, publishPlan } from "../services/seatingPlan.service";
import { getDocument } from "../services/exam-document/document.service";
import { ingestExamDocument } from "../services/exam-document/ingest";
import { checkExamConflicts } from "../services/conflict.service";
import {
  addCandidateFromMaster,
  excludeCandidate,
  getCandidate,
  reinstateCandidate,
  transitionValidationStatus,
} from "../services/candidate.service";
import {
  createDepartment,
  listDepartments,
  updateDepartment,
} from "../services/department.service";
import {
  createClass,
  listClasses,
  updateClass,
} from "../services/class.service";
import {
  changeStudentStatus,
  createStudent,
  getStudent,
  listStudents,
  updateStudent,
} from "../services/student.service";
import {
  createHall,
  getHall,
  listHalls,
  updateHall,
} from "../services/hall.service";
import {
  assignSeatToBench,
  createBench,
  getBenchDetail,
  listBenches,
  removeSeatFromBench,
  setBenchActive,
  updateBench,
} from "../services/bench.service";
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
const AUDIT_DEFAULT_PAGE_SIZE = 20;
const AUDIT_MAX_PAGE_SIZE = 100;

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

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
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

    if (method === "GET" && path === "/exam-seating/exams") {
      requireAdmin(user);
      await handleListExams(res);
      return;
    }

    const examConflictsMatch = path.match(/^\/exam-seating\/exams\/([^/]+)\/conflicts$/);
    if (method === "GET" && examConflictsMatch) {
      const actor = requireAdmin(user);
      await handleGetExamConflicts(res, decodePathSegment(examConflictsMatch[1]!), actor.id);
      return;
    }

    const examCandidatesMatch = path.match(/^\/exam-seating\/exams\/([^/]+)\/candidates$/);
    if (method === "GET" && examCandidatesMatch) {
      requireAdmin(user);
      await handleGetExamCandidates(req, res, decodePathSegment(examCandidatesMatch[1]!));
      return;
    }
    if (method === "POST" && examCandidatesMatch) {
      const actor = requireAdmin(user);
      await handleAddExamCandidate(req, res, decodePathSegment(examCandidatesMatch[1]!), actor.id);
      return;
    }

    const examCandidateExcludeMatch = path.match(
      /^\/exam-seating\/exams\/([^/]+)\/candidates\/([^/]+)\/exclude$/,
    );
    if (method === "POST" && examCandidateExcludeMatch) {
      const actor = requireAdmin(user);
      await handleExcludeCandidate(
        req,
        res,
        decodePathSegment(examCandidateExcludeMatch[1]!),
        decodePathSegment(examCandidateExcludeMatch[2]!),
        actor.id,
      );
      return;
    }

    const examCandidateReinstateMatch = path.match(
      /^\/exam-seating\/exams\/([^/]+)\/candidates\/([^/]+)\/reinstate$/,
    );
    if (method === "POST" && examCandidateReinstateMatch) {
      const actor = requireAdmin(user);
      await handleReinstateCandidate(
        req,
        res,
        decodePathSegment(examCandidateReinstateMatch[1]!),
        decodePathSegment(examCandidateReinstateMatch[2]!),
        actor.id,
      );
      return;
    }

    const examCancelMatch = path.match(/^\/exam-seating\/exams\/([^/]+)\/cancel$/);
    if (method === "POST" && examCancelMatch) {
      const actor = requireAdmin(user);
      await handleCancelExam(req, res, decodePathSegment(examCancelMatch[1]!), actor.id);
      return;
    }

    if (method === "GET" && path === "/exam-seating/audit-logs") {
      requireAdmin(user);
      await handleListAuditLogs(req, res);
      return;
    }

    const generationMatch = path.match(/^\/exam-seating\/generations\/([^/]+)$/);
    if (method === "GET" && generationMatch) {
      requireAuth(user);
      const generationId = decodePathSegment(generationMatch[1]!);
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
      const generationId = decodePathSegment(seatingMatch[1]!);
      const result = options.registry.get(generationId);
      if (!result) {
        json(res, 404, { error: "GENERATION_NOT_FOUND", message: `generation ${generationId} not found` });
        return;
      }
      const plan = await getSeatingPlanForExam(result.examId);
      json(res, 200, serializeSeating(plan));
      return;
    }

    const planMatch = path.match(/^\/exam-seating\/plans\/([^/]+)$/);
    if (method === "GET" && planMatch) {
      requireAuth(user);
      const plan = await getSeatingPlanById(planMatch[1]!);
      json(res, 200, serializeSeating(plan));
      return;
    }

    const planApproveMatch = path.match(/^\/exam-seating\/plans\/([^/]+)\/approve$/);
    if (method === "POST" && planApproveMatch) {
      const actor = requireAdmin(user);
      await handleApprovePlan(res, planApproveMatch[1]!, actor.id);
      return;
    }

    const planPublishMatch = path.match(/^\/exam-seating\/plans\/([^/]+)\/publish$/);
    if (method === "POST" && planPublishMatch) {
      const actor = requireAdmin(user);
      await handlePublishPlan(res, planPublishMatch[1]!, actor.id);
      return;
    }

    const documentCandidatesMatch = path.match(/^\/exam-seating\/documents\/([^/]+)\/candidates$/);
    if (method === "GET" && documentCandidatesMatch) {
      requireAuth(user);
      await handleGetDocumentCandidates(req, res, documentCandidatesMatch[1]!);
      return;
    }

    const resolveCandidateMatch = path.match(
      /^\/exam-seating\/documents\/([^/]+)\/candidates\/([^/]+)\/resolve$/,
    );
    if (method === "POST" && resolveCandidateMatch) {
      const actor = requireAdmin(user);
      await handleResolveCandidate(
        res,
        resolveCandidateMatch[1]!,
        resolveCandidateMatch[2]!,
        actor.id,
      );
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

    if (method === "GET" && path === "/exam-seating/departments") {
      requireAuth(user);
      await handleListDepartments(res);
      return;
    }
    if (method === "POST" && path === "/exam-seating/departments") {
      const actor = requireAdmin(user);
      await handleCreateDepartment(req, res, actor.id);
      return;
    }
    const departmentMatch = path.match(/^\/exam-seating\/departments\/([^/]+)$/);
    if (method === "PATCH" && departmentMatch) {
      const actor = requireAdmin(user);
      await handleUpdateDepartment(req, res, departmentMatch[1]!, actor.id);
      return;
    }

    if (method === "GET" && path === "/exam-seating/classes") {
      requireAuth(user);
      await handleListClasses(req, res);
      return;
    }
    if (method === "POST" && path === "/exam-seating/classes") {
      const actor = requireAdmin(user);
      await handleCreateClass(req, res, actor.id);
      return;
    }
    const classMatch = path.match(/^\/exam-seating\/classes\/([^/]+)$/);
    if (method === "PATCH" && classMatch) {
      const actor = requireAdmin(user);
      await handleUpdateClass(req, res, classMatch[1]!, actor.id);
      return;
    }

    const studentStatusMatch = path.match(/^\/exam-seating\/students\/([^/]+)\/status$/);
    if (method === "PATCH" && studentStatusMatch) {
      const actor = requireAuth(user);
      await handleChangeStudentStatus(req, res, studentStatusMatch[1]!, actor.id);
      return;
    }
    if (method === "GET" && path === "/exam-seating/students") {
      requireAuth(user);
      await handleListStudents(req, res);
      return;
    }
    if (method === "POST" && path === "/exam-seating/students") {
      const actor = requireAuth(user);
      await handleCreateStudent(req, res, actor.id);
      return;
    }
    const studentMatch = path.match(/^\/exam-seating\/students\/([^/]+)$/);
    if (method === "GET" && studentMatch) {
      requireAuth(user);
      await handleGetStudent(res, studentMatch[1]!);
      return;
    }
    if (method === "PATCH" && studentMatch) {
      const actor = requireAuth(user);
      await handleUpdateStudent(req, res, studentMatch[1]!, actor.id);
      return;
    }

    if (method === "GET" && path === "/exam-seating/halls") {
      requireAuth(user);
      await handleListHalls(res);
      return;
    }
    if (method === "POST" && path === "/exam-seating/halls") {
      const actor = requireAdmin(user);
      await handleCreateHall(req, res, actor.id);
      return;
    }
    const hallMatch = path.match(/^\/exam-seating\/halls\/([^/]+)$/);
    if (method === "PATCH" && hallMatch) {
      const actor = requireAdmin(user);
      await handleUpdateHall(req, res, hallMatch[1]!, actor.id);
      return;
    }

    const hallBenchesMatch = path.match(/^\/exam-seating\/halls\/([^/]+)\/benches$/);
    if (method === "GET" && hallBenchesMatch) {
      requireAuth(user);
      await handleListBenches(res, hallBenchesMatch[1]!);
      return;
    }
    if (method === "POST" && hallBenchesMatch) {
      const actor = requireAdmin(user);
      await handleCreateBench(req, res, hallBenchesMatch[1]!, actor.id);
      return;
    }

    const benchMatch = path.match(/^\/exam-seating\/benches\/([^/]+)$/);
    if (method === "GET" && benchMatch) {
      requireAuth(user);
      await handleGetBench(res, benchMatch[1]!);
      return;
    }
    if (method === "PATCH" && benchMatch) {
      const actor = requireAdmin(user);
      await handleUpdateBench(req, res, benchMatch[1]!, actor.id);
      return;
    }

    const benchStatusMatch = path.match(/^\/exam-seating\/benches\/([^/]+)\/status$/);
    if (method === "POST" && benchStatusMatch) {
      const actor = requireAdmin(user);
      await handleSetBenchActive(req, res, benchStatusMatch[1]!, actor.id);
      return;
    }

    const benchSeatMatch = path.match(/^\/exam-seating\/benches\/([^/]+)\/seats\/([^/]+)$/);
    if (method === "POST" && benchSeatMatch) {
      const actor = requireAdmin(user);
      await handleAssignSeatToBench(res, benchSeatMatch[1]!, benchSeatMatch[2]!, actor.id);
      return;
    }
    if (method === "DELETE" && benchSeatMatch) {
      const actor = requireAdmin(user);
      await handleRemoveSeatFromBench(res, benchSeatMatch[1]!, benchSeatMatch[2]!, actor.id);
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
    if (error instanceof SeatingError && error.code === "CANDIDATE_NOT_FOUND") {
      json(res, 404, { error: "CANDIDATE_NOT_FOUND" });
      return;
    }
    if (error instanceof SeatingError && error.code === "INVALID_VALIDATION_STATUS_TRANSITION") {
      json(res, 409, { error: error.code, message: error.message });
      return;
    }
    if (error instanceof SeatingError && error.code === "ALREADY_APPROVED") {
      json(res, 409, { error: "ALREADY_APPROVED" });
      return;
    }
    if (error instanceof SeatingError && error.code === "ALREADY_PUBLISHED") {
      json(res, 409, { error: "ALREADY_PUBLISHED" });
      return;
    }
    if (error instanceof SeatingError && error.code === "INVALID_PLAN_STATUS_TRANSITION") {
      json(res, 409, { error: error.code, message: error.message });
      return;
    }
    if (
      error instanceof SeatingError &&
      (error.code === "STUDENT_NOT_FOUND" ||
        error.code === "DEPARTMENT_NOT_FOUND" ||
        error.code === "CLASS_NOT_FOUND" ||
        error.code === "HALL_NOT_FOUND" ||
        error.code === "BENCH_NOT_FOUND")
    ) {
      json(res, 404, { error: error.code, message: error.message });
      return;
    }
    if (
      error instanceof SeatingError &&
      (error.code === "BENCH_SEAT_HALL_MISMATCH" || error.code === "BENCH_SEAT_NOT_ASSIGNED")
    ) {
      json(res, 400, { error: error.code, message: error.message });
      return;
    }
    if (
      error instanceof SeatingError &&
      (error.code === "STUDENT_ALREADY_EXISTS" ||
        error.code === "DEPARTMENT_ALREADY_EXISTS" ||
        error.code === "CLASS_ALREADY_EXISTS")
    ) {
      json(res, 409, { error: error.code, message: error.message });
      return;
    }
    if (
      error instanceof SeatingError &&
      (error.code === "EXAM_NOT_MUTABLE" ||
        error.code === "STUDENT_ALREADY_CANDIDATE" ||
        error.code === "EXAM_CANCELLATION_BLOCKED_ACTIVE_GENERATION")
    ) {
      json(res, 409, { error: error.code, message: error.message });
      return;
    }
    if (error instanceof SeatingError && error.code === "INVALID_INPUT") {
      json(res, 400, { error: error.code, message: error.message });
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
          assignedCount: result.plan.assignedCount,
          unassignedCount: result.plan.unassignedCount,
        }
      : null,
  };
}

function serializeSeating(plan: unknown) {
  return { plan };
}

async function handleApprovePlan(
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  await approvePlan(id, actorId);
  const plan = await getSeatingPlanById(id);
  json(res, 200, serializeSeating(plan));
}

async function handlePublishPlan(
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  await publishPlan(id, actorId);
  const plan = await getSeatingPlanById(id);
  json(res, 200, serializeSeating(plan));
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

async function handleListExams(res: import("node:http").ServerResponse) {
  const exams = await listExams();
  json(res, 200, { exams: exams.map(serializeExam) });
}

function serializeExam(exam: {
  id: string;
  examDate: Date;
  session: string;
  examType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: exam.id,
    examDate: exam.examDate,
    session: exam.session,
    examType: exam.examType,
    status: exam.status,
    createdAt: exam.createdAt,
    updatedAt: exam.updatedAt,
  };
}

async function handleGetExamConflicts(
  res: import("node:http").ServerResponse,
  examId: string,
  actorId: string,
) {
  const report = await checkExamConflicts(examId);
  await logAudit({
    actorId,
    action: "EXAM_CONFLICT_CHECKED",
    entityType: "Exam",
    entityId: examId,
    metadata: { conflictCount: report.conflicts.length },
  });
  json(res, 200, serializeConflictReport(report));
}

function serializeConflictReport(report: {
  examId: string;
  examDate: Date;
  session: string;
  conflicts: Array<{
    studentId: string;
    registerNumber: string;
    studentName: string;
    candidate: {
      candidateId: string;
      examId: string;
      status: string;
      subjectCode: string;
      subjectName: string;
      validationStatus: string;
    };
    conflictingExams: Array<{
      candidateId: string;
      examId: string;
      status: string;
      subjectCode: string;
      subjectName: string;
      validationStatus: string;
    }>;
  }>;
}) {
  return {
    examId: report.examId,
    examDate: report.examDate,
    session: report.session,
    conflicts: report.conflicts,
  };
}

async function handleGetExamCandidates(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  examId: string,
) {
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
  const where = { examId };
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
  json(res, 200, { examId, total, offset: parsedOffset, limit: parsedLimit, candidates });
}

async function handleAddExamCandidate(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  examId: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const studentId = body.studentId;
  if (typeof studentId !== "string" || studentId.length === 0) {
    json(res, 400, { error: "INVALID_INPUT", message: "studentId is required" });
    return;
  }
  const reason = typeof body.reason === "string" && body.reason.length > 0 ? body.reason : undefined;
  const subjectCode = typeof body.subjectCode === "string" ? body.subjectCode : undefined;
  const subjectName = typeof body.subjectName === "string" ? body.subjectName : undefined;
  const candidate = await addCandidateFromMaster(
    { examId, studentId, reason, subjectCode, subjectName },
    actorId,
  );
  json(res, 200, { candidate: serializeCandidate(candidate) });
}

async function handleExcludeCandidate(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  examId: string,
  candidateId: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const candidate = await getCandidate(candidateId);
  if (candidate.examId !== examId) {
    throw new SeatingError("ExamCandidate not found", "CANDIDATE_NOT_FOUND");
  }
  const reason = typeof body.reason === "string" ? body.reason : "";
  const updated = await excludeCandidate(candidateId, reason, actorId);
  json(res, 200, { candidate: serializeCandidate(updated) });
}

async function handleReinstateCandidate(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  examId: string,
  candidateId: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const candidate = await getCandidate(candidateId);
  if (candidate.examId !== examId) {
    throw new SeatingError("ExamCandidate not found", "CANDIDATE_NOT_FOUND");
  }
  const reason = typeof body.reason === "string" && body.reason.length > 0 ? body.reason : undefined;
  const updated = await reinstateCandidate(candidateId, reason, actorId);
  json(res, 200, { candidate: serializeCandidate(updated) });
}

async function handleCancelExam(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  examId: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const reason = typeof body.reason === "string" && body.reason.length > 0 ? body.reason : undefined;
  const exam = await cancelExam(examId, actorId, reason);
  json(res, 200, { exam: serializeExam(exam) });
}

async function handleListAuditLogs(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parsedLimit = Number(url.searchParams.get("limit") ?? AUDIT_DEFAULT_PAGE_SIZE);
  const parsedOffset = Number(url.searchParams.get("offset") ?? 0);
  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > AUDIT_MAX_PAGE_SIZE ||
    !Number.isInteger(parsedOffset) ||
    parsedOffset < 0
  ) {
    json(res, 400, {
      error: "INVALID_PAGINATION",
      message: `limit must be 1..${AUDIT_MAX_PAGE_SIZE} and offset must be >= 0`,
    });
    return;
  }

  const where: Prisma.AuditLogWhereInput = {};

  const actionRaw = url.searchParams.get("action");
  if (actionRaw !== null && actionRaw.length > 0) {
    if (!Object.values(AuditAction).includes(actionRaw as AuditAction)) {
      json(res, 400, { error: "INVALID_ACTION", message: "action must be a valid audit action" });
      return;
    }
    where.action = actionRaw as AuditAction;
  }

  const entityType = url.searchParams.get("entityType");
  if (entityType !== null && entityType.length > 0) where.entityType = entityType;

  const entityId = url.searchParams.get("entityId");
  if (entityId !== null && entityId.length > 0) where.entityId = entityId;

  const actorId = url.searchParams.get("actorId");
  if (actorId !== null && actorId.length > 0) where.actorId = actorId;

  const from = parseIsoDate(url.searchParams.get("from"));
  const to = parseIsoDate(url.searchParams.get("to"));
  if (from === null || to === null) {
    json(res, 400, { error: "INVALID_DATE", message: "from and to must be valid ISO timestamps" });
    return;
  }
  if (from !== undefined && to !== undefined && from.getTime() > to.getTime()) {
    json(res, 400, { error: "INVALID_DATE_RANGE", message: "from must not be after to" });
    return;
  }
  if (from !== undefined || to !== undefined) {
    where.createdAt = {
      ...(from !== undefined ? { gte: from } : {}),
      ...(to !== undefined ? { lte: to } : {}),
    };
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: parsedOffset,
      take: parsedLimit,
    }),
  ]);

  // Resolve the page's actors in a single bounded query (no N+1).
  const actorIds = [
    ...new Set(logs.map((log) => log.actorId).filter((id): id is string => Boolean(id))),
  ];
  const usersById = new Map<string, { id: string; username: string; role: string }>();
  if (actorIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, username: true, role: true },
    });
    for (const user of users) usersById.set(user.id, user);
  }

  json(res, 200, {
    items: logs.map((log) => serializeAuditLog(log, usersById)),
    total,
    limit: parsedLimit,
    offset: parsedOffset,
  });
}

function parseIsoDate(value: string | null): Date | undefined | null {
  if (value === null || value.length === 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeAuditLog(
  log: {
    id: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: Date;
  },
  usersById: Map<string, { id: string; username: string; role: string }>,
) {
  const user = log.actorId ? usersById.get(log.actorId) : undefined;
  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    createdAt: log.createdAt,
    actor: user ? { id: user.id, username: user.username, role: user.role } : null,
  };
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

async function handleResolveCandidate(
  res: import("node:http").ServerResponse,
  documentId: string,
  candidateId: string,
  actorId: string,
) {
  const candidate = await getCandidate(candidateId);
  if (candidate.sourceDocumentId !== documentId) {
    throw new SeatingError("ExamCandidate not found", "CANDIDATE_NOT_FOUND");
  }
  const updated = await transitionValidationStatus(candidateId, "VALIDATED", actorId);
  json(res, 200, { candidate: serializeCandidate(updated) });
}

function serializeCandidate(candidate: {
  id: string;
  registerNumberSnapshot: string;
  studentNameSnapshot: string;
  departmentSnapshot: string;
  genderSnapshot: string;
  classSnapshot: string;
  subjectCode: string;
  subjectName: string;
  validationStatus: string;
}) {
  return {
    id: candidate.id,
    registerNumberSnapshot: candidate.registerNumberSnapshot,
    studentNameSnapshot: candidate.studentNameSnapshot,
    departmentSnapshot: candidate.departmentSnapshot,
    genderSnapshot: candidate.genderSnapshot,
    classSnapshot: candidate.classSnapshot,
    subjectCode: candidate.subjectCode,
    subjectName: candidate.subjectName,
    validationStatus: candidate.validationStatus,
  };
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

async function handleListDepartments(res: import("node:http").ServerResponse) {
  const departments = await listDepartments();
  json(res, 200, { departments });
}

async function handleCreateDepartment(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const department = await createDepartment(
    { code: String(body.code ?? ""), name: String(body.name ?? "") },
    actorId,
  );
  json(res, 200, { department });
}

async function handleUpdateDepartment(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const patch: { code?: string; name?: string } = {};
  if (body.code !== undefined) patch.code = String(body.code);
  if (body.name !== undefined) patch.name = String(body.name);
  if (Object.keys(patch).length === 0) {
    json(res, 400, { error: "INVALID_INPUT", message: "at least one field must be provided" });
    return;
  }
  const department = await updateDepartment(id, patch, actorId);
  json(res, 200, { department });
}

async function handleListClasses(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const departmentId = url.searchParams.get("departmentId") ?? undefined;
  const classes = await listClasses({ departmentId });
  json(res, 200, { classes });
}

async function handleCreateClass(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const cls = await createClass(
    {
      departmentId: String(body.departmentId ?? ""),
      name: String(body.name ?? ""),
      year: Number(body.year),
      section: String(body.section ?? ""),
      academicYear: String(body.academicYear ?? ""),
    },
    actorId,
  );
  json(res, 200, { class: cls });
}

async function handleUpdateClass(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const patch: {
    departmentId?: string;
    name?: string;
    year?: number;
    section?: string;
    academicYear?: string;
  } = {};
  if (body.departmentId !== undefined) patch.departmentId = String(body.departmentId);
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.year !== undefined) patch.year = Number(body.year);
  if (body.section !== undefined) patch.section = String(body.section);
  if (body.academicYear !== undefined) patch.academicYear = String(body.academicYear);
  if (Object.keys(patch).length === 0) {
    json(res, 400, { error: "INVALID_INPUT", message: "at least one field must be provided" });
    return;
  }
  const cls = await updateClass(id, patch, actorId);
  json(res, 200, { class: cls });
}

async function handleListStudents(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
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
  const search = url.searchParams.get("search") ?? undefined;
  const departmentId = url.searchParams.get("departmentId") ?? undefined;
  const classId = url.searchParams.get("classId") ?? undefined;
  const statusRaw = url.searchParams.get("status");
  const page = await listStudents({
    search,
    departmentId,
    classId,
    status: statusRaw !== null && statusRaw.length > 0 ? (statusRaw as never) : undefined,
    limit: parsedLimit,
    offset: parsedOffset,
  });
  json(res, 200, {
    students: page.students,
    total: page.total,
    limit: parsedLimit,
    offset: parsedOffset,
  });
}

async function handleGetStudent(
  res: import("node:http").ServerResponse,
  id: string,
) {
  const student = await getStudent(id);
  json(res, 200, { student });
}

async function handleCreateStudent(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const student = await createStudent(
    {
      name: String(body.name ?? ""),
      rollNumber: String(body.rollNumber ?? ""),
      registerNumber: String(body.registerNumber ?? ""),
      gender: body.gender as never,
      classId: String(body.classId ?? ""),
      status: (body.status ?? "ACTIVE") as never,
    },
    actorId,
  );
  json(res, 200, { student });
}

async function handleUpdateStudent(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const patch: {
    name?: string;
    rollNumber?: string;
    registerNumber?: string;
    gender?: never;
    classId?: string;
  } = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.rollNumber !== undefined) patch.rollNumber = String(body.rollNumber);
  if (body.registerNumber !== undefined) patch.registerNumber = String(body.registerNumber);
  if (body.gender !== undefined) patch.gender = body.gender as never;
  if (body.classId !== undefined) patch.classId = String(body.classId);
  if (Object.keys(patch).length === 0) {
    json(res, 400, { error: "INVALID_INPUT", message: "at least one field must be provided" });
    return;
  }
  const student = await updateStudent(id, patch, actorId);
  json(res, 200, { student });
}

async function handleChangeStudentStatus(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const student = await changeStudentStatus(id, body.status as never, actorId);
  json(res, 200, { student });
}

async function handleListHalls(res: import("node:http").ServerResponse) {
  const halls = await listHalls();
  json(res, 200, { halls: halls.map(serializeHall) });
}

async function handleCreateHall(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const hall = await createHall({
    hallNumber: String(body.hallNumber ?? ""),
    name: String(body.name ?? ""),
    building: body.building === undefined ? null : String(body.building),
    rows: Number(body.rows),
    columns: Number(body.columns),
  });
  await logAudit({
    actorId,
    action: "HALL_CREATED",
    entityType: "Hall",
    entityId: hall.id,
    metadata: {
      hallNumber: hall.hallNumber,
      rows: hall.rows,
      columns: hall.columns,
    },
  });
  json(res, 200, { hall: serializeHall(await listHallsHall(hall.id)) });
}

async function handleUpdateHall(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const patch: { name?: string; building?: string | null; isActive?: boolean } = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.building !== undefined) patch.building = body.building === null ? null : String(body.building);
  if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
  if (Object.keys(patch).length === 0) {
    json(res, 400, { error: "INVALID_INPUT", message: "at least one field must be provided" });
    return;
  }
  const before = await getHall(id);
  const hall = await updateHall(id, patch);
  await logAudit({
    actorId,
    action: "HALL_UPDATED",
    entityType: "Hall",
    entityId: id,
    metadata: {
      previous: { name: before.name, building: before.building, isActive: before.isActive },
      next: { name: hall.name, building: hall.building, isActive: hall.isActive },
    },
  });
  json(res, 200, { hall: serializeHall(await listHallsHall(id)) });
}

async function handleListBenches(
  res: import("node:http").ServerResponse,
  hallId: string,
) {
  const benches = await listBenches(hallId);
  json(res, 200, { hallId, benches: benches.map(serializeBench) });
}

async function handleCreateBench(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  hallId: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const bench = await createBench(
    {
      hallId,
      benchNumber: String(body.benchNumber ?? ""),
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    },
    actorId,
  );
  json(res, 200, { bench: serializeBench(await getBenchDetail(bench.id)) });
}

async function handleGetBench(res: import("node:http").ServerResponse, id: string) {
  json(res, 200, { bench: serializeBench(await getBenchDetail(id)) });
}

async function handleUpdateBench(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const patch: { benchNumber?: string; isActive?: boolean } = {};
  if (body.benchNumber !== undefined) patch.benchNumber = String(body.benchNumber);
  if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
  const bench = await updateBench(id, patch, actorId);
  json(res, 200, { bench: serializeBench(await getBenchDetail(bench.id)) });
}

async function handleSetBenchActive(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  id: string,
  actorId: string,
) {
  const body = await readJsonBody(req, res);
  if (!body) return;
  if (body.isActive === undefined || typeof body.isActive !== "boolean") {
    json(res, 400, { error: "INVALID_INPUT", message: "isActive must be a boolean" });
    return;
  }
  const bench = await setBenchActive(id, body.isActive, actorId);
  json(res, 200, { bench: serializeBench(await getBenchDetail(bench.id)) });
}

async function handleAssignSeatToBench(
  res: import("node:http").ServerResponse,
  benchId: string,
  hallSeatId: string,
  actorId: string,
) {
  const seat = await assignSeatToBench(benchId, hallSeatId, actorId);
  json(res, 200, { hallSeat: serializeHallSeat(seat) });
}

async function handleRemoveSeatFromBench(
  res: import("node:http").ServerResponse,
  benchId: string,
  hallSeatId: string,
  actorId: string,
) {
  const seat = await removeSeatFromBench(benchId, hallSeatId, actorId);
  json(res, 200, { hallSeat: serializeHallSeat(seat) });
}

async function listHallsHall(id: string) {
  const halls = await listHalls();
  const hall = halls.find((h) => h.id === id);
  if (!hall) throw new SeatingError("Hall not found", "HALL_NOT_FOUND");
  return hall;
}

function serializeHall(hall: {
  id: string;
  hallNumber: string;
  name: string;
  building: string | null;
  rows: number;
  columns: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  seats: Array<{
    id: string;
    benchId: string | null;
    seatPosition: string;
    row: string;
    column: number;
    isActive: boolean;
  }>;
  benches: Array<{
    id: string;
    hallId: string;
    benchNumber: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    seats: Array<{
      id: string;
      benchId: string | null;
      seatPosition: string;
      row: string;
      column: number;
      isActive: boolean;
    }>;
  }>;
}) {
  const seats = hall.seats;
  return {
    id: hall.id,
    hallNumber: hall.hallNumber,
    name: hall.name,
    building: hall.building,
    rows: hall.rows,
    columns: hall.columns,
    isActive: hall.isActive,
    createdAt: hall.createdAt,
    updatedAt: hall.updatedAt,
    totalSeatCount: seats.length,
    activeSeatCount: seats.filter((s) => s.isActive).length,
    unassignedSeats: seats
      .filter((s) => s.benchId === null)
      .map((s) => ({ ...s })),
    benches: hall.benches.map((b) => ({
      id: b.id,
      hallId: b.hallId,
      benchNumber: b.benchNumber,
      isActive: b.isActive,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      capacity: b.seats.filter((s) => s.isActive).length,
      seats: b.seats.map((s) => ({ ...s })),
    })),
  };
}

function serializeBench(bench: {
  id: string;
  hallId: string;
  benchNumber: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  hall?: { id: string; hallNumber: string; name: string; building: string | null };
  seats?: Array<{
    id: string;
    seatPosition: string;
    row: string;
    column: number;
    isActive: boolean;
  }>;
}) {
  const seats = bench.seats ?? [];
  return {
    id: bench.id,
    hallId: bench.hallId,
    benchNumber: bench.benchNumber,
    isActive: bench.isActive,
    createdAt: bench.createdAt,
    updatedAt: bench.updatedAt,
    hall: bench.hall ?? null,
    capacity: seats.filter((s) => s.isActive).length,
    seats,
  };
}

function serializeHallSeat(seat: {
  id: string;
  hallId: string;
  benchId: string | null;
  seatPosition: string;
  row: string;
  column: number;
  isActive: boolean;
}) {
  return {
    id: seat.id,
    hallId: seat.hallId,
    benchId: seat.benchId,
    seatPosition: seat.seatPosition,
    row: seat.row,
    column: seat.column,
    isActive: seat.isActive,
  };
}

async function readJsonBody(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<Record<string, unknown> | null> {
  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    json(res, 400, { error: "INVALID_JSON", message: "request body must be JSON" });
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    json(res, 400, { error: "INVALID_JSON", message: "request body must be a JSON object" });
    return null;
  }
  return parsed as Record<string, unknown>;
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