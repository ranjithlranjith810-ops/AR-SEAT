import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../lib/api";
import type { SeatingPlan } from "../lib/types";
import { SeatingPage } from "./SeatingPage";
import { renderParamRoute } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, getSeatingPlan: vi.fn() };
});

const { getSeatingPlan } = await import("../lib/api");
const mockedGetSeatingPlan = vi.mocked(getSeatingPlan);

function plan(overrides: Partial<SeatingPlan> = {}): SeatingPlan {
  return {
    id: "plan-1",
    examId: "exam-1",
    version: 1,
    status: "DRAFT",
    createdAt: "2026-08-17T06:00:00.000Z",
    updatedAt: "2026-08-17T06:00:01.000Z",
    assignments: [
      {
        id: "a1",
        examCandidate: {
          id: "c1",
          registerNumberSnapshot: "REG-1",
          studentNameSnapshot: "ALICE",
          departmentSnapshot: "CSE",
          classSnapshot: "CSE-A",
          subjectCode: "CS501",
        },
        hall: { id: "h1", hallNumber: "LH01", rows: 1, columns: 1 },
        hallSeat: { id: "s1", seatPosition: "A1", row: "A", column: 1 },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mockedGetSeatingPlan.mockReset();
});

describe("SeatingPage", () => {
  it("shows a loading state while the plan is fetched", async () => {
    let resolvePlan: (p: SeatingPlan) => void = () => undefined;
    mockedGetSeatingPlan.mockReturnValue(new Promise((resolve) => (resolvePlan = resolve)));

    renderParamRoute(<SeatingPage />, "/seating/:seatingPlanId", null, "/seating/plan-1");
    expect(screen.getByText("Loading seating plan...")).toBeInTheDocument();

    resolvePlan(plan());
    expect(await screen.findByText("Seating plan")).toBeInTheDocument();
  });

  it("requests the plan by ID from the URL", async () => {
    mockedGetSeatingPlan.mockResolvedValue(plan());
    renderParamRoute(<SeatingPage />, "/seating/:seatingPlanId", null, "/seating/plan-1");
    await screen.findByRole("heading", { level: 2, name: /LH01/ });
    expect(mockedGetSeatingPlan).toHaveBeenCalledWith("plan-1");
  });

  it("renders the backend plan fields and assignments grouped by hall", async () => {
    mockedGetSeatingPlan.mockResolvedValue(
      plan({
        assignments: [
          plan().assignments[0]!,
          {
            id: "a2",
            examCandidate: {
              id: "c2",
              registerNumberSnapshot: "REG-2",
              studentNameSnapshot: "BOB",
              departmentSnapshot: "ECE",
              classSnapshot: "ECE-A",
              subjectCode: "EC501",
            },
            hall: { id: "h2", hallNumber: "LH02", rows: 1, columns: 1 },
            hallSeat: { id: "s2", seatPosition: "A1", row: "A", column: 1 },
          },
        ],
      }),
    );
    renderParamRoute(<SeatingPage />, "/seating/:seatingPlanId", null, "/seating/plan-1");

    expect(await screen.findByText("plan-1")).toBeInTheDocument();
    expect(screen.getByText("exam-1")).toBeInTheDocument();
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
    expect(screen.getByText("Hall LH01")).toBeInTheDocument();
    expect(screen.getByText("Hall LH02")).toBeInTheDocument();
    expect(screen.getByText("REG-1")).toBeInTheDocument();
    expect(screen.getByText("ALICE")).toBeInTheDocument();
    expect(screen.getByText("REG-2")).toBeInTheDocument();
    expect(screen.getByText("BOB")).toBeInTheDocument();
    expect(screen.getAllByText("A1")).toHaveLength(2);
  });

  it("shows an empty state when the plan has no assignments", async () => {
    mockedGetSeatingPlan.mockResolvedValue(plan({ assignments: [] }));
    renderParamRoute(<SeatingPage />, "/seating/:seatingPlanId", null, "/seating/plan-1");

    expect(await screen.findByText("No seat assignments in this plan.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a safe error and Retry when the plan is missing", async () => {
    mockedGetSeatingPlan
      .mockRejectedValueOnce(new ApiError(404, "PLAN_NOT_FOUND", "not found"))
      .mockResolvedValueOnce(plan());
    renderParamRoute(<SeatingPage />, "/seating/:seatingPlanId", null, "/seating/plan-1");

    expect(await screen.findByText("Seating plan not found.")).toBeInTheDocument();

    const uploader = userEvent.setup();
    await uploader.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { level: 2, name: /LH01/ })).toBeInTheDocument();
    expect(mockedGetSeatingPlan).toHaveBeenCalledTimes(2);
  });

  it("never renders internal error details", async () => {
    mockedGetSeatingPlan.mockRejectedValue(
      new Error("PrismaClientKnownRequestError at D:\\secrets\\schema.prisma"),
    );
    renderParamRoute(<SeatingPage />, "/seating/:seatingPlanId", null, "/seating/plan-1");

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    const bodyText = document.body.textContent ?? "";
    for (const marker of ["Prisma", "schema.prisma", "D:\\", "stack", "SQL"]) {
      expect(bodyText).not.toContain(marker);
    }
  });
});