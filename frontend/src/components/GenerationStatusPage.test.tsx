import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { ApiError } from "../lib/api";
import type { GenerationStatus } from "../lib/types";
import { GenerationStatusPage } from "./GenerationStatusPage";
import { renderParamRoute } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, getGenerationStatus: vi.fn() };
});

const { getGenerationStatus } = await import("../lib/api");
const mockedGetStatus = vi.mocked(getGenerationStatus);

function status(overrides: Partial<GenerationStatus> = {}): GenerationStatus {
  return {
    generationId: "gen-1",
    state: "COMPLETED",
    sessionCandidateCount: 10,
    domainCount: 1,
    completedDomainCount: 1,
    failedDomainCount: 0,
    failedDomainIds: [],
    blockedDomainIds: [],
    error: null,
    timings: {
      partitionMs: 0,
      dispatchMs: 0,
      solveMs: 5,
      validationMs: 0,
      mergeMs: 0,
      persistMs: 1,
      wallClockMs: 10,
    },
    plan: {
      seatingPlanId: "plan-1",
      version: 1,
      solverStatus: "OPTIMAL",
      assignedCount: 10,
      unassignedCount: 0,
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockedGetStatus.mockReset();
});

describe("GenerationStatusPage", () => {
  it("shows a loading state while the status is fetched", async () => {
    let resolveStatus: (s: GenerationStatus) => void = () => undefined;
    mockedGetStatus.mockReturnValue(new Promise((resolve) => (resolveStatus = resolve)));

    renderParamRoute(<GenerationStatusPage />, "/generations/:generationId", null, "/generations/gen-1");
    expect(screen.getByText("Loading generation status...")).toBeInTheDocument();

    await act(async () => {
      resolveStatus(status());
    });
  });

  it("requests the status for the URL generation ID", async () => {
    mockedGetStatus.mockResolvedValue(status());
    renderParamRoute(<GenerationStatusPage />, "/generations/:generationId", null, "/generations/gen-1");
    await screen.findByText("Seating generation completed successfully.");
    expect(mockedGetStatus).toHaveBeenCalledWith("gen-1");
  });

  it("renders a completed generation with plan details and a View seating plan action", async () => {
    mockedGetStatus.mockResolvedValue(status());
    renderParamRoute(<GenerationStatusPage />, "/generations/:generationId", null, "/generations/gen-1");

    expect(await screen.findByText("Seating generation completed successfully.")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("10 assigned, 0 unassigned")).toBeInTheDocument();
    expect(screen.getByText("OPTIMAL")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View seating plan" });
    expect(link.getAttribute("href")).toBe("/seating/plan-1");
    expect(mockedGetStatus).toHaveBeenCalledTimes(1);
  });

  it("polls while the generation is non-terminal and stops at COMPLETED", async () => {
    vi.useFakeTimers();
    mockedGetStatus
      .mockResolvedValueOnce(status({ state: "SOLVING", completedDomainCount: 0 }))
      .mockResolvedValueOnce(status());

    renderParamRoute(<GenerationStatusPage />, "/generations/:generationId", null, "/generations/gen-1");
    await act(async () => {});
    expect(
      screen.getByText(/Seating generation is in progress/),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText("Seating generation completed successfully.")).toBeInTheDocument();
    expect(mockedGetStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockedGetStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("renders a failed generation from the backend error contract and stops polling", async () => {
    mockedGetStatus.mockResolvedValue(
      status({
        state: "FAILED_RECONCILIATION",
        error: { code: "ERR_RECONCILIATION_INCOMPLETE", message: "candidates require review" },
      }),
    );
    renderParamRoute(<GenerationStatusPage />, "/generations/:generationId", null, "/generations/gen-1");

    expect(await screen.findByText("Seating generation failed.")).toBeInTheDocument();
    expect(screen.getByText(/ERR_RECONCILIATION_INCOMPLETE/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View seating plan" })).not.toBeInTheDocument();
    expect(mockedGetStatus).toHaveBeenCalledTimes(1);
  });

  it("does not leak backend error details into the browser", async () => {
    mockedGetStatus.mockResolvedValue(
      status({
        state: "FAILED_DOMAIN",
        error: {
          code: "ERR_SOLVE",
          message: "PrismaClientKnownRequestError at D:\\secrets\\schema.prisma\nstack trace",
        },
      }),
    );
    renderParamRoute(<GenerationStatusPage />, "/generations/:generationId", null, "/generations/gen-1");

    expect(await screen.findByText("Seating generation failed.")).toBeInTheDocument();
    expect(screen.getByText(/ERR_SOLVE/)).toBeInTheDocument();
    const bodyText = document.body.textContent ?? "";
    for (const marker of ["Prisma", "schema.prisma", "D:\\", "stack"]) {
      expect(bodyText).not.toContain(marker);
    }
  });

  it("shows a safe error and Retry when the generation is missing", async () => {
    mockedGetStatus
      .mockRejectedValueOnce(new ApiError(404, "GENERATION_NOT_FOUND", "generation not found"))
      .mockResolvedValueOnce(status());
    renderParamRoute(<GenerationStatusPage />, "/generations/:generationId", null, "/generations/gen-1");

    expect(await screen.findByText("Generation not found.")).toBeInTheDocument();

    const uploader = await import("@testing-library/user-event").then((m) => m.default.setup());
    await uploader.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Seating generation completed successfully.")).toBeInTheDocument();
    expect(mockedGetStatus).toHaveBeenCalledTimes(2);
  });

  it("clears the poll timer on unmount", async () => {
    vi.useFakeTimers();
    mockedGetStatus.mockResolvedValue(status({ state: "SOLVING", completedDomainCount: 0 }));

    const { unmount } = renderParamRoute(
      <GenerationStatusPage />,
      "/generations/:generationId",
      null,
      "/generations/gen-1",
    );
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(mockedGetStatus).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(mockedGetStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});