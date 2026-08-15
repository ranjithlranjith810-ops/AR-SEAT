/**
 * Server-side authenticated sessions for the minimal single-institution
 * authentication layer.
 *
 * A cryptographically random token is delivered to the browser in an HTTP-only
 * cookie; only its SHA-256 hash is persisted, so a database leak cannot be used
 * to impersonate sessions. Expiration is enforced on every resolution and the
 * expired row is removed.
 */
import { createHash, randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { prisma } from "../../db";

export const SESSION_COOKIE = "ar_seat_session";
export const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface ResolvedSession {
  token: string;
  user: AuthUser;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function secureFlag(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionCookieHeader(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureFlag()}`;
}

export function expiredSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

export function readSessionToken(req: import("node:http").IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === SESSION_COOKIE && value.length > 0) return value;
  }
  return null;
}

export async function createSession(
  userId: string,
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await prisma.authSession.create({
    data: { userId, tokenHash: tokenHash(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function resolveSession(token: string | null): Promise<ResolvedSession | null> {
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return {
    token,
    user: { id: session.user.id, username: session.user.username, role: session.user.role },
  };
}

export async function destroySession(token: string | null): Promise<void> {
  if (!token) return;
  await prisma.authSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
}

export async function cleanupExpiredSessions(now = Date.now()): Promise<number> {
  const deleted = await prisma.authSession.deleteMany({
    where: { expiresAt: { lt: new Date(now) } },
  });
  return deleted.count;
}