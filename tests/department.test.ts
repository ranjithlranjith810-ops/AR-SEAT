import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectUniqueViolation } from "./helpers";

describe("Department", () => {
  it("can be created with code and name", async () => {
    const department = await prisma.department.create({
      data: { code: "IT", name: "Information Technology" },
    });
    expect(department).toMatchObject({ code: "IT", name: "Information Technology" });
  });

  it("rejects a duplicate department code", async () => {
    await prisma.department.create({ data: { code: "CIVIL", name: "Civil Engineering" } });
    await expectUniqueViolation(
      prisma.department.create({ data: { code: "CIVIL", name: "Duplicate" } }),
    );
    const count = await prisma.department.count({ where: { code: "CIVIL" } });
    expect(count).toBe(1);
  });

  it("provides the four seeded departments", async () => {
    const codes = (await prisma.department.findMany({ orderBy: { code: "asc" } })).map(
      (d) => d.code,
    );
    expect(codes).toEqual(expect.arrayContaining(["CSE", "ECE", "EEE", "MECH"]));
  });
});