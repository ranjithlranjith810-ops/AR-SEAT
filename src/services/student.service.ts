import { Gender, Prisma, StudentStatus } from "@prisma/client";
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "./audit.service";

export interface StudentInput {
  name: string;
  rollNumber: string;
  registerNumber: string;
  gender: Gender;
  classId: string;
  status: StudentStatus;
}

export interface ListStudentsOptions {
  search?: string;
  departmentId?: string;
  classId?: string;
  status?: StudentStatus;
  limit?: number;
  offset?: number;
}

const GENDER_VALUES = Object.values(Gender) as string[];
const STATUS_VALUES = Object.values(StudentStatus) as string[];

export function assertGender(value: unknown): asserts value is Gender {
  if (typeof value !== "string" || !GENDER_VALUES.includes(value)) {
    throw new SeatingError("gender must be one of MALE, FEMALE, OTHER", "INVALID_INPUT");
  }
}

export function assertStudentStatus(value: unknown): asserts value is StudentStatus {
  if (typeof value !== "string" || !STATUS_VALUES.includes(value)) {
    throw new SeatingError(
      "status must be one of ACTIVE, INACTIVE, PASSED_OUT, TRANSFERRED",
      "INVALID_INPUT",
    );
  }
}

export function assertStudentInput(input: Partial<StudentInput>): void {
  if (input.name !== undefined && String(input.name).trim().length === 0) {
    throw new SeatingError("name must not be empty", "INVALID_INPUT");
  }
  if (input.rollNumber !== undefined && String(input.rollNumber).trim().length === 0) {
    throw new SeatingError("rollNumber must not be empty", "INVALID_INPUT");
  }
  if (input.registerNumber !== undefined && String(input.registerNumber).trim().length === 0) {
    throw new SeatingError("registerNumber must not be empty", "INVALID_INPUT");
  }
  if (input.gender !== undefined) assertGender(input.gender);
  if (input.status !== undefined) assertStudentStatus(input.status);
  if (input.classId !== undefined && String(input.classId).trim().length === 0) {
    throw new SeatingError("classId must not be empty", "INVALID_INPUT");
  }
}

const STUDENT_SELECT = {
  id: true,
  name: true,
  rollNumber: true,
  registerNumber: true,
  gender: true,
  status: true,
  classId: true,
  createdAt: true,
  updatedAt: true,
  class: {
    select: {
      id: true,
      name: true,
      year: true,
      section: true,
      academicYear: true,
      department: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

export async function listStudents(options: ListStudentsOptions = {}) {
  const { search, departmentId, classId, status, limit = 50, offset = 0 } = options;

  const where: Prisma.StudentWhereInput = {};
  if (search !== undefined && search.trim().length > 0) {
    const needle = search.trim();
    where.OR = [
      { name: { contains: needle, mode: "insensitive" } },
      { registerNumber: { contains: needle, mode: "insensitive" } },
      { rollNumber: { contains: needle, mode: "insensitive" } },
    ];
  }
  if (departmentId !== undefined && departmentId.length > 0) {
    where.class = { departmentId };
  }
  if (classId !== undefined && classId.length > 0) {
    where.classId = classId;
  }
  if (status !== undefined) {
    assertStudentStatus(status);
    where.status = status;
  }

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      select: STUDENT_SELECT,
      orderBy: { registerNumber: "asc" },
      skip: offset,
      take: limit,
    }),
  ]);

  return { total, students };
}

export async function getStudent(id: string) {
  const student = await prisma.student.findUnique({ where: { id }, select: STUDENT_SELECT });
  if (!student) throw new SeatingError("Student not found", "STUDENT_NOT_FOUND");
  return student;
}

async function assertStudentClassExists(classId: string): Promise<void> {
  const cls = await prisma.class.findUnique({ where: { id: classId } });
  if (!cls) throw new SeatingError("Class not found", "CLASS_NOT_FOUND");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createStudent(input: StudentInput, actorId?: string) {
  assertStudentInput(input);
  await assertStudentClassExists(input.classId);
  try {
    const student = await prisma.student.create({
      data: {
        name: input.name.trim(),
        rollNumber: input.rollNumber.trim(),
        registerNumber: input.registerNumber.trim(),
        gender: input.gender,
        classId: input.classId,
        status: input.status,
      },
    });
    await logAudit({
      action: "STUDENT_CREATED",
      entityType: "Student",
      entityId: student.id,
      actorId,
      metadata: { registerNumber: student.registerNumber, classId: student.classId },
    });
    return getStudent(student.id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SeatingError("Student register number already exists", "STUDENT_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function updateStudent(id: string, patch: Partial<StudentInput>, actorId?: string) {
  await getStudent(id);
  assertStudentInput(patch);
  if (patch.classId !== undefined) {
    await assertStudentClassExists(patch.classId);
  }
  try {
    const student = await prisma.student.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.rollNumber !== undefined ? { rollNumber: patch.rollNumber.trim() } : {}),
        ...(patch.registerNumber !== undefined
          ? { registerNumber: patch.registerNumber.trim() }
          : {}),
        ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
        ...(patch.classId !== undefined ? { classId: patch.classId } : {}),
      },
    });
    await logAudit({
      action: "STUDENT_UPDATED",
      entityType: "Student",
      entityId: id,
      actorId,
      metadata: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.registerNumber !== undefined ? { registerNumber: patch.registerNumber } : {}),
        ...(patch.classId !== undefined ? { classId: patch.classId } : {}),
      },
    });
    return getStudent(student.id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SeatingError("Student register number already exists", "STUDENT_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function changeStudentStatus(id: string, status: StudentStatus, actorId?: string) {
  await getStudent(id);
  assertStudentStatus(status);
  const student = await prisma.student.update({ where: { id }, data: { status } });
  await logAudit({
    action: "STUDENT_STATUS_CHANGED",
    entityType: "Student",
    entityId: id,
    actorId,
    metadata: { status: student.status },
  });
  return getStudent(student.id);
}