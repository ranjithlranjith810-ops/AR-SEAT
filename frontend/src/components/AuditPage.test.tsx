import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { ApiError } from "../lib/api";
import type { AuditLogItem } from "../lib/types";
import { RequireAdmin } from "../auth/guards";
import { AuditPage } from "./AuditPage";
import { adminUser, renderRoutes, staffUser } from "../test/harness";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, getAuditLogs: vi.fn() };
});

const { getAuditLogs } = await import("../lib/api");
const mockedGetAuditLogs = vi.mocked(getAuditLogs);

function auditItem(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    id: "audit-1",
    action: "EXAM_CREATED",
    entityType: "Exam",
    entityId: "exam-1",
    createdAt: "2026-08-17T06:00:00.000Z",
    actor: { id: "admin-1", username: "admin", role: "ADMIN" },
    ...overrides,
  };
}

function renderAudit(user = adminUser, initial = "/audit") {
  return renderRoutes(
    <Routes>
      <Route
        path="/audit"
        element={
          <RequireAdmin>
            <AuditPage />
          </RequireAdmin>
        }
      />
    </Routes>,
    user,
    initial,
  );
}

function page(items: AuditLogItem[], total: number, offset = 0) {
  return { items, total, limit: 20, offset };
}

beforeEach(() => {
  mockedGetAuditLogs.mockReset();
});

describe("AuditPage", () => {
  it("shows a loading state while the audit log is fetched", async () => {
    mockedGetAuditLogs.mockReturnValue(new Promise(() => undefined));
    renderAudit();
    expect(screen.getByText("Loading audit log...")).toBeInTheDocument();
  });

  it("renders audit entries with action, entity and resolved actor", async () => {
    mockedGetAuditLogs.mockResolvedValue(
      page(
        [
          auditItem(),
          auditItem({
            id: "audit-2",
            action: "PLAN_APPROVED",
            entityType: "SeatingPlan",
            entityId: "plan-1",
            actor: null,
          }),
        ],
        2,
      ),
    );
    renderAudit();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("EXAM_CREATED")).toBeInTheDocument();
    expect(within(table).getByText("PLAN_APPROVED")).toBeInTheDocument();
    expect(within(table).getByText("Exam")).toBeInTheDocument();
    expect(within(table).getByText("SeatingPlan")).toBeInTheDocument();
    expect(within(table).getByText("exam-1")).toBeInTheDocument();
    expect(within(table).getByText("admin (ADMIN)")).toBeInTheDocument();
    expect(within(table).getByText("—")).toBeInTheDocument();
  });

  it("shows the pagination summary and paging controls", async () => {
    const twentyFive = Array.from({ length: 25 }, (_, i) =>
      auditItem({ id: `audit-${i}`, entityId: `exam-${i}` }),
    );
    mockedGetAuditLogs
      .mockResolvedValueOnce(page(twentyFive.slice(0, 20), 25))
      .mockResolvedValueOnce(page(twentyFive.slice(20), 25, 20));
    renderAudit();

    expect(await screen.findByText("Showing 1–20 of 25")).toBeInTheDocument();

    const user = userEvent.setup();
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(next);

    expect(await screen.findByText("Showing 21–25 of 25")).toBeInTheDocument();
    expect(mockedGetAuditLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 20 }),
    );
    const prev = screen.getByRole("button", { name: "Previous" });
    expect(prev).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows an empty state when nothing matches", async () => {
    mockedGetAuditLogs.mockResolvedValue(page([], 0));
    renderAudit();
    expect(await screen.findByText("No audit entries match the current filters.")).toBeInTheDocument();
    expect(screen.getByText("Showing 0–0 of 0")).toBeInTheDocument();
  });

  it("surfaces a safe error with a Retry action", async () => {
    mockedGetAuditLogs
      .mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "Unable to reach the server"))
      .mockResolvedValueOnce(page([auditItem()], 1));
    renderAudit();

    expect(await screen.findByText("Unable to reach the server. Please try again.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(within(await screen.findByRole("table")).getByText("EXAM_CREATED")).toBeInTheDocument();
    expect(mockedGetAuditLogs).toHaveBeenCalledTimes(2);
  });

  it("applies filters and resets them", async () => {
    mockedGetAuditLogs
      .mockResolvedValue(page([], 0))
      .mockResolvedValue(page([], 0))
      .mockResolvedValue(page([], 0));
    renderAudit();
    await screen.findByText("No audit entries match the current filters.");

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Action"), "PLAN_APPROVED");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(mockedGetAuditLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "PLAN_APPROVED", offset: 0 }),
    );

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(mockedGetAuditLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: undefined, entityType: undefined }),
    );
    expect(screen.getByLabelText("Action")).toHaveValue("");
  });

  it("blocks STAFF from the audit log screen (route protection)", async () => {
    renderAudit(staffUser);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(mockedGetAuditLogs).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
