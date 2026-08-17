import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../lib/api";
import type { Candidate, CandidatePage as CandidatePageData, GenerationCreated, PublicUser, UploadedDocument } from "../lib/types";
import { CandidatePage } from "./CandidatePage";
import { adminUser, renderParamRoute, renderRoutes, staffUser } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    getDocument: vi.fn(),
    getDocumentCandidates: vi.fn(),
    generateSeating: vi.fn(),
  };
});

const { getDocument, getDocumentCandidates, generateSeating } = await import("../lib/api");
const mockedGetDocument = vi.mocked(getDocument);
const mockedCandidates = vi.mocked(getDocumentCandidates);
const mockedGenerateSeating = vi.mocked(generateSeating);

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

function candidate(registerNumber: string, name: string): Candidate {
  return {
    id: `c-${registerNumber}`,
    registerNumberSnapshot: registerNumber,
    studentNameSnapshot: name,
    departmentSnapshot: "CSE",
    genderSnapshot: "MALE",
    classSnapshot: "CSE-A",
    subjectCode: "CS501",
    subjectName: "OS",
    validationStatus: "MATCHED",
  };
}

function page(total: number, offset: number, candidates: Candidate[]): CandidatePageData {
  return { documentId: "doc-1", total, offset, limit: 20, candidates };
}

function renderCandidates(
  user: PublicUser | null = null,
  initial = "/documents/doc-1/candidates",
) {
  return renderRoutes(
    <Routes>
      <Route path="/documents/:documentId/candidates" element={<CandidatePage />} />
      <Route path="/generations/:generationId" element={<div>generation-target</div>} />
    </Routes>,
    user,
    initial,
  );
}

function created(overrides: Partial<GenerationCreated> = {}): GenerationCreated {
  return {
    generationId: "gen-1",
    state: "COMPLETED",
    pollUrl: "/exam-seating/generations/gen-1",
    jobId: "job-1",
    ...overrides,
  };
}

beforeEach(() => {
  mockedGetDocument.mockReset();
  mockedCandidates.mockReset();
  mockedGenerateSeating.mockReset();
});

