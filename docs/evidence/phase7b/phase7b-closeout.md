# Phase 7b — API Internal Error Disclosure Hardening

Date: 2026-08-15
Classification: **VERIFIED + FIXED** (single top-level error boundary)

## Objective
Prevent unexpected server-side exceptions from exposing internal
implementation details (filesystem paths, Prisma errors, schema/table names,
stack traces) through HTTP responses. Client receives a generic 500; the full
diagnostic remains available server-side.

## Confirmed finding (Phase 7a probe environment)
A request carrying a session cookie against a nonexistent route surfaced a 500
whose `message` leaked Prisma internals: `prisma.authSession.findUnique
failed: table public.auth_sessions does not exist at D:\secrets\schema.prisma
line 42` — internal filesystem path, source file/line, Prisma method, table
name, schema info. Independently reproducible; the API's catch block echoed
`error.message` to the client. (`error-disclosure-before.log` reproduces this
deterministically with a forced exception.)

## Additional investigation (pre-implementation)

### 1. Solver-service (FastAPI) equivalent risk — one-line finding
`app/main.py` uses `FastAPI(...)` with default `debug=False`, no custom
exception handler, no openapi docs. Starlette's default `ServerErrorMiddleware`
returns only `{"detail": "Internal Server Error"}` for unhandled exceptions and
logs the traceback server-side (uvicorn logger). **No equivalent disclosure
risk in the default configuration — no Phase 7c needed.** If a custom
exception handler or `debug=True` is ever added, this should be re-checked.

### 2. The project's existing logging mechanism (recorded honestly)
The Node API (`src/`) has **no structured logger**. The only existing
mechanisms are: (a) ad-hoc `console.log`/`console.error` output (convention in
`prisma/seed.ts:128,136`, `scripts/guard-parity.ts:170`, `scripts/benchmark-
parallel.ts:190`) and (b) `logAudit()` (`src/services/audit.service.ts`) — a DB
audit trail for business actions, unsuitable for arbitrary exceptions (it would
itself fail when the DB/Prisma layer is the thing that threw, and it persists
to a table rather than a diagnostics sink). The boundary therefore logs via
`console.error("[api] unexpected error", error)` — the platform-native
diagnostics sink already used in the repo. This satisfies "server-side
diagnostics remain available": the full Error object incl. stack is emitted to
stderr and captured by the process manager. **Note:** this is ad hoc, not
structured; if structured/centralized logging is adopted later, the single
`console.error` call site is the one place to route through it.

## Implementation
`src/phase4/api.ts` — the existing single top-level `try/catch` around
`handleRequest` is the error boundary. Change (2 lines):

- Before: `const message = error instanceof Error ? error.message : String(error);
  json(res, 500, { error: "INTERNAL_ERROR", message });`
- After: `console.error("[api] unexpected error", error);
  json(res, 500, { error: "INTERNAL_ERROR", message: "An unexpected error occurred" });`

`AuthError` (401/403) handling is untouched — known application errors keep
their contract. No other route/status semantics changed.

## Verification

### Before vs after (same deterministic probe)
`error-disclosure-before.log` (pre-fix, current code):
- forced unexpected exception, valid session → **500**, body leaked
  `prisma.authSession`, `auth_sessions`, `schema.prisma`, `D:\secrets`, `at `
  (stack text) in `message`.

`error-disclosure-after.log` (post-fix):
- forced unexpected exception, valid session → **500**, body exactly
  `{"error":"INTERNAL_ERROR","message":"An unexpected error occurred"}` — zero
  leak markers in the client body.
- server-side (stderr): `[api] unexpected error Error: prisma.authSession...
  at ThrowingRegistry.get (...) at handleRequest (...)` — full diagnostics
  retained.
- known 404 (`GENERATION_NOT_FOUND`) unchanged; unauthenticated 401
  (`UNAUTHORIZED`) unchanged.

### Regression test
`tests/api-error-sanitization.test.ts` (4 tests, `error-sanitization-test.log`,
passed in isolation 4/4 and inside the full suite):
1. valid authenticated request reaches the handler (200 `/auth/me`).
2. forces an unexpected exception inside the request path (authenticated
   `GET /exam-seating/generations/forcing-id`, registry throws) → **500**,
   `error === "INTERNAL_ERROR"`, generic message, body contains NONE of the
   injected message / fake path / stack / Prisma markers, AND asserts the real
   exception reached `console.error` (server-side diagnostics preserved).
3. known 404 missing-resource contract unchanged.
4. unauthenticated 401 contract unchanged.

### Full regression
- pytest (solver-service `.venv`): **98 passed, 1 warning** (`pytest.log`, exit 0).
- typecheck (`tsc --noEmit`): **clean** (`typecheck.log`, exit 0).
- npm test (full suite, isolated test DB): **20 files passed / 1 skipped,
  139 passed / 3 skipped** (`npm-test.log`, exit 0). Includes phase5-auth 7/7
  (existing auth/authz tests unchanged), phase4-orchestration 26/26,
  phase4-ingestion-e2e 1/1, api-error-sanitization 4/4.
  - Note: the first full-suite attempt was killed by the harness at ~11.6 min
    mid-run with no summary (Supabase pooler latency, same infra pattern as
    Phase 6); the rerun completed green in 655 s. The pre-existing
    `storage-integration` file remains skipped (3) as it requires Supabase
    storage credentials — unchanged from baseline.
- Phase 4 orchestration tests (unfiltered): **26 passed / 26** (`orchestration-test.log`, exit 0).
- Frozen solver files: byte-identical (`frozen-file-diff.log`, exit 0).

### Change surface
- Modified: `src/phase4/api.ts` (+2/−2).
- Added: `tests/api-error-sanitization.test.ts`.
- Evidence: `docs/evidence/phase7b/` (logs gitignored; this close-out tracked if
  committed).

## STOP conditions — none triggered
1. Single safe error boundary existed and was strengthened — no unrelated
   behavior change.
2. Known 401/403/404/validation contracts unchanged (asserted by tests).
3. No frozen solver files touched.
4. No unexplained test failure; the one killed run was infra latency and the
   rerun passed fully.
5. The logging mechanism (`console.error`) exposes nothing to clients.

## Acceptance criteria — all met
- [x] Unexpected exceptions return generic HTTP 500.
- [x] Internal exception details not returned to clients.
- [x] Server-side diagnostics remain available (console.error, verified).
- [x] Regression test proves sanitization.
- [x] Existing auth/authorization behavior unchanged.
- [x] npm test passes (139/142, 3 baseline skips).
- [x] typecheck passes.
- [x] pytest passes (98).
- [x] Frozen solver files unchanged.
- [x] Evidence captured.
- [ ] Nothing committed without explicit instruction — NOT COMMITTED.

## Recommendation (non-blocking)
The `SeatingError: No PUBLISHED seating plan` path (observed in the phase5-auth
stderr during the suite) now logs server-side instead of echoing the message to
the client — status unchanged (500). If a future phase wants a cleaner contract,
`PLAN_NOT_FOUND` could become an intentional 404 with `{ error: "PLAN_NOT_FOUND" }`
mapped in the boundary; that is a deliberate contract decision, out of scope here.