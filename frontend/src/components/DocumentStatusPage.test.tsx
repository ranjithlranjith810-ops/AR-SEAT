import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../lib/api";
import type { UploadedDocument } from "../lib/types";
import { DocumentStatusPage } from "./DocumentStatusPage";
import { renderParamRoute } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, getDocument: vi.fn(), getDocumentCandidates: vi.fn() };
});

const { getDocument, getDocumentCandidates } = await import("../lib/api");
const mockedGetDocument = vi.mocked(getDocument);
const mockedGetDocumentCandidates = vi.mocked(getDocumentCandidates);

function doc(overrides: Partial<UploadedDocument> = {}): UploadedDocument {
  return {
    id: "doc-1",
    examId: "exam-1",
    fileName: "list.pdf",
    mimeType: "application/pdf",
    fileSize: 2048,
    fileHash: "a".repeat(64),
    parseStatus: "PARSED",
    parseMetadata: null,
    uploadedBy: null,
    createdAt: "2026-08-17T06:00:00.000Z",
    updatedAt: "2026-08-17T06:00:01.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockedGetDocument.mockReset();
  mockedGetDocumentCandidates.mockReset();
});

describe("DocumentStatusPage", () => {
  it("shows a loading state while the document is being fetched", async () => {
    let resolveDoc: (d: UploadedDocument) => void = () => undefined;
    mockedGetDocument.mockReturnValue(new Promise((resolve) => (resolveDoc = resolve)));

    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);
    expect(screen.getByText("Loading ingestion status...")).toBeInTheDocument();

    await act(async () => {
      resolveDoc(doc());
    });
  });

  it("requests the ingestion status for the URL document ID", async () => {
mockedGetDocument.mockResolvedValue(doc());
    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);
    await screen.findByText("Processing complete. Candidates are ready for review.");
    expect(mockedGetDocument).toHaveBeenCalledWith("doc-1");
  });

  it("shows document metadata and a View candidates action for a completed document", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);

expect(await screen.findByText("Processing complete. Candidates are ready for review.")).toBeInTheDocument();
    expect(screen.getByText("doc-1")).toBeInTheDocument();
    expect(screen.getByText("exam-1")).toBeInTheDocument();
    expect(screen.getByText("list.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View candidates" })).toBeInTheDocument();
  });

  it("polls while processing and stops at the terminal state", async () => {
    vi.useFakeTimers();
    mockedGetDocument
      .mockResolvedValueOnce(doc({ parseStatus: "PROCESSING" }))
      .mockResolvedValueOnce(doc({ parseStatus: "PARSED" }));

    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);
    await act(async () => {});
expect(
      screen.getByText("Processing student records. This view refreshes automatically until processing finishes."),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("Processing complete. Candidates are ready for review.")).toBeInTheDocument();
    expect(mockedGetDocument).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(mockedGetDocument).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("never exposes internal metadata for a failed document", async () => {
    mockedGetDocument.mockResolvedValue(
      doc({
        parseStatus: "FAILED",
        parseMetadata: { error: "PrismaClientKnownRequestError: connection failed" },
      }),
    );
    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);

    expect(await screen.findByText(/Processing failed/)).toBeInTheDocument();
    expect(screen.queryByText(/Prisma/)).not.toBeInTheDocument();
    expect(screen.queryByText(/connection failed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View candidates" })).not.toBeInTheDocument();
  });

it("shows a partial-processing state for NEEDS_REVIEW with matched and unresolved counts", async () => {
    mockedGetDocument.mockResolvedValue(
      doc({
        parseStatus: "NEEDS_REVIEW",
        parseMetadata: { warnings: [], issues: { STUDENT_NOT_FOUND: 3 } },
      }),
    );
    mockedGetDocumentCandidates.mockResolvedValue({
      documentId: "doc-1",
      total: 3,
      offset: 0,
      limit: 1,
      candidates: [],
    });
    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);

    expect(await screen.findByText("NEEDS_REVIEW")).toBeInTheDocument();
    expect(screen.getByText(/partially processed/)).toBeInTheDocument();
    expect(await screen.findByText("Matched candidates")).toBeInTheDocument();
    expect(screen.getByText("Unresolved rows")).toBeInTheDocument();
    expect(
      screen.getByText(/The document contains 3 rows that could not be matched against the Student Master/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View 3 candidates" })).toBeInTheDocument();
  });

  it("does not fabricate counts when the backend metadata has none", async () => {
    mockedGetDocument.mockResolvedValue(doc({ parseStatus: "NEEDS_REVIEW", parseMetadata: null }));
    mockedGetDocumentCandidates.mockResolvedValue({
      documentId: "doc-1",
      total: 5,
      offset: 0,
      limit: 1,
      candidates: [],
    });
    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);
    expect(await screen.findByText(/partially processed/)).toBeInTheDocument();
    expect(await screen.findByText("Matched candidates")).toBeInTheDocument();
    expect(screen.queryByText("Unresolved rows")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/could not be matched against the Student Master/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View 5 candidates" })).toBeInTheDocument();
  });

  it("shows a safe error and Retry for a malformed/unexpected API response", async () => {
    mockedGetDocument.mockRejectedValue(new Error("unexpected"));
    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await waitFor(() => expect(mockedGetDocument).toHaveBeenCalledWith("doc-1"));
  });

  it("shows a safe message when the document does not exist", async () => {
    mockedGetDocument.mockRejectedValue(new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found"));
    renderParamRoute(<DocumentStatusPage />, "/documents/:documentId", null);
    expect(await screen.findByText("Document not found.")).toBeInTheDocument();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
