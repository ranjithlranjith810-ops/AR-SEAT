import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import {
  expectForeignKeyViolation,
  expectUniqueViolation,
} from "./helpers";
import { seededClass, seededDepartment } from "./fixtures";

describe("Class", () => {
  it("belongs to a department", async () => {
    const department = await seededDepartment("CSE");
    const cls = await prisma.class.create({
      data: {
        departmentId: department.id,
        name: "CSE-C",
        year: 3,
        section: "C",
        academicYear: "2025-2026",
      },
      include: { department: true },
    });
    expect(cls.department.id).toBe(department.id);
    expect(cls.department.code).toBe("CSE");
  });

  it("cannot reference a nonexistent department", async () => {
    await expectForeignKeyViolation(
      prisma.class.create({
        data: {
          departmentId: "00000000-0000-4000-8000-000000000000",
          name: "GHOST-A",
          year: 1,
          section: "A",
          academicYear: "2025-2026",
        },
      }),
    );
  });

  it("rejects a duplicate class definition for the same department/name/academic year", async () => {
    const department = await seededDepartment("ECE");
    const first = {
      departmentId: department.id,
      name: "ECE-B",
      year: 3,
      section: "B",
      academicYear: "2025-2026",
    };
    await prisma.class.create({ data: first });
    await expectUniqueViolation(
      prisma.class.create({ data: { ...first, section: "C" } }),
    );
  });

  it("can hold students through the seeded hierarchy", async () => {
    const cls = await seededClass("MECH-A");
    const student = await prisma.student.create({
      data: {
        name: "Hierarchy User",
        rollNumber: "MECH-ZZZ",
        registerNumber: "DEMO-MECH-ZZZ",
        gender: "MALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    expect(student.classId).toBe(cls.id);
  });
});