describe("CandidatePage", () => {
  it("loads and renders the master-sourced candidate rows", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockResolvedValue(page(2, 0, [candidate("R1", "ALICE"), candidate("R2", "BOB")]));

    renderParamRoute(<CandidatePage />, "/documents/:documentId/candidates", null);

    expect(await screen.findByText("ALICE")).toBeInTheDocument();
    expect(screen.getByText("BOB")).toBeInTheDocument();
    expect(screen.getByText("R1")).toBeInTheDocument();
    expect(screen.getAllByText("CSE-A")).toHaveLength(2);
    expect(screen.getByText(/master-sourced/)).toBeInTheDocument();
    expect(screen.getByText("Showing 1–2 of 2")).toBeInTheDocument();
  });

  it("paginates using the backend offset contract", async () => {
    const names = Array.from({ length: 45 }, (_, i) => `STUDENT ${i + 1}`);
    const all = names.map((n, i) => candidate(`R${i + 1}`, n));

    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates
      .mockResolvedValueOnce(page(45, 0, all.slice(0, 20)))
      .mockResolvedValueOnce(page(45, 20, all.slice(20, 40)))
      .mockResolvedValueOnce(page(45, 40, all.slice(40)))
      .mockResolvedValueOnce(page(45, 20, all.slice(20, 40)));

    const uploader = userEvent.setup();
    renderParamRoute(<CandidatePage />, "/documents/:documentId/candidates", null);

    expect(await screen.findByText("Showing 1–20 of 45")).toBeInTheDocument();
    expect(screen.getByText("STUDENT 1")).toBeInTheDocument();

    await uploader.click(screen.getByRole("button", { name: "Next" }));
    expect(mockedCandidates).toHaveBeenLastCalledWith("doc-1", 20, 20);
    expect(await screen.findByText("Showing 21–40 of 45")).toBeInTheDocument();

    await uploader.click(screen.getByRole("button", { name: "Next" }));
    expect(mockedCandidates).toHaveBeenLastCalledWith("doc-1", 20, 40);
    expect(await screen.findByText("Showing 41–45 of 45")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await uploader.click(screen.getByRole("button", { name: "Previous" }));
    expect(mockedCandidates).toHaveBeenLastCalledWith("doc-1", 20, 20);
    expect(await screen.findByText("Showing 21–40 of 45")).toBeInTheDocument();
  });

  it("disables Previous on the first page", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockResolvedValue(page(45, 0, [candidate("R1", "ALICE")]));
    renderParamRoute(<CandidatePage />, "/documents/:documentId/candidates", null);
    await screen.findByText("ALICE");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("shows an empty state when the document has no candidates", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockResolvedValue(page(0, 0, []));
    renderParamRoute(<CandidatePage />, "/documents/:documentId/candidates", null);
    expect(await screen.findByText("No candidates found for this document.")).toBeInTheDocument();
  });

  it("shows the partial-processing banner for a NEEDS_REVIEW document", async () => {
    mockedGetDocument.mockResolvedValue(doc({ parseStatus: "NEEDS_REVIEW" }));
    mockedCandidates.mockResolvedValue(page(2, 0, [candidate("R1", "ALICE")]));
    renderParamRoute(<CandidatePage />, "/documents/:documentId/candidates", null);
    expect(await screen.findByText(/partially processed/)).toBeInTheDocument();
    expect(screen.getByText("ALICE")).toBeInTheDocument();
  });

  it("shows a safe error state when the candidates API fails", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockRejectedValue(new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found"));
    renderParamRoute(<CandidatePage />, "/documents/:documentId/candidates", null);
    expect(await screen.findByText("Document not found.")).toBeInTheDocument();
  });

  it("keeps prior rows visible during pagination without a blank screen", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    let resolveNext: (p: CandidatePageData) => void = () => undefined;
    mockedCandidates
      .mockResolvedValueOnce(page(40, 0, [candidate("R1", "ALICE")]))
      .mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)));

    const uploader = userEvent.setup();
    renderParamRoute(<CandidatePage />, "/documents/:documentId/candidates", null);
    await screen.findByText("ALICE");

    await uploader.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("ALICE")).toBeInTheDocument();

    resolveNext(page(40, 20, [candidate("R21", "CAROL")]));
    await waitFor(() => expect(screen.getByText("CAROL")).toBeInTheDocument());
  });

  it("offers an ADMIN the Generate seating action", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockResolvedValue(page(2, 0, [candidate("R1", "ALICE")]));
    renderCandidates(adminUser);

    await screen.findByText("ALICE");
    expect(screen.getByRole("button", { name: "Generate seating" })).toBeInTheDocument();
  });

  it("does not offer STAFF a Generate seating action", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockResolvedValue(page(2, 0, [candidate("R1", "ALICE")]));
    renderCandidates(staffUser);

    await screen.findByText("ALICE");
    expect(screen.queryByRole("button", { name: "Generate seating" })).not.toBeInTheDocument();
  });

  it("generating seating sends the backend document examId and navigates to the status view", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockResolvedValue(page(2, 0, [candidate("R1", "ALICE")]));
    mockedGenerateSeating.mockResolvedValue(created());
    renderCandidates(adminUser);

    const uploader = userEvent.setup();
    await uploader.click(await screen.findByRole("button", { name: "Generate seating" }));

    expect(await screen.findByText("generation-target")).toBeInTheDocument();
    expect(mockedGenerateSeating).toHaveBeenCalledWith("exam-1");
  });

  it("prevents duplicate generation submissions while a request is in flight", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockResolvedValue(page(2, 0, [candidate("R1", "ALICE")]));
    mockedGenerateSeating.mockReturnValue(new Promise(() => undefined));

    const uploader = userEvent.setup();
    renderCandidates(adminUser);
    const button = await screen.findByRole("button", { name: "Generate seating" });
    await uploader.click(button);
    await uploader.click(button);

    expect(mockedGenerateSeating).toHaveBeenCalledTimes(1);
  });

  it("surfaces a duplicate-generation 409 without navigating away", async () => {
    mockedGetDocument.mockResolvedValue(doc());
    mockedCandidates.mockResolvedValue(page(2, 0, [candidate("R1", "ALICE")]));
    mockedGenerateSeating.mockRejectedValue(
      new ApiError(409, "ERR_JOB_ALREADY_ACTIVE", "active generation already exists"),
    );
    renderCandidates(adminUser);

    const uploader = userEvent.setup();
    await uploader.click(await screen.findByRole("button", { name: "Generate seating" }));

    expect(
      await screen.findByText("A seating generation for this exam is already in progress."),
    ).toBeInTheDocument();
    expect(screen.getByText("ALICE")).toBeInTheDocument();
    expect(screen.queryByText("generation-target")).not.toBeInTheDocument();
  });
});