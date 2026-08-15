/**
 * Authorization guards. Authentication/authorization runs BEFORE any routing
 * so an unauthenticated request can never reach candidate processing,
 * partitioning, CP-SAT dispatch, or persistence.
 */
import type { AuthUser } from "./session";

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function requireAuth(user: AuthUser | null): AuthUser {
  if (!user) {
    throw new AuthError(401, "authentication required", "UNAUTHORIZED");
  }
  return user;
}

export function requireRole(user: AuthUser | null, role: "ADMIN" | "STAFF"): AuthUser {
  const authed = requireAuth(user);
  if (authed.role !== role) {
    throw new AuthError(403, `role ${role} required`, "FORBIDDEN");
  }
  return authed;
}

export function requireAdmin(user: AuthUser | null): AuthUser {
  return requireRole(user, "ADMIN");
}