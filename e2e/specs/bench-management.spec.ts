import { expect, test } from "@playwright/test";
import { loadSeedState, login } from "../helpers";

async function deactivateHall(context: { request: import("@playwright/test").APIRequestContext }, hallNumber: string) {
  const list = await context.request.get("/exam-seating/halls");
  const body = (await list.json()) as { halls: Array<{ id: string; hallNumber: string }> };
  const hall = body.halls.find((h) => h.hallNumber === hallNumber);
  if (hall) {
    await context.request.patch(`/exam-seating/halls/${hall.id}`, { data: { isActive: false } });
  }
}

test.describe("Phase 18 hall & bench management", () => {
  test("ADMIN can browse seeded halls with benches and live derived capacity", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.admin.username, seed.admin.password);

    await page.getByRole("link", { name: "Halls & benches" }).click();
    await expect(page.getByRole("heading", { name: "Hall Management" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /LH09 — Lecture Hall 09/ })).toBeVisible();

    // The seeded LH09 has 5 benches (A..E); row A holds seats A1..A5.
    await expect(page.getByText("25/25 active seats")).toBeVisible();
    await expect(page.getByText("A1, A2, A3, A4, A5")).toBeVisible();
  });

  test("ADMIN can create a hall, a bench, assign a seat, and decommission the bench", async ({
    page,
    context,
  }) => {
    const seed = loadSeedState();
    await login(page, seed.admin.username, seed.admin.password);
    await page.getByRole("link", { name: "Halls & benches" }).click();
    await expect(page.getByRole("heading", { name: "Hall Management" })).toBeVisible();

    // Create a hall.
    await page.getByRole("button", { name: "Add hall" }).click();
    await page.getByLabel("Hall number").fill("E2EB1");
    await page.getByLabel("Name").fill("E2E Bench Hall 1");
    await page.getByLabel("Building").fill("E2E Block");
    await page.getByLabel("Rows").fill("2");
    await page.getByLabel("Columns").fill("2");
    await page.getByRole("button", { name: "Create hall" }).click();
    await expect(page.getByText("Hall E2EB1 created")).toBeVisible();

    const e2eHall = page.locator("section.panel--subsection").filter({ hasText: "E2EB1 — E2E Bench Hall 1" });
    await expect(e2eHall.getByText("No benches in this hall yet.")).toBeVisible();

    // Create a bench in that hall.
    await e2eHall.getByLabel("New bench").fill("B1");
    await e2eHall.getByRole("button", { name: "Add bench" }).click();
    await expect(page.getByText("Bench B1 added to E2EB1")).toBeVisible();
    await expect(e2eHall.getByRole("cell", { name: "B1" })).toBeVisible();
    await expect(e2eHall.getByRole("cell", { name: "0" })).toBeVisible();

    // Assign an unassigned seat to the bench; capacity becomes 1.
    await e2eHall.getByLabel("Seat to assign to bench B1").selectOption({ label: "A1" });
    await e2eHall.getByRole("button", { name: "Assign seat" }).click();
    await expect(page.getByText("Seat added to bench B1")).toBeVisible();
    await expect(e2eHall.getByRole("cell", { name: "A1", exact: true })).toBeVisible();
    await expect(e2eHall.getByRole("cell", { name: "1", exact: true })).toBeVisible();

    // Decommission the bench; its seat is deactivated and capacity drops to 0.
    await e2eHall.getByRole("table").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("Bench B1 in E2EB1 deactivated")).toBeVisible();
    await expect(e2eHall.getByRole("cell", { name: "0", exact: true })).toBeVisible();
    await expect(e2eHall.getByText("A1 (inactive)")).toBeVisible();

    // Restore the pristine seed state so the golden-path generation domain
    // (which expects only LH09 to be active) is unaffected.
    await deactivateHall({ request: context.request }, "E2EB1");
  });

  test("hall & bench APIs are authenticated and ADMIN-gated", async ({ page, context }) => {
    const seed = loadSeedState();
    const api = context.request;

    const anon = await api.get("/exam-seating/halls");
    expect(anon.status()).toBe(401);

    await login(page, seed.staff.username, seed.staff.password);

    const list = await api.get("/exam-seating/halls");
    expect(list.status()).toBe(200);
    const body = (await list.json()) as { halls: Array<{ hallNumber: string }> };
    expect(body.halls.some((h) => h.hallNumber === "LH09")).toBe(true);

    const staffCreate = await api.post("/exam-seating/halls", {
      data: { hallNumber: "E2E-X", name: "X", rows: 1, columns: 1 },
    });
    expect(staffCreate.status()).toBe(403);

    const staffBench = await api.post("/exam-seating/halls/LH09/benches", {
      data: { benchNumber: "X1" },
    });
    expect(staffBench.status()).toBe(403);
  });

  test("ADMIN bench APIs enforce the cross-hall guard and soft decommissioning", async ({
    page,
    context,
  }) => {
    const seed = loadSeedState();
    await login(page, seed.admin.username, seed.admin.password);
    const api = context.request;

    // Create a second hall and a bench there.
    const hallRes = await api.post("/exam-seating/halls", {
      data: { hallNumber: "E2EB2", name: "E2E Bench Hall 2", rows: 1, columns: 2 },
    });
    expect(hallRes.status()).toBe(200);
    const hallBody = (await hallRes.json()) as {
      hall: { id: string; unassignedSeats: Array<{ id: string }> };
    };
    const hallId = hallBody.hall.id;

    const benchRes = await api.post(`/exam-seating/halls/${hallId}/benches`, {
      data: { benchNumber: "B1" },
    });
    expect(benchRes.status()).toBe(200);
    const benchBody = (await benchRes.json()) as { bench: { id: string; seats: unknown[] } };
    const benchId = benchBody.bench.id;

    // Seats of the seeded LH09 must be rejected for this hall's bench.
    const lh = await api.get("/exam-seating/halls");
    const lhBody = (await lh.json()) as {
      halls: Array<{ hallNumber: string; benches: Array<{ id: string; seats: Array<{ id: string }> }> }>;
    };
    const lh09 = lhBody.halls.find((h) => h.hallNumber === "LH09")!;
    const foreignSeatId = lh09.benches[0]!.seats[0]!.id;

    const assign = await api.post(`/exam-seating/benches/${benchId}/seats/${foreignSeatId}`);
    expect(assign.status()).toBe(400);
    const assignBody = (await assign.json()) as { error: string };
    expect(assignBody.error).toBe("BENCH_SEAT_HALL_MISMATCH");

    // Assign a seat from the same hall and verify capacity derivation.
    const ownSeatId = hallBody.hall.unassignedSeats[0]!.id;

    const own = await api.post(`/exam-seating/benches/${benchId}/seats/${ownSeatId}`);
    expect(own.status()).toBe(200);

    const afterAssign = await api.get(`/exam-seating/benches/${benchId}`);
    expect(afterAssign.status()).toBe(200);
    const afterBody = (await afterAssign.json()) as { bench: { capacity: number; seats: unknown[] } };
    expect(afterBody.bench.capacity).toBe(1);

    // Decommission: bench + member seats flip inactive; capacity becomes 0.
    const deactivate = await api.post(`/exam-seating/benches/${benchId}/status`, {
      data: { isActive: false },
    });
    expect(deactivate.status()).toBe(200);

    const afterDeactivate = await api.get(`/exam-seating/benches/${benchId}`);
    const deactivatedBody = (await afterDeactivate.json()) as {
      bench: { isActive: boolean; capacity: number; seats: Array<{ isActive: boolean }> };
    };
    expect(deactivatedBody.bench.isActive).toBe(false);
    expect(deactivatedBody.bench.capacity).toBe(0);
    expect(deactivatedBody.bench.seats[0]!.isActive).toBe(false);

    // Restore the pristine seed state (only LH09 active) so the golden-path
    // generation domain is unaffected.
    await deactivateHall({ request: context.request }, "E2EB1");
    await deactivateHall({ request: context.request }, "E2EB2");
  });
});