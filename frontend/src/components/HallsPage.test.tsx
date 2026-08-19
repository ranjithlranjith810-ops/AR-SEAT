import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../lib/api";
import type { Hall, HallBench, HallSeat } from "../lib/types";
import { HallsPage } from "./HallsPage";
import { renderWithAuth } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    listHalls: vi.fn(),
    createHall: vi.fn(),
    updateHall: vi.fn(),
    createBench: vi.fn(),
    setBenchActive: vi.fn(),
    assignSeatToBench: vi.fn(),
    removeSeatFromBench: vi.fn(),
  };
});

const {
  listHalls,
  createHall,
  updateHall,
  createBench,
  setBenchActive,
  assignSeatToBench,
  removeSeatFromBench,
} = await import("../lib/api");

const mockedListHalls = vi.mocked(listHalls);
const mockedCreateHall = vi.mocked(createHall);
const mockedUpdateHall = vi.mocked(updateHall);
const mockedCreateBench = vi.mocked(createBench);
const mockedSetBenchActive = vi.mocked(setBenchActive);
const mockedAssignSeatToBench = vi.mocked(assignSeatToBench);
const mockedRemoveSeatFromBench = vi.mocked(removeSeatFromBench);

function seat(
  id: string,
  position: string,
  row: string,
  column: number,
  benchId: string | null = null,
  isActive = true,
): HallSeat {
  return { id, hallId: "hall-1", benchId, seatPosition: position, row, column, isActive };
}

function bench(id: string, number: string, seats: HallSeat[], isActive = true): HallBench {
  return {
    id,
    hallId: "hall-1",
    benchNumber: number,
    isActive,
    createdAt: "",
    updatedAt: "",
    capacity: seats.filter((s) => s.isActive).length,
    seats,
  };
}

function hall(): Hall {
  const a1 = seat("s1", "A1", "A", 1, "b1");
  const a2 = seat("s2", "A2", "A", 2, "b1");
  const b1 = seat("s3", "B1", "B", 1, "b2");
  const unassigned = seat("s4", "C1", "C", 1, null);
  return {
    id: "hall-1",
    hallNumber: "LH09",
    name: "Lecture Hall 09",
    building: "Main Block",
    rows: 3,
    columns: 2,
    isActive: true,
    createdAt: "",
    updatedAt: "",
    totalSeatCount: 4,
    activeSeatCount: 4,
    unassignedSeats: [unassigned],
    benches: [bench("b1", "A", [a1, a2]), bench("b2", "B", [b1])],
  };
}

function renderHalls() {
  return renderWithAuth(<HallsPage />, { id: "admin-1", username: "admin", role: "ADMIN" });
}

beforeEach(() => {
  mockedListHalls.mockReset();
  mockedCreateHall.mockReset();
  mockedUpdateHall.mockReset();
  mockedCreateBench.mockReset();
  mockedSetBenchActive.mockReset();
  mockedAssignSeatToBench.mockReset();
  mockedRemoveSeatFromBench.mockReset();
});

