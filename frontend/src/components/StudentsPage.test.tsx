import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../lib/api";
import type { ClassItem, Department, Student } from "../lib/types";
import { RequireAuth } from "../auth/guards";
import { StudentsPage } from "./StudentsPage";
import { renderRoutes } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    listStudents: vi.fn(),
    listDepartments: vi.fn(),
    listClasses: vi.fn(),
    createStudent: vi.fn(),
    updateStudent: vi.fn(),
    changeStudentStatus: vi.fn(),
  };
});

const {
  listStudents,
  listDepartments,
  listClasses,
  createStudent,
  updateStudent,
  changeStudentStatus,
} = await import("../lib/api");

const mockedListStudents = vi.mocked(listStudents);
const mockedListDepartments = vi.mocked(listDepartments);
const mockedListClasses = vi.mocked(listClasses);
const mockedCreateStudent = vi.mocked(createStudent);
const mockedUpdateStudent = vi.mocked(updateStudent);
const mockedChangeStudentStatus = vi.mocked(changeStudentStatus);

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-1",
    name: "RAMYA S",
    rollNumber: "CSE333",
    registerNumber: "SNT-001",
    gender: "FEMALE",
    status: "ACTIVE",
    classId: "cls-1",
    createdAt: "2026-08-17T06:00:00.000Z",
    updatedAt: "2026-08-17T06:00:01.000Z",
    class: {
      id: "cls-1",
      departmentId: "dept-1",
      name: "CSE-A",
      year: 3,
      section: "A",
      academicYear: "2025-2026",
      department: { id: "dept-1", code: "CSE", name: "Computer Science and Engineering" },
    },
    ...overrides,
  };
}

const departments: Department[] = [
  { id: "dept-1", code: "CSE", name: "Computer Science and Engineering", createdAt: "", updatedAt: "" },
  { id: "dept-2", code: "ECE", name: "Electronics and Communication Engineering", createdAt: "", updatedAt: "" },
];

const classes: ClassItem[] = [
  {
    id: "cls-1",
    departmentId: "dept-1",
    name: "CSE-A",
    year: 3,
    section: "A",
    academicYear: "2025-2026",
    department: departments[0]!,
  },
  {
    id: "cls-2",
    departmentId: "dept-2",
    name: "ECE-A",
    year: 3,
    section: "A",
    academicYear: "2025-2026",
    department: departments[1]!,
  },
];

function page(rows: Student[], total: number, offset = 0) {
  return { students: rows, total, limit: 20, offset };
}

function renderStudents() {
  return renderRoutes(
    <Routes>
      <Route
        path="/students"
        element={
          <RequireAuth>
            <StudentsPage />
          </RequireAuth>
        }
      />
    </Routes>,
    { id: "admin-1", username: "admin", role: "ADMIN" },
    "/students",
  );
}

function studentForm(): HTMLElement {
  const form = screen.getByRole("form", { name: "Student form" });
  return form;
}

beforeEach(() => {
  mockedListStudents.mockReset();
  mockedListDepartments.mockReset();
  mockedListClasses.mockReset();
  mockedCreateStudent.mockReset();
  mockedUpdateStudent.mockReset();
  mockedChangeStudentStatus.mockReset();
  mockedListDepartments.mockResolvedValue(departments);
  mockedListClasses.mockResolvedValue(classes);
});

