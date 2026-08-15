/**
 * User records + credential verification for the minimal authentication layer.
 */
import type { UserRole } from "@prisma/client";
import { prisma } from "../../db";
import { SeatingError } from "../../errors";
import { hashPassword, verifyPassword } from "./password";
import type { AuthUser } from "./session";

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
  email?: string;
}

export async function createUser(input: CreateUserInput) {
  if (input.password.length < 8) {
    throw new SeatingError("password must be at least 8 characters", "WEAK_PASSWORD");
  }
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(input.username)) {
    throw new SeatingError("invalid username", "INVALID_USERNAME");
  }
  return prisma.user.create({
    data: {
      username: input.username,
      email: input.email ?? null,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    },
    select: { id: true, username: true, email: true, role: true, createdAt: true },
  });
}

export async function verifyCredentials(username: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, username: user.username, role: user.role };
}

export function publicUser(user: AuthUser) {
  return { id: user.id, username: user.username, role: user.role };
}