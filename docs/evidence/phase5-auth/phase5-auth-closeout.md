# Phase 5 — Authentication & API Protection: Close-out Report

**Status:** CASE B — VERIFIED WITH NOTED EXCEPTIONS
**Date:** 2026-08-15
**Working tree:** HEAD `407942c` (concurrency fix), origin/main `ec2a170` (1 ahead, NOT_PUSHED)
**Frozen solver files:** unchanged vs HEAD (verified, diff exit 0)

---

## 1. Objective

Add a minimal, single-institution authentication + API protection layer in front of the
verified Phase 4 seating pipeline (`POST /exam-seating/generations` and the generation
status/seating read endpoints), without touching the frozen CP-SAT solver, without
introducing multi-tenancy, and without a second/dependency-based auth system.

## 2. Security boundary

- Boundary modelled as `Authenticated User -> Role -> Single Institution -> Resources`.
- No `workspace_id` / `tenant_id` / `institution_id` columns anywhere. A single
  institution owns all resources (consistent with the single-tenant Phase 4 prototype).

## 3. Authentication method

- `node:crypto` **scrypt** (memory-hard KDF) with a per-user random salt, compared with
  `timingSafeEqual`. Stored format: `scrypt$<saltB64>$<hashB64>`.
- **No new dependency.** `package.json` runtime deps unchanged (only the existing
  `@prisma/client`, `@supabase/supabase-js`, `dotenv`, `pdfjs-dist`).
- **BetterAuth verified absent** (repository audit) — no BetterAuth package, no
  Supabase Auth, no competing auth stack was introduced.
- First ADMIN is created out-of-band via `scripts/bootstrap-admin.mjs`
  (`ADMIN_USERNAME` / `ADMIN_PASSWORD` env). Password never logged.

## 4. Sessions

- HTTP-only cookie `ar_seat_session` (`HttpOnly; Path=/; SameSite=Lax`; no token
  exposure to JS).
- Only a **SHA-256 hash of the session token** is persisted; the plaintext token never
  touches the DB. No password or user secret is stored in the session.
- `AuthSession` row: `tokenHash` (unique), `userId`, `expiresAt`, `createdAt`,
  `lastUsedAt`, `revokedAt`.
- `resolveSession` enforces expiry and **deletes** the expired row on access;
  `destroySession` (logout) marks revoked and deletes; `cleanupExpiredSessions`
  removes expired/revoked rows.
- Logout clears the cookie client-side and invalidates server-side (Test E).

## 5. API protection contract

Auth runs **before routing**: every non-login request is resolved against the session
before any handler runs, so unauthenticated traffic never reaches candidate
processing, partitioning, CP-SAT dispatch, or persistence.

| Endpoint | Rule | Unauthenticated | Insufficient role |
|---|---|---|---|
| `POST /auth/login` | public | — | — |
| `POST /auth/logout` | public | — | — |
| `GET /auth/me` | authenticated | 401 | — |
| `POST /exam-seating/generations` | ADMIN | 401 | 403 |
| `GET /exam-seating/generations/:id` | authenticated | 401 | — |
| `GET /exam-seating/generations/:id/seating` | authenticated | 401 | — |

- Errors use the existing structured format `{ error, message }`; `AuthError` maps to
  401/403 with the error code. No stack traces or internal details are leaked
  (auth codes: `UNAUTHENTICATED`, `INVALID_SESSION`, `FORBIDDEN`).
