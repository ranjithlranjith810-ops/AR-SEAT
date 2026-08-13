import { Gender, PrismaClient, StudentStatus } from "@prisma/client";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ACADEMIC_YEAR = "2025-2026";

const STUDENTS_PER_CLASS = 6;

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const departments = [
    { code: "CSE", name: "Computer Science and Engineering" },
    { code: "ECE", name: "Electronics and Communication Engineering" },
    { code: "EEE", name: "Electrical and Electronics Engineering" },
    { code: "MECH", name: "Mechanical Engineering" },
  ];

  const departmentIds = new Map<string, string>();
  for (const d of departments) {
    const rec = await prisma.department.upsert({
      where: { code: d.code },
      update: { name: d.name },
      create: d,
    });
    departmentIds.set(d.code, rec.id);
  }

  const classDefs = [
    { code: "CSE", name: "CSE-A", year: 3, section: "A" },
    { code: "CSE", name: "CSE-B", year: 3, section: "B" },
    { code: "ECE", name: "ECE-A", year: 3, section: "A" },
    { code: "EEE", name: "EEE-A", year: 3, section: "A" },
    { code: "MECH", name: "MECH-A", year: 3, section: "A" },
  ];

  const classIds = new Map<string, string>();
  for (const c of classDefs) {
    const departmentId = departmentIds.get(c.code);
    if (!departmentId) throw new Error(`Department not found for ${c.code}`);
    const rec = await prisma.class.upsert({
      where: {
        departmentId_name_academicYear: {
          departmentId,
          name: c.name,
          academicYear: ACADEMIC_YEAR,
        },
      },
      update: { year: c.year, section: c.section },
      create: {
        departmentId,
        name: c.name,
        year: c.year,
        section: c.section,
        academicYear: ACADEMIC_YEAR,
      },
    });
    classIds.set(c.name, rec.id);
  }

  let sequence = 0;
  for (const className of classIds.keys()) {
    const classPrefix = className.slice(0, 3).toUpperCase();
    for (let i = 1; i <= STUDENTS_PER_CLASS; i++) {
      sequence += 1;
      const padded = String(sequence).padStart(3, "0");
      const rollNumber = `${classPrefix}${padded}`;
      const registerNumber = `DEMO-${classPrefix}-${padded}`;
      const gender: Gender = sequence % 2 === 0 ? "FEMALE" : "MALE";
      const classId = classIds.get(className);
      if (!classId) throw new Error(`Class not found for ${className}`);
      await prisma.student.upsert({
        where: { registerNumber },
        update: {
          name: `Student ${padded}`,
          gender,
          classId,
          status: "ACTIVE" as StudentStatus,
          rollNumber,
        },
        create: {
          name: `Student ${padded}`,
          rollNumber,
          registerNumber,
          gender,
          classId,
          status: "ACTIVE",
        },
      });
    }
  }

  const hall = await prisma.hall.upsert({
    where: { hallNumber: "LH09" },
    update: {
      name: "Lecture Hall 09",
      building: "Main Block",
      rows: 5,
      columns: 5,
      isActive: true,
    },
    create: {
      hallNumber: "LH09",
      name: "Lecture Hall 09",
      building: "Main Block",
      rows: 5,
      columns: 5,
      isActive: true,
    },
  });

  const rowLetters = ["A", "B", "C", "D", "E"];
  for (const [rowIndex, letter] of rowLetters.entries()) {
    void rowIndex;
    for (let column = 1; column <= hall.columns; column++) {
      const seatPosition = `${letter}${column}`;
      await prisma.hallSeat.upsert({
        where: { hallId_seatPosition: { hallId: hall.id, seatPosition } },
        update: { row: letter, column, isActive: true },
        create: { hallId: hall.id, seatPosition, row: letter, column, isActive: true },
      });
    }
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
    console.log("Seed complete.");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}