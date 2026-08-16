/**
 * Phase 7b — API internal-error disclosure hardening.
 *
 * The top-level error boundary in src/phase4/api.ts must return a generic 500
 * for unexpected exceptions while keeping the full diagnostic server-side.
 * Internal details (exception message, filesystem paths, Prisma/table/schema
 * text, stack traces) must never reach the client. Known application-error
 * contracts (401/403/404/validation) are intentionally untouched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { prisma } from "./setup";
import { createPhase4Server } from "../src/phase4/api";
import { createUser } from "../src/phase4/auth/users";
import { createSession } from "../src/phase4/auth/session";
import type { GenerationResult, SolverDispatch } from "../src/phase4/types";
import type { Server } from "node:http";

const ADMIN_USERNAME = "phase7b-admin";
const ADMIN_PASSWORD = "phase7b-admin-password-1";
const FORCED_ID = "forcing-id";
const INJECTED_MESSAGE =
  "prisma.authSession.findUnique failed: table public.auth_sessions does not exist at D:\\secrets\\schema.prisma line 42";
const GENERIC_MESSAGE = "An unexpected error occurred";
const LEAK_MARKERS = [
  "prisma.authSession",
  "auth_sessions",
  "schema.prisma",
  "D:\\secrets",
  "forcing-id",
  "at ",
  "Error:",
];

let adminId: string;
let token: string;
let server: Server;
let baseUrl: string;

class ThrowingRegistry extends Map<string, GenerationResult> {
  override get(key: string): GenerationResult | undefined {
    if (key === FORCED_ID) {
      throw new Error(INJECTED_MESSAGE);
    }
    return super.get(key);
  }
}

const dispatch = (async () => {
  throw new Error("solver dispatch must never run in sanitization tests");
}) as unknown as SolverDispatch;

function cookieToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const first = setCookie.split(";")[0]!;
  const eq = first.indexOf("=");
  return eq === -1 ? null : first.slice(eq + 1);
}

async function authedGet(path: string, sessionToken: string | null): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: sessionToken ? { Cookie: `ar_seat_session=${sessionToken}` } : {},
  });
}

describe("phase7b API internal-error sanitization", () => {
  beforeAll(async () => {
    const admin = await createUser({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: "ADMIN" });
    adminId = admin.id;
    const session = await createSession(adminId);
    token = session.token;

    server = createPhase4Server({ registry: new ThrowingRegistry(), dispatch });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("authenticated request to a valid route reaches the handler", async () => {
    const res = await authedGet("/auth/me", token);
    expect(res.status).toBe(200);
    expect((await res.json()) as { user: { username: string } }).toMatchObject({
      user: { username: ADMIN_USERNAME },
    });
  });

  it("forces an unexpected exception and asserts a sanitized generic 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await authedGet(`/exam-seating/generations/${FORCED_ID}`, token);
      expect(res.status).toBe(500);

      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("INTERNAL_ERROR");
      expect(body.message).toBe(GENERIC_MESSAGE);

      const raw = JSON.stringify(body);
      for (const marker of LEAK_MARKERS) {
        expect(raw).not.toContain(marker);
      }
      expect(raw).not.toContain(INJECTED_MESSAGE);

      // Server-side diagnostics remain available via the existing console
      // mechanism: the boundary must log the real exception, not the client-safe
      // summary.
      const logged = errorSpy.mock.calls.some(
        (call) => call[1] instanceof Error && (call[1] as Error).message === INJECTED_MESSAGE,
      );
      expect(logged).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps the known 404 missing-resource contract unchanged", async () => {
    const res = await authedGet("/exam-seating/generations/unknown-id", token);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: "GENERATION_NOT_FOUND",
    });
  });

  it("keeps the unauthenticated 401 contract unchanged", async () => {
    const res = await authedGet("/auth/me", null);
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: "UNAUTHORIZED",
    });
  });
});