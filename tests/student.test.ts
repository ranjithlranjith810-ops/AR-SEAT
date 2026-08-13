import { describe, it, expect } from "vitest";
import { prisma } from "./setup";
import { expectForeignKeyViolation, expectUniqueViolation } from "./helpers";
import { seededClass } from "./fixtures";

describe("Student", () => {
  it("can be created", async () => {
    const cls = await seededClass("CSE-A");
    const student = await prisma.student.create({
      data: {
        name: "RAMYA S",
        rollNumber: "CSE333",
        registerNumber: "SNT-001",
        gender: "FEMALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    expect(student.registerNumber).toBe("SNT-001");
    expect(student.status).toBe("ACTIVE");
  });

  it("enforces a unique register number", async () => {
    const cls = await seededClass("CSE-B");
    await prisma.student.create({
      data: {
        name: "One",
        rollNumber: "CSE-1",
        registerNumber: "SNT-002",
        gender: "MALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    await expectUniqueViolation(
      prisma.student.create({
        data: {
          name: "Two",
          rollNumber: "CSE-2",
          registerNumber: "SNT-002",
          gender: "MALE",
          classId: cls.id,
          status: "ACTIVE",
        },
      }),
    );
  });

  it("rejects a student without a valid class", async () => {
    await expectForeignKeyViolation(
      prisma.student.create({
        data: {
          name: "Orphan",
          rollNumber: "CSE-3",
          registerNumber: "SNT-003",
          gender: "MALE",
          classId: "00000000-0000-4000-8000-000000000000",
          status: "ACTIVE",
        },
      }),
    );
  });

  it("keeps an inactive student in the database", async () => {
    const cls = await seededClass("EEE-A");
    const student = await prisma.student.create({
      data: {
        name: "INACTIVE USER",
        rollNumber: "EEE-9",
        registerNumber: "SNT-004",
        gender: "OTHER",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    const updated = await prisma.student.update({
      where: { id: student.id },
      data: { status: "INACTIVE" },
    });
    const persisted = await prisma.student.findUnique({ where: { id: student.id } });
    expect(persisted?.status).toBe("INACTIVE");
    expect(updated.status).toBe("INACTIVE");
  });

  it("remains available even after being transferred", async () => {
    const cls = await seededClass("CSE-A");
    const student = await prisma.student.create({
      data: {
        name: "TRANSFERRED USER",
        rollNumber: "CSE-77",
        registerNumber: "SNT-005",
        gender: "MALE",
        classId: cls.id,
        status: "ACTIVE",
      },
    });
    await prisma.student.update({ where: { id: student.id }, data: { status: "TRANSFERRED" } });
    const persisted = await prisma.student.findUnique({ where: { id: student.id } });
    expect(persisted?.status).toBe("TRANSFERRED");
  });
});