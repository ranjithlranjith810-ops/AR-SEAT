import { expect, test } from "@playwright/test";
import { apiUrl, loadSeedState } from "../helpers";

test.describe("authentication boundaries", () => {
  test("unauthenticated deep links redirect to login", async ({ page }) => {
    for (const path of ["/#/exams", "/#/upload"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    }
  });

  test("unauthenticated API requests are rejected with 401", async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: apiUrl("") });
    const me = await api.get("/auth/me");
    expect(me.status()).toBe(401);

    const exams = await api.get("/exam-seating/exams");
    expect(exams.status()).toBe(401);

    const generation = await api.post("/exam-seating/generations", {
      data: { examId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(generation.status()).toBe(401);
    await api.dispose();
  });

  test("admin login then logout clears the session", async ({ page, context }) => {
    const seed = loadSeedState();
    await page.goto("/login");
    await page.getByLabel("Username").fill(seed.admin.username);
    await page.getByLabel("Password").fill(seed.admin.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/Document ingestion/)).toBeVisible();

    const me = await context.request.get("/auth/me");
    expect(me.status()).toBe(200);
    const body = (await me.json()) as { user: { role: string } };
    expect(body.user.role).toBe("ADMIN");

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);

    // The session row is deleted server-side during logout; poll until the
    // invalidation is observable rather than racing the deletion commit.
    await expect
      .poll(async () => (await context.request.get("/auth/me")).status(), { timeout: 10_000 })
      .toBe(401);
  });
});
