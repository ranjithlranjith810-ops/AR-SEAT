import { expect, test } from "@playwright/test";
import { loadSeedState, login } from "../helpers";

const REGISTER = "DEMO-CSE-777";

test.describe("Phase 17 student master surface", () => {
  test("STAFF can browse, search, filter and paginate the student master", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);

    await page.getByRole("link", { name: "Students" }).click();
    await expect(page.getByRole("heading", { name: "Student Master" })).toBeVisible();

    // The 30 seeded students fill two pages of 20.
    await expect(page.getByRole("cell", { name: "DEMO-CSE-001" })).toBeVisible();
    await expect(page.getByText("Showing 1–20 of 30")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Showing 21–30 of 30")).toBeVisible();
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("Showing 1–20 of 30")).toBeVisible();

    // Search narrows the list by register number.
    const filters = page.locator("form.audit-filters");
    await filters.getByPlaceholder("Name, register number, roll number").fill("DEMO-ECE");
    await filters.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("cell", { name: "DEMO-ECE-013" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "DEMO-CSE-001" })).toHaveCount(0);

    // Department filter narrows further.
    await filters.getByLabel("Department").selectOption({ label: "CSE — Computer Science and Engineering" });
    await filters.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("No students match the current filters.")).toBeVisible();

    // Reset restores the unfiltered first page.
    await filters.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByRole("cell", { name: "DEMO-CSE-001" })).toBeVisible();
  });

  test("student master API is authenticated; STAFF reads but cannot create departments or classes", async ({
    page,
    context,
  }) => {
    const seed = loadSeedState();
    const api = context.request;

    const anon = await api.get("/exam-seating/students");
    expect(anon.status()).toBe(401);

    await login(page, seed.staff.username, seed.staff.password);

    const list = await api.get("/exam-seating/students?limit=5&offset=0");
    expect(list.status()).toBe(200);
    const body = (await list.json()) as { students: unknown[]; total: number; limit: number };
    expect(body.students.length).toBeGreaterThan(0);
    expect(body.limit).toBe(5);
    expect(body.total).toBeGreaterThanOrEqual(30);

    const depts = await api.get("/exam-seating/departments");
    expect(depts.status()).toBe(200);
    const classes = await api.get("/exam-seating/classes");
    expect(classes.status()).toBe(200);

    const staffDept = await api.post("/exam-seating/departments", {
      data: { code: "E2E-X", name: "E2E Dept" },
    });
    expect(staffDept.status()).toBe(403);
    const staffClass = await api.post("/exam-seating/classes", {
      data: { departmentId: "x", name: "X", year: 3, section: "A", academicYear: "2026-2027" },
    });
    expect(staffClass.status()).toBe(403);
  });

  test("ADMIN can create a department and a class through the API", async ({ page, context }) => {
    const seed = loadSeedState();
    const api = context.request;
    await login(page, seed.admin.username, seed.admin.password);

    const deptRes = await api.post("/exam-seating/departments", {
      data: { code: "E2E", name: "E2E Engineering" },
    });
    expect(deptRes.status()).toBe(200);
    const dept = (await deptRes.json()) as { department: { id: string } };

    const clsRes = await api.post("/exam-seating/classes", {
      data: {
        departmentId: dept.department.id,
        name: "E2E-A",
        year: 3,
        section: "A",
        academicYear: "2026-2027",
      },
    });
    expect(clsRes.status()).toBe(200);

    const dup = await api.post("/exam-seating/classes", {
      data: {
        departmentId: dept.department.id,
        name: "E2E-A",
        year: 3,
        section: "A",
        academicYear: "2026-2027",
      },
    });
    expect(dup.status()).toBe(409);
  });

  test("STAFF creates a student through the form and it appears in the list", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);
    await page.getByRole("link", { name: "Students" }).click();

    await page.getByRole("button", { name: "Add student" }).click();
    const form = page.getByRole("form", { name: "Student form" });
    await form.getByLabel("Name").fill("E2E Created Student");
    await form.getByLabel("Register number").fill(REGISTER);
    await form.getByLabel("Roll number").fill("7777");
    await form.getByLabel("Gender").selectOption("MALE");
    await form.getByLabel("Department").selectOption({ label: "CSE — Computer Science and Engineering" });
    await form.getByLabel("Class").selectOption({ label: "CSE-A (3) — 2025-2026" });
    await form.getByRole("button", { name: "Create student" }).click();

    await expect(page.getByText(`${REGISTER} saved`)).toBeVisible();
    const filters = page.locator("form.audit-filters");
    await filters.getByPlaceholder("Name, register number, roll number").fill(REGISTER);
    await filters.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("cell", { name: "E2E Created Student" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "CSE-A (2025-2026)" })).toBeVisible();
  });

  test("STAFF edits a student through the form", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);
    await page.getByRole("link", { name: "Students" }).click();

    const filters = page.locator("form.audit-filters");
    await filters.getByPlaceholder("Name, register number, roll number").fill(REGISTER);
    await filters.getByRole("button", { name: "Apply" }).click();
    const row = page.locator("tr").filter({ hasText: REGISTER });
    await row.getByRole("button", { name: "Edit" }).click();

    const form = page.getByRole("form", { name: "Student form" });
    await form.getByLabel("Name").fill("E2E Renamed Student");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(`${REGISTER} saved`)).toBeVisible();
    await expect(page.getByRole("cell", { name: "E2E Renamed Student" })).toBeVisible();
  });

  test("STAFF deactivates a student through the row status control", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);
    await page.getByRole("link", { name: "Students" }).click();

    const filters = page.locator("form.audit-filters");
    await filters.getByPlaceholder("Name, register number, roll number").fill(REGISTER);
    await filters.getByRole("button", { name: "Apply" }).click();
    const row = page.locator("tr").filter({ hasText: REGISTER });
    await row.getByLabel(`Status for ${REGISTER}`).selectOption("INACTIVE");
    await expect(page.getByText(`${REGISTER} → INACTIVE`)).toBeVisible();
    await expect(row.locator(".status-badge--inactive")).toHaveText("INACTIVE");
  });

  test("duplicate register number surfaces the unique-constraint error in the form", async ({ page }) => {
    const seed = loadSeedState();
    await login(page, seed.staff.username, seed.staff.password);
    await page.getByRole("link", { name: "Students" }).click();

    await page.getByRole("button", { name: "Add student" }).click();
    const form = page.getByRole("form", { name: "Student form" });
    await form.getByLabel("Name").fill("Duplicate Student");
    await form.getByLabel("Register number").fill(REGISTER);
    await form.getByLabel("Roll number").fill("7777");
    await form.getByLabel("Department").selectOption({ label: "CSE — Computer Science and Engineering" });
    await form.getByLabel("Class").selectOption({ label: "CSE-A (3) — 2025-2026" });
    await form.getByRole("button", { name: "Create student" }).click();

    await expect(
      page.getByText("That register number already exists. Student records must be unique."),
    ).toBeVisible();
  });
});