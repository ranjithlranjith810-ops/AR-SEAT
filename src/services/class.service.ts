import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "./audit.service";

export interface ClassInput {
  departmentId: string;
  name: string;
  year: number;
  section: string;
  academicYear: string;
}

export interface ListClassesOptions {
  departmentId?: string;
}

export function assertClassInput(input: Partial<ClassInput>): void {
  if (input.name !== undefined && String(input.name).trim().length === 0) {
    throw new SeatingError("class name must not be empty", "INVALID_INPUT");
  }
  if (input.section !== undefined && String(input.section).trim().length === 0) {
    throw new SeatingError("section must not be empty", "INVALID_INPUT");
  }
  if (input.year !== undefined && (!Number.isInteger(input.year) || input.year < 1 || input.year > 10)) {
    throw new SeatingError("year must be an integer between 1 and 10", "INVALID_INPUT");
  }
  if (input.academicYear !== undefined && String(input.academicYear).trim().length === 0) {
    throw new SeatingError("academicYear must not be empty", "INVALID_INPUT");
  }
  if (input.departmentId !== undefined && String(input.departmentId).trim().length === 0) {
    throw new SeatingError("departmentId must not be empty", "INVALID_INPUT");
  }
}

export async function assertClassDepartmentExists(departmentId: string): Promise<void> {
  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) throw new SeatingError("Department not found", "DEPARTMENT_NOT_FOUND");
}

export async function listClasses(options: ListClassesOptions = {}) {
  return prisma.class.findMany({
    where: options.departmentId ? { departmentId: options.departmentId } : undefined,
    orderBy: [{ departmentId: "asc" }, { name: "asc" }],
    include: {
      department: { select: { id: true, code: true, name: true } },
    },
  });
}

export async function getClass(id: string) {
  const cls = await prisma.class.findUnique({
    where: { id },
    include: { department: { select: { id: true, code: true, name: true } } },
  });
  if (!cls) throw new SeatingError("Class not found", "CLASS_NOT_FOUND");
  return cls;
}

export async function createClass(input: ClassInput, actorId?: string) {
  assertClassInput(input);
  await assertClassDepartmentExists(input.departmentId);
  try {
    const cls = await prisma.class.create({
      data: {
        departmentId: input.departmentId,
        name: input.name.trim(),
        year: input.year,
        section: input.section.trim(),
        academicYear: input.academicYear.trim(),
      },
    });
    await logAudit({
      action: "CLASS_CREATED",
      entityType: "Class",
      entityId: cls.id,
      actorId,
      metadata: { name: cls.name, departmentId: cls.departmentId },
    });
    return cls;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SeatingError(
        "Class already exists for this department and academic year",
        "CLASS_ALREADY_EXISTS",
      );
    }
    throw error;
  }
}

export async function updateClass(id: string, patch: Partial<ClassInput>, actorId?: string) {
  await getClass(id);
  assertClassInput(patch);
  if (patch.departmentId !== undefined) {
    await assertClassDepartmentExists(patch.departmentId);
  }
  try {
    const cls = await prisma.class.update({
      where: { id },
      data: {
        ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}),
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.year !== undefined ? { year: patch.year } : {}),
        ...(patch.section !== undefined ? { section: patch.section.trim() } : {}),
        ...(patch.academicYear !== undefined ? { academicYear: patch.academicYear.trim() } : {}),
      },
    });
    await logAudit({
      action: "CLASS_UPDATED",
      entityType: "Class",
      entityId: id,
      actorId,
      metadata: {
        ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
      },
    });
    return cls;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SeatingError(
        "Class already exists for this department and academic year",
        "CLASS_ALREADY_EXISTS",
      );
    }
    throw error;
  }
}