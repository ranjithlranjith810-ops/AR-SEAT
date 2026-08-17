import { expect, test } from "@playwright/test";
import { annaFixtureLines, buildPdf } from "../../tests/fixture-pdf";
import { loadSeedState, login } from "../helpers";

const GOLDEN_ROWS = [
  { serial: "1", registerNumber: "DEMO-CSE-001", name: "Student 001" },
  { serial: "2", registerNumber: "DEMO-CSE-002", name: "Student 002" },
  { serial: "3", registerNumber: "DEMO-CSE-003", name: "Student 003" },
  { serial: "4", registerNumber: "DEMO-CSE-004", name: "Student 004" },
  { serial: "5", registerNumber: "DEMO-CSE-007", name: "Student 007" },
  { serial: "6", registerNumber: "DEMO-CSE-008", name: "Student 008" },
  { serial: "7", registerNumber: "DEMO-ECE-013", name: "Student 013" },
  { serial: "8", registerNumber: "DEMO-ECE-014", name: "Student 014" },
  { serial: "9", registerNumber: "DEMO-EEE-019", name: "Student 019" },
  { serial: "10", registerNumber: "DEMO-EEE-020", name: "Student 020" },
  { serial: "11", registerNumber: "DEMO-MEC-025", name: "Student 025" },
  { serial: "12", registerNumber: "DEMO-MEC-026", name: "Student 026" },
];

test.describe("golden path: upload -> resolve -> generate -> approve -> publish", () => {
  test("full lifecycle in the real browser", async ({ page }) => {
    test.setTimeout(240_000);
    const seed = loadSeedState();
    await login(page, seed.admin.username, seed.admin.password);

    await page.getByRole("link", { name: "Exams" }).click();
    await expect(page.getByRole("heading", { name: "Select an exam" })).toBeVisible();
    const examRows = page.locator(".exam-row");
    expect(await examRows.count()).toBeGreaterThanOrEqual(2);

    await page.getByRole("link", { name: "Upload documents" }).click();
    await expect(page.getByRole("heading", { name: "Upload a document" })).toBeVisible();
    await page.locator("#examId").fill(seed.goldenExam.id);

    const pdfBytes = await buildPdf(
      annaFixtureLines(GOLDEN_ROWS, { date: "12.05.2026", session: "FN" }),
    );
    await page.locator("#pdf-file").setInputFiles({
      name: "golden-fixture.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdfBytes),
    });
    await page.getByRole("button", { name: "Upload document" }).click();

    await expect(
      page.getByText("Processing complete. 12 validated candidate records persisted."),
    ).toBeVisible();
    await page.getByRole("button", { name: "View candidates" }).click();

    await expect(page.getByRole("heading", { name: "Candidates" })).toBeVisible();
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(12);
    for (let i = 0; i < 12; i++) {
      const row = rows.nth(i);
      await row.getByRole("button", { name: "Resolve" }).click();
      await expect(row.getByText("VALIDATED")).toBeVisible();
    }

    await page.getByRole("button", { name: "Generate seating" }).click();
    await expect(page.getByRole("heading", { name: "Generation status" })).toBeVisible();
    await expect(page.getByText("Seating generation completed successfully.")).toBeVisible();
    await expect(page.getByText("12 assigned, 0 unassigned")).toBeVisible();

    await page.getByRole("link", { name: "View seating plan" }).click();
    await expect(page.getByRole("heading", { name: "Seating plan" })).toBeVisible();
    await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
    await expect(page.getByText(seed.goldenExam.id)).toBeVisible();
    const assignmentRows = page.locator("tbody tr");
    await expect(assignmentRows).toHaveCount(12);

    await page.getByRole("button", { name: "Approve plan" }).click();
    await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Publish plan" }).click();
    await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish plan" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve plan" })).toHaveCount(0);
  });
});
