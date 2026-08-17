import { expect, test } from "@playwright/test";
import { apiUrl, loadSeedState, login } from "../helpers";

test.describe("STAFF role boundary", () => {
  test("STAFF UI hides admin surfaces and blocks admin routes", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);

    await expect(page.getByText("Document upload is administrator-only.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Exams" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Upload documents" })).toHaveCount(0);

    for (const path of ["/#/exams", "/#/upload"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    }
  });

  test("STAFF can read candidates but cannot resolve or generate", async ({ page, context }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);

    await page.goto(`/#/documents/${seed.roleDocument.id}/candidates`);
    await expect(page.getByRole("heading", { name: "Candidates" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Generate seating" })).toHaveCount(0);

    const api = context.request;
    const me = await api.get("/auth/me");
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe("STAFF");

    const list = await api.get(
      `/exam-seating/documents/${seed.roleDocument.id}/candidates?limit=50&offset=0`,
    );
    expect(list.status()).toBe(200);
    const pageData = (await list.json()) as { candidates: { id: string }[] };
    expect(pageData.candidates.length).toBe(2);

    const candidateId = pageData.candidates[0]!.id;
    const resolve = await api.post(
      `/exam-seating/documents/${seed.roleDocument.id}/candidates/${candidateId}/resolve`,
    );
    expect(resolve.status()).toBe(403);

    const generation = await api.post("/exam-seating/generations", {
      data: { examId: seed.roleExam.id },
    });
    expect(generation.status()).toBe(403);
  });

  test("STAFF upload is rejected server-side", async ({ page, context }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);

    const upload = await context.request.post(
      `/exam-seating/documents?examId=${seed.roleExam.id}`,
      {
        headers: { "content-type": "application/pdf", "x-file-name": "staff-upload.pdf" },
        data: Buffer.from("%PDF-1.4 staff upload should be blocked"),
      },
    );
    expect(upload.status()).toBe(403);
  });
});
