import { Gender, StudentStatus } from "@prisma/client";
import { prisma } from "../src/db";
import { createExam } from "../src/services/exam.service";
import {
  createCandidate,
  transitionValidationStatus,
} from "../src/services/candidate.service";

let fixtureSequence = 0;

export async function createTestStudent(classId: string, tag: string) {
  fixtureSequence += 1;
  const n = fixtureSequence;
  return prisma.student.create({
    data: {
      name: `Fixture Student ${tag} ${n}`,
      rollNumber: `R-${tag}-${n}`,
      registerNumber: `REG-${tag}-${n}`,
      gender: tag === "F" ? ("FEMALE" as Gender) : ("MALE" as Gender),
      classId,
      status: "ACTIVE" as StudentStatus,
    },
  });
}

export async function createTestExam() {
  return createExam({ examDate: new Date("2026-05-20T09:30:00Z"), session: "FN" }, "test-actor");
}

export async function createTestCandidate(
  examId: string,
  studentId: string,
  registerNumberSnapshot?: string,
) {
  return createCandidate(
    {
      examId,
      studentId,
      subjectCode: "CS8501",
      subjectName: "Theory of Computation",
      registerNumberSnapshot,
    },
    "test-actor",
  );
}

export async function createValidatedCandidate(
  examId: string,
  studentId: string,
  registerNumberSnapshot?: string,
) {
  const candidate = await createTestCandidate(examId, studentId, registerNumberSnapshot);
  await transitionValidationStatus(candidate.id, "MATCHED", "test-actor");
  return transitionValidationStatus(candidate.id, "VALIDATED", "test-actor");
}

export async function seededClass(name = "CSE-A") {
  const cls = await prisma.class.findFirst({
    where: { name },
    include: { department: true },
  });
  if (!cls) throw new Error(`Seeded class ${name} not found`);
  return cls;
}

export async function seededDepartment(code = "CSE") {
  const dept = await prisma.department.findUnique({ where: { code } });
  if (!dept) throw new Error(`Seeded department ${code} not found`);
  return dept;
}

export async function seededHall() {
  const hall = await prisma.hall.findFirst({ where: { hallNumber: "LH09" } });
  if (!hall) throw new Error("Seeded hall LH09 not found");
  return hall;
}