- Generation requests record `requestedBy` (the authenticated actor's user id).

## 6. Role model (minimal)

- `ADMIN` — create generations, view status, view seating.
- `STAFF` — view status, view seating; **not** permitted to create generations.
  (The spec permits "generate if product permits"; this build keeps generation
  ADMIN-only, which is within scope and covered by Test D.)
- `bootstrap-admin` provisions the single ADMIN. Additional users are created through
  the user service (`createUser`); password hashing is scrypt.

## 7. Non-proliferation guard rails

- No second auth system, no Supabase Auth, no BetterAuth.
- No multi-tenancy columns, no tenant-aware queries introduced.
- RBAC kept to two roles and three guards (`requireAuth`, `requireRole`, `requireAdmin`).

## 8. HTTP-level tests (`tests/phase5-auth.test.ts`, 7/7 pass)

- Test A — unauthenticated requests to every protected endpoint get 401 and never
  reach generation work (state stays idle, no job created).
- Test B — an invalid/forged session token gets 401 (`INVALID_SESSION`).
- Test C — a valid ADMIN login reaches the pipeline gate; a non-validated candidate
  stops the run at `FAILED_RECONCILIATION` / `ERR_CANDIDATE_RECONCILIATION`
  (proves the request passed auth + role and was processed against real pipeline
  guards, not short-circuited).
- Test D — STAFF is forbidden from creating generations (403) but may view a
  generation status (200) and passes the auth gate on the seating endpoint.
- Test E — logout invalidates the session; the old cookie is rejected afterwards.
- Test F — an expired session cannot authorize protected requests (401).
- Test G — wrong credentials rejected with 401 and no session is issued.

Evidence: `auth-regression.log` (auth suite 7/7 within the full run).

## 9. Regression (all green, isolated test DB `exam_seating_test`)

- `npm test` — **19 files passed, 1 skipped; 132 passed, 3 skipped** (3 skipped =
  live Supabase Storage suite, unchanged). Includes `phase4-orchestration` 23/23
  unfiltered, `phase4-ingestion-e2e` 1/1, `phase5-auth` 7/7.
- Dedicated unfiltered `phase4-orchestration` run — **23/23 passed**
  (`auth-orchestration.log`).
- `npm run typecheck` — clean (`auth-typecheck.log`).
- pytest (solver-service) — **85 passed** (`auth-pytest.log`).

## 10. Database safety

- Tracked migration `prisma/migrations/20260815170000_add_auth` (adds `UserRole`
  enum, `users`, `auth_sessions`; unique `tokenHash`, FK to `users`, cascade delete
  of sessions on user delete).
- Applied via `prisma migrate deploy` to the **test database only**. Production
  `DATABASE_URL` untouched; no `db push`; no destructive changes; no data dropped.
- `tests/helpers.ts` now resets `auth_sessions` and `users` between suites.

## 11. Dependency audit

- No package.json changes. Scrypt + SHA-256 come from `node:crypto`. No unsafe or
  unmaintained dependency introduced.

## 12. Concurrency verification

- Authentication is an **entry-gate only**: a per-request session lookup happens
  before routing; it never serializes the generation worker pool or the CP-SAT
  dispatch. No change was made to the concurrency path (`/solve-domain` handler,
  worker pool, or solver threadpool).
- Phase 4 concurrency evidence stands (28/28 overlap window, solver wall/sum ≈ 0.16),
  and the full orchestration suite (which includes the concurrent dispatch tests)
  passes 23/23.

## 13. Frozen solver verification

- `seatlabel.py`, `solver.py`, `graph.py`, `partition.py`, `guards.py`,
  `validation.py`, and `main.py` are byte-identical to HEAD `407942c`
  (`git diff --exit-code HEAD -- <frozen files>` exit 0).

## 14. STOP conditions review

| Condition | Status |
|---|---|
| Existing auth discovered | No — audit logged before implementation (`auth-repository-audit.log`) |
| Destructive schema changes | No |
| User data loss | No |
| Frozen solver modified | No |
| Phase 4 tests failing | No — full suite green |
| Auth serializing solver dispatch | No |
| Undocumented tenancy model | No — single-institution boundary documented |
| Unsafe dependency | No |
| Migration dropping production data | No — additive migration, test DB only |

## 15. Git provenance

- HEAD `407942c586eaf6189230616e3a9fb14be70d6398`, origin/main `ec2a170`, 1 ahead,
  NOT_PUSHED.
- Modified (tracked): `prisma/schema.prisma`, `src/phase4/api.ts`, `tests/helpers.ts`.
- New (untracked): `prisma/migrations/20260815170000_add_auth/`,
  `src/phase4/auth/{password,session,users,guards}.ts`, `scripts/bootstrap-admin.mjs`,
  `tests/phase5-auth.test.ts`, evidence under `docs/evidence/phase5-auth/`.
- Evidence: `auth-git-status.log`, `auth-git-diff-name-only.log`,
  `auth-git-diff-stat.log`, `auth-schema.log`, `auth-implementation.log`.

## 16. Known exceptions / limitations

1. **Route coverage** — this prototype exposes only the generation create/status/
   seating routes over HTTP. Exam upload, publish, regenerate, and Proforma download
   exist at the service layer only (as in Phase 4), so route-level RBAC for them is
   not exercised here. The same auth/role guards are reusable when those routes are
   added.
2. **Account lifecycle** — no password change/reset, no email verification, no
   MFA. Password provisioning is via the user service and the bootstrap script.
3. **Session policy** — fixed expiry (default 8h), enforced on resolve; no sliding
   renewal and no server-side revocation broadcast beyond delete-on-use.
4. **STAFF generation** — left ADMIN-only ("generate if product permits").
5. **Seating endpoint** — a missing PUBLISHED plan surfaces the pre-existing Phase 4
   `PLAN_NOT_FOUND` as 500 (`INTERNAL_ERROR`); this behavior predates auth and was
   intentionally left unchanged. The auth gate itself is proven (401/403 assertions
   in Test D).
6. **HTTPS** — cookie is `HttpOnly`/`SameSite`; TLS termination is deployment
   responsibility (out of scope for this prototype).

## 17. Classification

**CASE B — VERIFIED WITH NOTED EXCEPTIONS.**

All required Phase 5 tests (A–F, plus G) pass, the full regression suite is green
(132 passed / 3 skipped), typecheck and pytest are clean, no solver file changed, no
new dependency, and the migration is additive and test-DB-only. The classification is
CASE B rather than CASE A because of the documented exceptions in §16 (HTTP route
coverage limited to the generation endpoints, no password-reset/verification flows,
fixed session expiry, and STAFF generation disabled) — none of which contradict the
Phase 5 security objective.

## 18. Final state

- Auth + API protection implemented and green.
- Admin bootstrap available via `scripts/bootstrap-admin.mjs`.
- All evidence captured under `docs/evidence/phase5-auth/`:
  `auth-repository-audit.log`, `auth-schema.log`, `auth-implementation.log`,
  `auth-unauthenticated-test.log`, `auth-invalid-session-test.log`,
  `auth-role-test.log`, `auth-logout-test.log`, `auth-expiration-test.log`,
  `auth-regression.log`, `auth-orchestration.log`, `auth-typecheck.log`,
  `auth-pytest.log`, `auth-git-status.log`, `auth-git-diff-stat.log`,
  `auth-git-diff-name-only.log`.
- Working tree is intentionally left uncommitted (no commit requested).