import { expect, test } from "@playwright/test";
import { loadSeedState, login } from "../helpers";

test.describe("Phase 16 ADMIN audit-read surface", () => {
  test("ADMIN can browse, filter and reset the audit log in the browser", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.admin.username, seed.admin.password);

    await page.getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();

    // The seeded exam-creation entries render with entity context and no actor.
    await expect(page.getByRole("cell", { name: "EXAM_CREATED" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Exam" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "—" }).first()).toBeVisible();

    // The actor-bearing entry written through logAudit resolves the ADMIN.
    await page.getByLabel("Entity type").fill("SeatingPlan");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("cell", { name: "PLAN_APPROVED" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "e2e-admin (ADMIN)" }).first()).toBeVisible();

    // Reset restores the unfiltered view.
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByRole("cell", { name: "EXAM_CREATED" }).first()).toBeVisible();
  });

  test("STAFF cannot reach the audit log route or link", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);

    await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
    await page.goto("/#/audit");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  });

  test("audit-logs API is ADMIN-only, paginated and never exposes metadata", async ({
    page,
    context,
  }) => {
    const seed = loadSeedState();
    const api = context.request;

    const anon = await api.get("/exam-seating/audit-logs");
    expect(anon.status()).toBe(401);

    await login(page, seed.staff.username, seed.staff.password);
    const staff = await api.get("/exam-seating/audit-logs");
    expect(staff.status()).toBe(403);

    // Switch to the ADMIN session through the UI so the API context follows
    // the new cookie (re-login is blocked while a session is still active).
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await login(page, seed.admin.username, seed.admin.password);
    const list = await api.get(
      `/exam-seating/audit-logs?entityType=SeatingPlan&limit=5&offset=0`,
    );
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(0);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["action", "actor", "createdAt", "entityId", "entityType", "id"].sort(),
      );
      expect("metadata" in item).toBe(false);
    }
    const approved = body.items.find(
      (item) => (item as { entityId: string }).entityId === seed.auditPlan.entityId,
    );
    expect(approved).toBeDefined();
    expect((approved as { actor: { username: string } | null }).actor?.username).toBe(
      seed.admin.username,
    );

    const badLimit = await api.get("/exam-seating/audit-logs?limit=999");
    expect(badLimit.status()).toBe(400);
  });
});