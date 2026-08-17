import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveSeatingPlan,
  generateSeating,
  getDocumentCandidates,
  getExams,
  getGenerationStatus,
  getMe,
  getSeatingPlan,
  login,
  publishSeatingPlan,
  uploadDocument,
} from "./api";
import type { CandidatePage, GenerationCreated, IngestReport, PublicUser } from "./types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetchOnce(response: {
  status: number;
  body: unknown;
  ok?: boolean;
}) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

function stubFetchReject(error: Error) {
  globalThis.fetch = vi.fn().mockRejectedValue(error) as unknown as typeof fetch;
}

describe("api client", () => {
  it("login posts credentials and returns the public user", async () => {
    stubFetchOnce({ status: 200, body: { user: { id: "u1", username: "admin", role: "ADMIN" } } });
    const user: PublicUser = await login("admin", "secret");
    expect(user).toEqual({ id: "u1", username: "admin", role: "ADMIN" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ username: "admin", password: "secret" }),
      }),
    );
  });

  it("login failure throws ApiError with the backend error code", async () => {
    stubFetchOnce({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "invalid username or password" } });
    await expect(login("admin", "wrong")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
  });

  it("getMe returns null on 401 and the user on 200", async () => {
    stubFetchOnce({ status: 401, body: { error: "UNAUTHORIZED" } });
    expect(await getMe()).toBeNull();

    stubFetchOnce({ status: 200, body: { user: { id: "u1", username: "staff", role: "STAFF" } } });
    expect(await getMe()).toMatchObject({ role: "STAFF" });
  });

  it("uploadDocument uses the Phase 9 endpoint with PDF headers and binary body", async () => {
    const report: IngestReport = {
      documentId: "doc-1",
      finalParseStatus: "PARSED",
      counts: { extractedRows: 3, normalized: 3, validated: 3, matched: 3, rejected: 0 },
      issuesByCode: {},
      candidatesPersisted: 3,
      header: {},
      warnings: [],
      duplicate: false,
      fileName: "list.pdf",
    };
    stubFetchOnce({ status: 200, body: report });
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

    const result = await uploadDocument("exam-1", { name: "list.pdf", data });

    expect(result.documentId).toBe("doc-1");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/pdf");
    expect((init.headers as Record<string, string>)["X-File-Name"]).toBe("list.pdf");
    expect(init.body).toBe(data);
  });

  it("uploadDocument sanitizes control characters out of the X-File-Name header", async () => {
    stubFetchOnce({ status: 200, body: { documentId: "doc-1" } });
    await uploadDocument("exam-1", {
      name: "bad\u0000\u202ename.pdf",
      data: new Uint8Array(0),
    });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["X-File-Name"]).toBe("badname.pdf");
  });

  it("uploadDocument encodes the examId query parameter", async () => {
    stubFetchOnce({ status: 200, body: { documentId: "doc-1" } });
    await uploadDocument("exam /x", { name: "a.pdf", data: new Uint8Array(0) });
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("/exam-seating/documents?examId=exam%20%2Fx");
  });

  it("getDocumentCandidates sends limit and offset", async () => {
    stubFetchOnce({ status: 200, body: { documentId: "doc-1", total: 0, offset: 40, limit: 20, candidates: [] } });
    const page: CandidatePage = await getDocumentCandidates("doc-1", 20, 40);
    expect(page.offset).toBe(40);
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("/exam-seating/documents/doc-1/candidates?limit=20&offset=40");
  });

  it("getExams fetches the backend exam list", async () => {
    stubFetchOnce({
      status: 200,
      body: {
        exams: [
          {
            id: "exam-1",
            examDate: "2026-12-03T09:30:00.000Z",
            session: "FN",
            examType: "MODEL",
            status: "DRAFT",
            createdAt: "2026-08-17T06:00:00.000Z",
            updatedAt: "2026-08-17T06:00:01.000Z",
          },
        ],
      },
    });
    const exams = await getExams();
    expect(exams).toHaveLength(1);
    expect(exams[0]).toMatchObject({ id: "exam-1", session: "FN", examType: "MODEL", status: "DRAFT" });
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("/exam-seating/exams");
  });

  it("generateSeating posts the examId to the generations endpoint", async () => {
    const created: GenerationCreated = {
      generationId: "gen-1",
      state: "COMPLETED",
      pollUrl: "/exam-seating/generations/gen-1",
      jobId: "job-1",
    };
    stubFetchOnce({ status: 200, body: created });
    const result = await generateSeating("exam-1");
    expect(result).toEqual(created);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/exam-seating/generations");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ examId: "exam-1" }));
  });

  it("generateSeating surfaces a duplicate-generation 409 as ERR_JOB_ALREADY_ACTIVE", async () => {
    stubFetchOnce({
      status: 409,
      body: { error: "ERR_JOB_ALREADY_ACTIVE", message: "active generation already exists" },
    });
    await expect(generateSeating("exam-1")).rejects.toMatchObject({
      status: 409,
      code: "ERR_JOB_ALREADY_ACTIVE",
    });
  });

  it("getGenerationStatus fetches the encoded generation id", async () => {
    stubFetchOnce({
      status: 200,
      body: { generationId: "gen/1", state: "COMPLETED", sessionCandidateCount: 0, plan: null },
    });
    const status = await getGenerationStatus("gen/1");
    expect(status.state).toBe("COMPLETED");
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("/exam-seating/generations/gen%2F1");
  });

  it("getSeatingPlan unwraps the plan payload from the plan-by-id route", async () => {
    stubFetchOnce({
      status: 200,
      body: {
        plan: {
          id: "plan-1",
          examId: "exam-1",
          version: 1,
          status: "DRAFT",
          createdAt: "2026-08-17T06:00:00.000Z",
          updatedAt: "2026-08-17T06:00:01.000Z",
          assignments: [],
        },
      },
    });
    const plan = await getSeatingPlan("plan-1");
    expect(plan).toMatchObject({ id: "plan-1", status: "DRAFT" });
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("/exam-seating/plans/plan-1");
  });

  it("approveSeatingPlan POSTs to the approve route and unwraps the plan", async () => {
    stubFetchOnce({
      status: 200,
      body: { plan: { id: "plan-1", examId: "exam-1", version: 1, status: "APPROVED", assignments: [] } },
    });
    const plan = await approveSeatingPlan("plan-1");
    expect(plan).toMatchObject({ id: "plan-1", status: "APPROVED" });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/exam-seating/plans/plan-1/approve");
    expect(init.method).toBe("POST");
  });

  it("approveSeatingPlan surfaces 409 ALREADY_APPROVED", async () => {
    stubFetchOnce({ status: 409, body: { error: "ALREADY_APPROVED" } });
    await expect(approveSeatingPlan("plan-1")).rejects.toMatchObject({
      status: 409,
      code: "ALREADY_APPROVED",
    });
  });

  it("publishSeatingPlan POSTs to the publish route and unwraps the plan", async () => {
    stubFetchOnce({
      status: 200,
      body: { plan: { id: "plan-1", examId: "exam-1", version: 1, status: "PUBLISHED", assignments: [] } },
    });
    const plan = await publishSeatingPlan("plan-1");
    expect(plan).toMatchObject({ id: "plan-1", status: "PUBLISHED" });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/exam-seating/plans/plan-1/publish");
    expect(init.method).toBe("POST");
  });

  it("publishSeatingPlan surfaces 409 ALREADY_PUBLISHED", async () => {
    stubFetchOnce({ status: 409, body: { error: "ALREADY_PUBLISHED" } });
    await expect(publishSeatingPlan("plan-1")).rejects.toMatchObject({
      status: 409,
      code: "ALREADY_PUBLISHED",
    });
  });

  it("maps network failure to a NETWORK_ERROR ApiError", async () => {
    stubFetchReject(new TypeError("fetch failed"));
    await expect(getDocumentCandidates("doc-1", 20, 0)).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("maps a malformed 2xx response to INVALID_RESPONSE", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html>not json</html>", { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(getDocumentCandidates("doc-1", 20, 0)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("sanitizes header value fallback when filename has no printable ASCII", async () => {
    stubFetchOnce({ status: 200, body: { documentId: "doc-1" } });
    await uploadDocument("exam-1", { name: "\u0000\u0001", data: new Uint8Array(0) });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["X-File-Name"]).toBe("document.pdf");
  });
});