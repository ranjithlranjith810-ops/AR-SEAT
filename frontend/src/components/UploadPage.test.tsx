import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../lib/api";
import type { Exam, IngestReport } from "../lib/types";
import { RequireAdmin } from "../auth/guards";
import { UploadPage } from "./UploadPage";
import { adminUser, noopAuth, renderWithAuth, staffUser } from "../test/harness";
import { AuthContext } from "../auth/AuthContext";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, uploadDocument: vi.fn() };
});

const { uploadDocument } = await import("../lib/api");
const mockedUpload = vi.mocked(uploadDocument);

function parsedReport(overrides: Partial<IngestReport> = {}): IngestReport {
  return {
    documentId: "doc-1",
    finalParseStatus: "PARSED",
    counts: { extractedRows: 3, normalized: 3, validated: 3, matched: 3, rejected: 0 },
    issuesByCode: {},
    candidatesPersisted: 3,
    header: {},
    warnings: [],
    duplicate: false,
    fileName: "list.pdf",
    ...overrides,
  };
}

function exam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    examDate: "2026-12-03T09:30:00.000Z",
    session: "FN",
    examType: "MODEL",
    status: "DRAFT",
    createdAt: "2026-08-17T06:00:00.000Z",
    updatedAt: "2026-08-17T06:00:01.000Z",
    ...overrides,
  };
}

