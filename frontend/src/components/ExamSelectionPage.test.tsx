import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../lib/api";
import type { Exam } from "../lib/types";
import { RequireAdmin } from "../auth/guards";
import { ExamSelectionPage } from "./ExamSelectionPage";
import { adminUser, renderRoutes, staffUser } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, getExams: vi.fn() };
});

const { getExams } = await import("../lib/api");
const mockedGetExams = vi.mocked(getExams);

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

function renderSelection(user = adminUser, initial = "/exams") {
  return renderRoutes(
    <Routes>
      <Route
        path="/exams"
        element={
          <RequireAdmin>
            <ExamSelectionPage />
          </RequireAdmin>
        }
      />
      <Route path="/upload" element={<div>upload-target</div>} />
    </Routes>,
    user,
    initial,
  );
}

beforeEach(() => {
  mockedGetExams.mockReset();
});

describe("ExamSelectionPage", () => {
  it("shows a loading state while exams are fetched", async () => {
    mockedGetExams.mockReturnValue(new Promise(() => undefined));
    renderSelection();
    expect(screen.getByText("Loading exams...")).toBeInTheDocument();
  });

  it("renders the backend exam list with exam context", async () => {
    mockedGetExams.mockResolvedValue([
      exam(),
      exam({ id: "exam-2", session: "AN", examType: "INTERNAL", status: "READY" }),
    ]);
    renderSelection();

    expect(await screen.findByText("MODEL")).toBeInTheDocument();
    expect(screen.getByText("INTERNAL")).toBeInTheDocument();
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
    expect(screen.getByText("READY")).toBeInTheDocument();
    expect(screen.getByText("AN")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Select" })).toHaveLength(2);
  });

  it("selecting an exam navigates to the upload step", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    renderSelection();

    const uploader = userEvent.setup();
    await uploader.click(await screen.findByRole("button", { name: "Select" }));

    expect(await screen.findByText("upload-target")).toBeInTheDocument();
  });

  it("shows an empty state when no exams exist", async () => {
    mockedGetExams.mockResolvedValue([]);
    renderSelection();
    expect(await screen.findByText("No exams found.")).toBeInTheDocument();
  });

  it("surfaces a safe error with a Retry action", async () => {
    mockedGetExams
      .mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "Unable to reach the server"))
      .mockResolvedValueOnce([exam()]);
    renderSelection();

    expect(await screen.findByText("Unable to reach the server. Please try again.")).toBeInTheDocument();

    const uploader = userEvent.setup();
    await uploader.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("MODEL")).toBeInTheDocument();
    expect(mockedGetExams).toHaveBeenCalledTimes(2);
  });

  it("blocks STAFF from the exam selection screen (route protection)", async () => {
    renderSelection(staffUser);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(mockedGetExams).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});