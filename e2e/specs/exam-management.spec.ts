import { expect, test } from "@playwright/test";
import { loadSeedState, login } from "../helpers";

test.describe("Phase 19 exam management", () => {
  test("admin adds a candidate, detects a schedule conflict, excludes with a reason, and reinstates", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const seed = loadSeedState();
    await login(page, seed.admin.username, seed.admin.password);

    await page.goto(`/#/exams/${seed.manageExam.id}/candidates`);
    await expect(page.getByRole("heading", { name: "Exam candidates" })).toBeVisible();
    await expect(page.getByText("No candidates for this exam yet.")).toBeVisible();

    await page.locator("#student-search").fill("DEMO-CSE-005");
    await page.getByRole("button", { name: "Search" }).click();
    await page.locator("#student-select").selectOption({ label: "DEMO-CSE-005 — Student 005" });
    await page.getByRole("button", { name: "Add candidate" }).click();

    const rosterRow = page.locator("tbody tr").filter({ hasText: "DEMO-CSE-005" });
    await expect(rosterRow.getByText("MATCHED")).toBeVisible();

    await page.getByRole("button", { name: "Check conflicts" }).click();
    const conflictsTable = page.locator("table").filter({
      has: page.locator("caption", { hasText: "Schedule conflicts" }),
    });
    await expect(conflictsTable.getByText(seed.conflictExam.id)).toBeVisible();
    await expect(conflictsTable.getByText("MATCHED")).toBeVisible();
    await expect(conflictsTable.getByText("DEMO-CSE-005")).toBeVisible();

    await page.getByLabel("Exclusion reason for DEMO-CSE-005").fill("double-booked same session");
    await page.getByRole("button", { name: "Exclude" }).click();

    await expect(rosterRow.getByText("REJECTED")).toBeVisible();
    await expect(rosterRow.getByRole("button", { name: "Reinstate" })).toBeVisible();

    await page.getByRole("button", { name: "Check conflicts" }).click();
    await expect(page.getByText("No schedule conflicts detected for this exam.")).toBeVisible();

    await page.getByRole("button", { name: "Reinstate" }).click();
    await expect(rosterRow.getByText("MATCHED")).toBeVisible();
    await expect(rosterRow.getByRole("button", { name: "Exclude" })).toBeVisible();
  });

  test("admin cancels an exam with an audit reason", async ({ page }) => {
    test.setTimeout(120_000);
    const seed = loadSeedState();
    await login(page, seed.admin.username, seed.admin.password);

    await page.goto(`/#/exams/${seed.cancelExam.id}/candidates`);
    await expect(page.getByRole("heading", { name: "Exam candidates" })).toBeVisible();

    await page.locator("#cancel-reason").fill("venue unavailable");
    await page.getByRole("button", { name: "Cancel exam" }).click();

    await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel exam" })).toHaveCount(0);
  });

  test("STAFF is denied the exam management page", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);

    await page.goto(`/#/exams/${seed.cancelExam.id}/candidates`);
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  });
});