describe("HallsPage", () => {
  it("shows a loading state while halls are fetched", () => {
    mockedListHalls.mockReturnValue(new Promise(() => undefined));
    renderHalls();
    expect(screen.getByText("Loading halls...")).toBeInTheDocument();
  });

  it("renders halls with benches and live derived capacities", async () => {
    mockedListHalls.mockResolvedValue([hall()]);
    renderHalls();

    expect(await screen.findByRole("heading", { name: "LH09 — Lecture Hall 09" })).toBeInTheDocument();
    const tables = screen.getAllByRole("table");
    expect(tables.length).toBe(1);
    const table = tables[0]!;
    expect(within(table).getByText("A")).toBeInTheDocument();
    expect(within(table).getByText("B")).toBeInTheDocument();
    expect(within(table).getAllByText("2").length).toBeGreaterThan(0);
    expect(within(table).getByText("1")).toBeInTheDocument();
    expect(within(table).getByText("A1, A2")).toBeInTheDocument();
    expect(within(table).getByText("B1")).toBeInTheDocument();
  });

  it("shows an empty state when no halls exist", async () => {
    mockedListHalls.mockResolvedValue([]);
    renderHalls();
    expect(
      await screen.findByText("No halls exist yet. Add a hall to begin managing benches."),
    ).toBeInTheDocument();
  });

  it("surfaces a safe error with a Retry action", async () => {
    mockedListHalls
      .mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "Unable to reach the server"))
      .mockResolvedValueOnce([hall()]);
    renderHalls();

    expect(await screen.findByText("Unable to reach the server. Please try again.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("heading", { name: "LH09 — Lecture Hall 09" }),
    ).toBeInTheDocument();
    expect(mockedListHalls).toHaveBeenCalledTimes(2);
  });

  it("creates a hall through the form and refreshes the list", async () => {
    mockedListHalls.mockResolvedValue([]);
    mockedCreateHall.mockResolvedValue(hall());
    renderHalls();
    await screen.findByText("No halls exist yet. Add a hall to begin managing benches.");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add hall" }));
    await user.type(screen.getByLabelText("Hall number"), "LH20");
    await user.type(screen.getByLabelText("Name"), "Lecture Hall 20");
    await user.type(screen.getByLabelText("Building"), "West Block");
    const rows = screen.getByLabelText("Rows");
    await user.clear(rows);
    await user.type(rows, "4");
    const columns = screen.getByLabelText("Columns");
    await user.clear(columns);
    await user.type(columns, "3");
    await user.click(screen.getByRole("button", { name: "Create hall" }));

    expect(mockedCreateHall).toHaveBeenCalledWith({
      hallNumber: "LH20",
      name: "Lecture Hall 20",
      building: "West Block",
      rows: 4,
      columns: 3,
    });
    expect(await screen.findByText("Hall LH20 created")).toBeInTheDocument();
    expect(mockedListHalls).toHaveBeenCalledTimes(2);
  });

  it("validates hall creation client-side", async () => {
    mockedListHalls.mockResolvedValue([]);
    renderHalls();
    await screen.findByText("No halls exist yet. Add a hall to begin managing benches.");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add hall" }));
    await user.click(screen.getByRole("button", { name: "Create hall" }));

    expect(screen.getByText("Hall number and name are required.")).toBeInTheDocument();
    expect(mockedCreateHall).not.toHaveBeenCalled();
  });

  it("creates a bench for a hall and refreshes", async () => {
    mockedListHalls.mockResolvedValue([hall()]);
    mockedCreateBench.mockResolvedValue(bench("b3", "C", []));
    renderHalls();
    await screen.findByRole("heading", { name: "LH09 — Lecture Hall 09" });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New bench"), "C");
    await user.click(screen.getByRole("button", { name: "Add bench" }));

    expect(mockedCreateBench).toHaveBeenCalledWith("hall-1", { benchNumber: "C" });
    expect(await screen.findByText("Bench C added to LH09")).toBeInTheDocument();
    expect(mockedListHalls).toHaveBeenCalledTimes(2);
  });

  it("decommissions a bench through the row action and refreshes capacity", async () => {
    const active = hall();
    const decommissioned = hall();
    decommissioned.benches[0]!.isActive = false;
    decommissioned.benches[0]!.seats = decommissioned.benches[0]!.seats.map((s) => ({
      ...s,
      isActive: false,
    }));
    decommissioned.benches[0]!.capacity = 0;
    decommissioned.activeSeatCount = 2;
    mockedListHalls.mockResolvedValueOnce([active]).mockResolvedValueOnce([decommissioned]);
    mockedSetBenchActive.mockResolvedValue(decommissioned.benches[0]!);
    renderHalls();
    await screen.findByRole("heading", { name: "LH09 — Lecture Hall 09" });

    const table = screen.getAllByRole("table")[0]!;
    const user = userEvent.setup();
    await user.click(within(table).getAllByRole("button", { name: "Deactivate" })[0]!);

    expect(mockedSetBenchActive).toHaveBeenCalledWith("b1", false);
    expect(await screen.findByText("Bench A in LH09 deactivated")).toBeInTheDocument();
    expect(mockedListHalls).toHaveBeenCalledTimes(2);
  });

  it("assigns an unassigned seat to a bench", async () => {
    mockedListHalls.mockResolvedValue([hall()]);
    mockedAssignSeatToBench.mockResolvedValue(seat("s4", "C1", "C", 1, "b1"));
    renderHalls();
    await screen.findByRole("heading", { name: "LH09 — Lecture Hall 09" });

    const selectA = screen.getByLabelText("Seat to assign to bench A");
    const actions = selectA.closest(".form-actions");
    expect(actions).not.toBeNull();
    const user = userEvent.setup();
    await user.selectOptions(selectA, "s4");
    await user.click(
      within(actions as HTMLElement).getByRole("button", { name: "Assign seat" }),
    );

    expect(mockedAssignSeatToBench).toHaveBeenCalledWith("b1", "s4");
    expect(await screen.findByText("Seat added to bench A")).toBeInTheDocument();
    expect(mockedListHalls).toHaveBeenCalledTimes(2);
  });

  it("removes a seat from a bench", async () => {
    mockedListHalls.mockResolvedValue([hall()]);
    mockedRemoveSeatFromBench.mockResolvedValue(seat("s1", "A1", "A", 1, null));
    renderHalls();
    await screen.findByRole("heading", { name: "LH09 — Lecture Hall 09" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove A1 from bench A" }));

    expect(mockedRemoveSeatFromBench).toHaveBeenCalledWith("b1", "s1");
    expect(await screen.findByText("Seat A1 removed from bench A")).toBeInTheDocument();
    expect(mockedListHalls).toHaveBeenCalledTimes(2);
  });

  it("surfaces a cross-hall assignment rejection from the backend", async () => {
    mockedListHalls.mockResolvedValue([hall()]);
    mockedAssignSeatToBench.mockRejectedValue(
      new ApiError(400, "BENCH_SEAT_HALL_MISMATCH", "HallSeat does not belong to the same hall"),
    );
    renderHalls();
    await screen.findByRole("heading", { name: "LH09 — Lecture Hall 09" });

    const selectA = screen.getByLabelText("Seat to assign to bench A");
    const actions = selectA.closest(".form-actions");
    const user = userEvent.setup();
    await user.selectOptions(selectA, "s4");
    await user.click(
      within(actions as HTMLElement).getByRole("button", { name: "Assign seat" }),
    );

    expect(
      await screen.findByText("Seats can only be assigned to benches in the same hall."),
    ).toBeInTheDocument();
  });

  it("toggles hall active state through the heading action", async () => {
    const active = hall();
    const inactive = { ...hall(), isActive: false };
    mockedListHalls.mockResolvedValueOnce([active]).mockResolvedValueOnce([inactive]);
    mockedUpdateHall.mockResolvedValue(inactive);
    renderHalls();
    const heading = await screen.findByRole("heading", { name: "LH09 — Lecture Hall 09" });
    const hallHeader = heading.closest(".hall-heading");
    expect(hallHeader).not.toBeNull();
    const user = userEvent.setup();
    await user.click(
      within(hallHeader as HTMLElement).getByRole("button", { name: "Deactivate" }),
    );

    expect(mockedUpdateHall).toHaveBeenCalledWith("hall-1", { isActive: false });
    expect(await screen.findByText("LH09 deactivated")).toBeInTheDocument();
    expect(mockedListHalls).toHaveBeenCalledTimes(2);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});