import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { SeatingError } from "../errors";
import { logAudit } from "./audit.service";

export interface DepartmentInput {
  code: string;
  name: string;
}

export function assertDepartmentInput(input: Partial<DepartmentInput>): void {
  if (input.code !== undefined) {
    const code = String(input.code).trim();
    if (code.length === 0) {
      throw new SeatingError("department code must not be empty", "INVALID_INPUT");
    }
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(code)) {
      throw new SeatingError("invalid department code", "INVALID_INPUT");
    }
  }
  if (input.name !== undefined && String(input.name).trim().length === 0) {
    throw new SeatingError("department name must not be empty", "INVALID_INPUT");
  }
}

export async function listDepartments() {
  return prisma.department.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getDepartment(id: string) {
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) throw new SeatingError("Department not found", "DEPARTMENT_NOT_FOUND");
  return department;
}

export async function createDepartment(input: DepartmentInput, actorId?: string) {
  assertDepartmentInput(input);
  try {
    const department = await prisma.department.create({
      data: { code: input.code.trim(), name: input.name.trim() },
    });
    await logAudit({
      action: "DEPARTMENT_CREATED",
      entityType: "Department",
      entityId: department.id,
      actorId,
      metadata: { code: department.code },
    });
    return department;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SeatingError("Department code already exists", "DEPARTMENT_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function updateDepartment(id: string, patch: Partial<DepartmentInput>, actorId?: string) {
  await getDepartment(id);
  assertDepartmentInput(patch);
  try {
    const department = await prisma.department.update({
      where: { id },
      data: {
        ...(patch.code !== undefined ? { code: patch.code.trim() } : {}),
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      },
    });
    await logAudit({
      action: "DEPARTMENT_UPDATED",
      entityType: "Department",
      entityId: id,
      actorId,
      metadata: {
        ...(patch.code !== undefined ? { code: patch.code } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
      },
    });
    return department;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SeatingError("Department code already exists", "DEPARTMENT_ALREADY_EXISTS");
    }
    throw error;
  }
}