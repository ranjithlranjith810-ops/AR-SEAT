import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../lib/api";
import type { Candidate, Exam, ExamCandidatePage, ExamConflict } from "../lib/types";
import { ExamCandidatesPage } from "./ExamCandidatesPage";
import { adminUser, renderParamRoute } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    getExams: vi.fn(),
    getExamCandidates: vi.fn(),
    getExamConflicts: vi.fn(),
    listStudents: vi.fn(),
    addExamCandidate: vi.fn(),
    excludeExamCandidate: vi.fn(),
    reinstateExamCandidate: vi.fn(),
    cancelExam: vi.fn(),
  };
});

const {
  getExams,
  getExamCandidates,
  getExamConflicts,
  listStudents,
  addExamCandidate,
  excludeExamCandidate,
  reinstateExamCandidate,
  cancelExam,
} = await import("../lib/api");

const mockedGetExams = vi.mocked(getExams);
const mockedGetExamCandidates = vi.mocked(getExamCandidates);
const mockedGetExamConflicts = vi.mocked(getExamConflicts);
const mockedListStudents = vi.mocked(listStudents);
const mockedAddExamCandidate = vi.mocked(addExamCandidate);
const mockedExcludeExamCandidate = vi.mocked(excludeExamCandidate);
const mockedReinstateExamCandidate = vi.mocked(reinstateExamCandidate);
const mockedCancelExam = vi.mocked(cancelExam);

function exam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    examDate: "2026-05-20T09:30:00.000Z",
    session: "FN",
    examType: "UNIVERSITY",
    status: "DRAFT",
    createdAt: "2026-08-17T06:00:00.000Z",
    updatedAt: "2026-08-17T06:00:01.000Z",
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    registerNumberSnapshot: "REG-A-1",
    studentNameSnapshot: "Student A",
    departmentSnapshot: "CSE",
    genderSnapshot: "MALE",
    classSnapshot: "CSE-A",
    subjectCode: "CS8501",
    subjectName: "Theory of Computation",
    validationStatus: "MATCHED",
    ...overrides,
  };
}

function page(overrides: Partial<ExamCandidatePage> = {}): ExamCandidatePage {
  return {
    examId: "exam-1",
    total: 1,
    offset: 0,
    limit: 20,
    candidates: [candidate()],
    ...overrides,
  };
}

function render() {
  return renderParamRoute(
    <ExamCandidatesPage />,
    "/exams/:examId/candidates",
    adminUser,
    "/exams/exam-1/candidates",
  );
}

beforeEach(() => {
  mockedGetExams.mockReset();
  mockedGetExamCandidates.mockReset();
  mockedGetExamConflicts.mockReset();
  mockedListStudents.mockReset();
  mockedAddExamCandidate.mockReset();
  mockedExcludeExamCandidate.mockReset();
  mockedReinstateExamCandidate.mockReset();
  mockedCancelExam.mockReset();
});