function renderWithExamSelection() {
  return render(
    <AuthContext.Provider value={{ ...noopAuth, user: adminUser }}>
      <MemoryRouter
        initialEntries={[{ pathname: "/upload", state: { examId: "exam-1", exam: exam() } }]}
      >
        <UploadPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function pdfFile(name = "list.pdf"): File {
  return new File([PDF_BYTES], name, { type: "application/pdf" });
}

async function fillAndSubmit(uploader: ReturnType<typeof userEvent.setup>) {
  await uploader.type(screen.getByLabelText("Exam ID"), "exam-1");
  await uploader.upload(screen.getByLabelText("PDF file"), pdfFile());
  await uploader.click(screen.getByRole("button", { name: "Upload document" }));
}

beforeEach(() => {
  mockedUpload.mockReset();
});

describe("UploadPage", () => {
  it("is reachable for ADMIN and shows the upload form", () => {
    renderWithAuth(<UploadPage />, adminUser);
    expect(screen.getByRole("heading", { name: "Upload a document" })).toBeInTheDocument();
    expect(screen.getByLabelText("Exam ID")).toBeInTheDocument();
    expect(screen.getByLabelText("PDF file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument();
  });

  it("is inaccessible to STAFF through the ADMIN-only surface", () => {
    renderWithAuth(
      <RequireAdmin>
        <UploadPage />
      </RequireAdmin>,
      staffUser,
    );
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Upload a document" })).not.toBeInTheDocument();
  });

it("shows the selected filename and size, then the ready-to-upload state", async () => {
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    expect(screen.getByText("No document selected")).toBeInTheDocument();
    await uploader.upload(screen.getByLabelText("PDF file"), pdfFile("candidate-list.pdf"));
    expect(screen.getByText(/candidate-list\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/Ready to upload/)).toBeInTheDocument();
  });

  it("prefills a backend-selected exam and shows its context", () => {
    renderWithExamSelection();
    expect(screen.getByRole("heading", { name: "Selected exam" })).toBeInTheDocument();
    expect(screen.getByText("exam-1")).toBeInTheDocument();
    expect(screen.getByText("FN")).toBeInTheDocument();
    expect(screen.getByText("MODEL")).toBeInTheDocument();
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
    expect(screen.getByLabelText("Exam ID")).toBeDisabled();
    expect(screen.getByRole("link", { name: "Change exam" })).toHaveAttribute("href", "/exams");
  });

  it("submits the preselected exam ID without manual entry", async () => {
    mockedUpload.mockResolvedValue(parsedReport());
    renderWithExamSelection();

    const uploader = userEvent.setup();
    await uploader.upload(screen.getByLabelText("PDF file"), pdfFile());
    await uploader.click(screen.getByRole("button", { name: "Upload document" }));

    await waitFor(() => {
      expect(mockedUpload).toHaveBeenCalledTimes(1);
    });
    expect(mockedUpload.mock.calls[0]![0]).toBe("exam-1");
    expect(await screen.findByText(/Processing complete/)).toBeInTheDocument();
  });

  it("submits to the Phase 9 endpoint with the exam ID and file and surfaces the document ID", async () => {
    mockedUpload.mockResolvedValue(parsedReport());
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await fillAndSubmit(uploader);

    await waitFor(() => {
      expect(mockedUpload).toHaveBeenCalledTimes(1);
    });
    const [examId, file] = mockedUpload.mock.calls[0]!;
    expect(examId).toBe("exam-1");
    expect(file.name).toBe("list.pdf");
    expect(file.data).toBeInstanceOf(Uint8Array);

    expect(await screen.findByText(/Processing complete/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View candidates" })).toBeInTheDocument();
  });

  it("does not call the API when the exam ID is missing (client-side UX validation)", async () => {
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await uploader.upload(screen.getByLabelText("PDF file"), pdfFile());
    await uploader.click(screen.getByRole("button", { name: "Upload document" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the exam ID for this document.");
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("does not call the API for a non-PDF file (client-side UX validation)", async () => {
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await uploader.type(screen.getByLabelText("Exam ID"), "exam-1");
    await uploader.upload(screen.getByLabelText("PDF file"), new File(["txt"], "notes.txt", { type: "text/plain" }));
    await uploader.click(screen.getByRole("button", { name: "Upload document" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Select a PDF file to upload.");
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("surfaces a safe message when the exam does not exist", async () => {
    mockedUpload.mockRejectedValue(new ApiError(404, "EXAM_NOT_FOUND", "Exam not found"));
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await fillAndSubmit(uploader);
    expect(await screen.findByText("Exam not found. Check the exam ID.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("surfaces a generic safe message for unexpected failures", async () => {
    mockedUpload.mockRejectedValue(new Error("internal Prisma stack detail"));
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await fillAndSubmit(uploader);
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/Prisma/)).not.toBeInTheDocument();
  });

  it("prevents duplicate submission while a request is in flight", async () => {
    let resolveUpload: (r: IngestReport) => void = () => undefined;
    mockedUpload.mockReturnValue(new Promise((resolve) => (resolveUpload = resolve)));

    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await fillAndSubmit(uploader);

    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Uploading..." })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Uploading..." }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedUpload).toHaveBeenCalledTimes(1);

    await waitFor(() => resolveUpload(parsedReport()));
    expect(await screen.findByText(/Processing complete/)).toBeInTheDocument();
  });

  it("shows a partial-processing state for NEEDS_REVIEW with the unresolved count", async () => {
    mockedUpload.mockResolvedValue(
      parsedReport({
        finalParseStatus: "NEEDS_REVIEW",
        counts: { extractedRows: 5, normalized: 5, validated: 3, matched: 3, rejected: 2 },
        candidatesPersisted: 3,
      }),
    );
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await fillAndSubmit(uploader);

    expect(await screen.findByText(/partially processed/)).toBeInTheDocument();
    expect(screen.getByText(/2 rows could not be resolved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View candidates" })).toBeInTheDocument();
  });

  it("surfaces a rejected outcome without claiming success", async () => {
    mockedUpload.mockResolvedValue(
      parsedReport({
        finalParseStatus: "REJECTED",
        counts: { extractedRows: 3, normalized: 3, validated: 0, matched: 0, rejected: 3 },
        candidatesPersisted: 0,
      }),
    );
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await fillAndSubmit(uploader);
    expect(await screen.findByText(/No rows from this document could be validated/)).toBeInTheDocument();
    expect(screen.queryByText("Processing complete")).not.toBeInTheDocument();
  });

  it("informs the user when the uploaded document is a duplicate", async () => {
    mockedUpload.mockResolvedValue(
      parsedReport({ duplicate: true, documentId: "doc-1", existingDocumentId: "doc-1" }),
    );
    const uploader = userEvent.setup();
    renderWithAuth(<UploadPage />, adminUser);
    await fillAndSubmit(uploader);
    expect(await screen.findByText(/already uploaded for this exam/)).toBeInTheDocument();
  });
});