describe("StudentsPage", () => {
  it("shows a loading state while students are fetched", async () => {
    mockedListStudents.mockReturnValue(new Promise(() => undefined));
    renderStudents();
    expect(screen.getByText("Loading students...")).toBeInTheDocument();
  });

  it("renders student rows with department, class, gender and status", async () => {
    mockedListStudents.mockResolvedValue(page([student()], 1));
    renderStudents();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("RAMYA S")).toBeInTheDocument();
    expect(within(table).getByText("SNT-001")).toBeInTheDocument();
    expect(within(table).getByText("CSE333")).toBeInTheDocument();
    expect(within(table).getByText("CSE")).toBeInTheDocument();
    expect(within(table).getByText("CSE-A (2025-2026)")).toBeInTheDocument();
    expect(within(table).getByText("FEMALE")).toBeInTheDocument();
    expect(
      within(table).getAllByText("ACTIVE").some((el) => el.closest(".status-badge")),
    ).toBe(true);
  });

  it("shows the pagination summary and paging controls", async () => {
    const twentyFive = Array.from({ length: 25 }, (_, i) =>
      student({ id: `stu-${i}`, registerNumber: `SNT-${i}`, rollNumber: `R-${i}` }),
    );
    mockedListStudents
      .mockResolvedValueOnce(page(twentyFive.slice(0, 20), 25))
      .mockResolvedValueOnce(page(twentyFive.slice(20), 25, 20));
    renderStudents();

    expect(await screen.findByText("Showing 1–20 of 25")).toBeInTheDocument();

    const user = userEvent.setup();
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(next);

    expect(await screen.findByText("Showing 21–25 of 25")).toBeInTheDocument();
    expect(mockedListStudents).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 20 }),
    );
    const prev = screen.getByRole("button", { name: "Previous" });
    expect(prev).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows an empty state when nothing matches", async () => {
    mockedListStudents.mockResolvedValue(page([], 0));
    renderStudents();
    expect(await screen.findByText("No students match the current filters.")).toBeInTheDocument();
    expect(screen.getByText("Showing 0–0 of 0")).toBeInTheDocument();
  });

  it("applies search and filter parameters and resets them", async () => {
    mockedListStudents
      .mockResolvedValue(page([], 0))
      .mockResolvedValue(page([], 0))
      .mockResolvedValue(page([], 0));
    renderStudents();
    await screen.findByText("No students match the current filters.");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search"), "ram");
    await user.selectOptions(screen.getByLabelText("Department"), "dept-2");
    await user.selectOptions(screen.getByLabelText("Status"), "INACTIVE");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(mockedListStudents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "ram",
        departmentId: "dept-2",
        status: "INACTIVE",
        offset: 0,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(mockedListStudents).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, departmentId: undefined, status: undefined }),
    );
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("surfaces a safe error with a Retry action", async () => {
    mockedListStudents
      .mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "Unable to reach the server"))
      .mockResolvedValueOnce(page([student()], 1));
    renderStudents();

    expect(await screen.findByText("Unable to reach the server. Please try again.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(within(await screen.findByRole("table")).getByText("RAMYA S")).toBeInTheDocument();
    expect(mockedListStudents).toHaveBeenCalledTimes(2);
  });

  it("creates a student through the form and refreshes the list", async () => {
    mockedListStudents.mockResolvedValue(page([], 0));
    const created = student({ id: "stu-new", registerNumber: "SNT-099", name: "NEW STUDENT" });
    mockedCreateStudent.mockResolvedValue(created);
    renderStudents();
    await screen.findByText("No students match the current filters.");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const form = studentForm();
    await user.type(within(form).getByLabelText("Name"), "NEW STUDENT");
    await user.type(within(form).getByLabelText("Register number"), "SNT-099");
    await user.type(within(form).getByLabelText("Roll number"), "R-99");
    await user.selectOptions(within(form).getByLabelText("Gender"), "MALE");
    await user.selectOptions(within(form).getByLabelText("Department"), "dept-1");
    await user.selectOptions(within(form).getByLabelText("Class"), "cls-1");
    await user.selectOptions(within(form).getByLabelText("Status"), "ACTIVE");
    await user.click(within(form).getByRole("button", { name: "Create student" }));

    expect(mockedCreateStudent).toHaveBeenCalledWith({
      name: "NEW STUDENT",
      registerNumber: "SNT-099",
      rollNumber: "R-99",
      gender: "MALE",
      classId: "cls-1",
      status: "ACTIVE",
    });
    expect(await screen.findByText("SNT-099 saved")).toBeInTheDocument();
    expect(mockedListStudents).toHaveBeenCalledTimes(2);
  });

  it("shows client-side validation when required fields are empty", async () => {
    mockedListStudents.mockResolvedValue(page([], 0));
    renderStudents();
    await screen.findByText("No students match the current filters.");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    await user.click(within(studentForm()).getByRole("button", { name: "Create student" }));

    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    expect(mockedCreateStudent).not.toHaveBeenCalled();
  });

  it("surfaces a duplicate register number from the backend", async () => {
    mockedListStudents.mockResolvedValue(page([], 0));
    mockedCreateStudent.mockRejectedValue(
      new ApiError(409, "STUDENT_ALREADY_EXISTS", "Student register number already exists"),
    );
    renderStudents();
    await screen.findByText("No students match the current filters.");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add student" }));
    const form = studentForm();
    await user.type(within(form).getByLabelText("Name"), "DUP");
    await user.type(within(form).getByLabelText("Register number"), "SNT-001");
    await user.type(within(form).getByLabelText("Roll number"), "R-1");
    await user.selectOptions(within(form).getByLabelText("Department"), "dept-1");
    await user.selectOptions(within(form).getByLabelText("Class"), "cls-1");
    await user.click(within(form).getByRole("button", { name: "Create student" }));

    expect(
      await screen.findByText("That register number already exists. Student records must be unique."),
    ).toBeInTheDocument();
  });

  it("edits a student through the form", async () => {
    const existing = student();
    mockedListStudents.mockResolvedValue(page([existing], 1));
    const updated = { ...existing, name: "UPDATED NAME" };
    mockedUpdateStudent.mockResolvedValue(updated);
    renderStudents();
    await screen.findByRole("table");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const form = studentForm();
    const nameInput = within(form).getByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "UPDATED NAME");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    expect(mockedUpdateStudent).toHaveBeenCalledWith("stu-1", {
      name: "UPDATED NAME",
      registerNumber: "SNT-001",
      rollNumber: "CSE333",
      gender: "FEMALE",
      classId: "cls-1",
      status: "ACTIVE",
    });
    expect(await screen.findByText("SNT-001 saved")).toBeInTheDocument();
  });

  it("changes a student status through the row status control", async () => {
    const existing = student();
    mockedListStudents.mockResolvedValue(page([existing], 1));
    const updated = { ...existing, status: "INACTIVE" as const };
    mockedChangeStudentStatus.mockResolvedValue(updated);
    renderStudents();
    await screen.findByRole("table");

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Status for SNT-001"),
      "INACTIVE",
    );

    expect(mockedChangeStudentStatus).toHaveBeenCalledWith("stu-1", "INACTIVE");
    expect(await screen.findByText("SNT-001 → INACTIVE")).toBeInTheDocument();
  });

  it("shows the status options loaded from real backend values", async () => {
    mockedListStudents.mockResolvedValue(page([student()], 1));
    renderStudents();
    await screen.findByRole("table");

    const statusSelect = screen.getByLabelText("Status for SNT-001");
    const options = within(statusSelect)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(["ACTIVE", "INACTIVE", "PASSED_OUT", "TRANSFERRED"]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});