describe("ExamCandidatesPage", () => {
  it("shows a loading state while exam and roster are fetched", () => {
    mockedGetExams.mockReturnValue(new Promise(() => undefined));
    mockedGetExamCandidates.mockReturnValue(new Promise(() => undefined));
    render();
    expect(screen.getByText("Loading exam candidates...")).toBeInTheDocument();
  });

  it("renders the exam summary and candidate roster", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    mockedGetExamCandidates.mockResolvedValue(page());
    render();

    expect(await screen.findByRole("heading", { name: "Exam candidates" })).toBeInTheDocument();
    expect(screen.getByText("UNIVERSITY")).toBeInTheDocument();
    expect(screen.getByText("DRAFT")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Exam candidate roster" });
    const row = within(table).getByRole("row", { name: /REG-A-1/ });
    expect(within(row).getByText("Student A")).toBeInTheDocument();
    expect(within(row).getByText("MATCHED")).toBeInTheDocument();
  });

  it("surfaces a safe error with a Retry action on load failure", async () => {
    mockedGetExams.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "Unable to reach the server"));
    mockedGetExamCandidates.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "Unable to reach the server"));
    render();

    expect(
      await screen.findByText("Unable to reach the server. Please try again."),
    ).toBeInTheDocument();
    const uploader = userEvent.setup();
    await uploader.click(screen.getByRole("button", { name: "Retry" }));

    expect(mockedGetExams).toHaveBeenCalledTimes(2);
  });

  it("checks conflicts and renders the conflict table", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    mockedGetExamCandidates.mockResolvedValue(page());
    const conflicts: ExamConflict[] = [
      {
        studentId: "student-1",
        registerNumber: "REG-A-1",
        studentName: "Student A",
        candidate: {
          candidateId: "cand-1",
          examId: "exam-1",
          status: "DRAFT",
          subjectCode: "CS8501",
          subjectName: "Theory of Computation",
          validationStatus: "VALIDATED",
        },
        conflictingExams: [
          {
            candidateId: "cand-9",
            examId: "exam-2",
            status: "DRAFT",
            subjectCode: "MA8551",
            subjectName: "Algebra",
            validationStatus: "MATCHED",
          },
        ],
      },
    ];
    mockedGetExamConflicts.mockResolvedValue({
      examId: "exam-1",
      examDate: "2026-05-20T09:30:00.000Z",
      session: "FN",
      conflicts,
    });
    render();

    await userEvent.click(
      await screen.findByRole("button", { name: "Check conflicts" }),
    );

    const conflictsTable = await screen.findByRole("table", { name: "Schedule conflicts" });
    expect(within(conflictsTable).getByText("exam-2 (MA8551, MATCHED)")).toBeInTheDocument();
    expect(within(conflictsTable).getByText("REG-A-1")).toBeInTheDocument();
    expect(mockedGetExamConflicts).toHaveBeenCalledWith("exam-1");
  });

  it("shows a success alert when no conflicts are detected", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    mockedGetExamCandidates.mockResolvedValue(page());
    mockedGetExamConflicts.mockResolvedValue({
      examId: "exam-1",
      examDate: "2026-05-20T09:30:00.000Z",
      session: "FN",
      conflicts: [],
    });
    render();

    await userEvent.click(await screen.findByRole("button", { name: "Check conflicts" }));

    expect(
      await screen.findByText("No schedule conflicts detected for this exam."),
    ).toBeInTheDocument();
  });

  it("searches the student master, selects a student, and adds a candidate", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    mockedGetExamCandidates.mockResolvedValue(page());
    mockedListStudents.mockResolvedValue({
      students: [
        {
          id: "student-2",
          name: "Student B",
          rollNumber: "R-B",
          registerNumber: "REG-B-1",
          gender: "FEMALE",
          status: "ACTIVE",
          classId: "class-1",
          createdAt: "",
          updatedAt: "",
          class: {
            id: "class-1",
            departmentId: "dept-1",
            name: "CSE-A",
            year: 1,
            section: "A",
            academicYear: "2026",
            department: { id: "dept-1", code: "CSE", name: "CSE" },
          },
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    mockedAddExamCandidate.mockResolvedValue(candidate({ id: "cand-new" }));
    render();

    const searchInput = await screen.findByLabelText("Search students");
    await userEvent.type(searchInput, "Student B");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await userEvent.selectOptions(await screen.findByLabelText("Student"), "student-2");
    await userEvent.type(screen.getByLabelText("Reason for adding (audit)"), "missing from PDF");
    await userEvent.click(screen.getByRole("button", { name: "Add candidate" }));

    expect(mockedAddExamCandidate).toHaveBeenCalledWith("exam-1", {
      studentId: "student-2",
      reason: "missing from PDF",
    });
  });

  it("excludes a candidate once an audit reason is typed", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    mockedGetExamCandidates.mockResolvedValue(page());
    mockedExcludeExamCandidate.mockResolvedValue(candidate({ validationStatus: "REJECTED" }));
    render();

    const input = await screen.findByLabelText("Exclusion reason for REG-A-1");
    await userEvent.type(input, "sitting a conflicting exam");

    const row = screen.getByRole("row", { name: /REG-A-1/ });
    await userEvent.click(within(row).getByRole("button", { name: "Exclude" }));

    expect(mockedExcludeExamCandidate).toHaveBeenCalledWith(
      "exam-1",
      "cand-1",
      "sitting a conflicting exam",
    );
  });

  it("disables exclude until a reason is provided", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    mockedGetExamCandidates.mockResolvedValue(page());
    render();

    const row = await screen.findByRole("row", { name: /REG-A-1/ });
    expect(within(row).getByRole("button", { name: "Exclude" })).toBeDisabled();
  });

  it("reinstates an excluded candidate", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    mockedGetExamCandidates.mockResolvedValue(
      page({ candidates: [candidate({ validationStatus: "REJECTED" })] }),
    );
    mockedReinstateExamCandidate.mockResolvedValue(candidate({ validationStatus: "MATCHED" }));
    render();

    const row = await screen.findByRole("row", { name: /REG-A-1/ });
    await userEvent.click(within(row).getByRole("button", { name: "Reinstate" }));

    expect(mockedReinstateExamCandidate).toHaveBeenCalledWith("exam-1", "cand-1");
  });

  it("cancels the exam with a reason and reflects the new status", async () => {
    mockedGetExams.mockResolvedValue([exam()]);
    mockedGetExamCandidates.mockResolvedValue(page());
    mockedCancelExam.mockResolvedValue(exam({ status: "CANCELLED" }));
    render();

    await userEvent.type(await screen.findByLabelText("Reason for cancellation (audit)"), "venue unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Cancel exam" }));

    expect(mockedCancelExam).toHaveBeenCalledWith("exam-1", "venue unavailable");
    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});