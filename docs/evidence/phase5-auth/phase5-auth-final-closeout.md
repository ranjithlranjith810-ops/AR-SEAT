# Phase 5 — Auth Finalization, Secret-Evidence Audit & Commit/Push Close-Out

**Status:** CASE B — VERIFIED WITH NOTED EXCEPTIONS
**Date:** 2026-08-15
**Phase 5 commit:** `7280d16` (`feat: add single-tenant authentication and seating API protection`)
**Concurrency commit:** `407942c` (`fix: enable concurrent solver-domain execution`) — pushed unchanged
**Final HEAD:** `981df0ae7f6f4ecbcd71adfe21a08439081dd6ff`
**origin/main:** `981df0ae7f6f4ecbcd71adfe21a08439081dd6ff` (HEAD == origin/main)

---

## 1. Git provenance

| Item | Value |
|---|---|
| Phase 5 commit | `7280d16e49b96517f760dac33393045e682020c5` |
| Concurrency commit | `407942c586eaf6189230616e3a9fb14be70d6398` |
| Final HEAD | `981df0ae7f6f4ecbcd71adfe21a08439081dd6ff` |
| origin/main | `981df0ae7f6f4ecbcd71adfe21a08439081dd6ff` |
| Pushes | `ec2a170..7280d16` → `7280d16..42fc690` → `42fc690..981df0a` (all exit 0, fast-forward) |
| Working tree | No tracked modifications; `git diff origin/main` empty |

History after push:

```text
981df0a docs: update final close-out provenance to final HEAD
42fc690 docs: record phase 5 finalization close-out
7280d16 feat: add single-tenant authentication and seating API protection
407942c fix: enable concurrent solver-domain execution
ec2a170 feat: phase 4 production orchestration - reconciliation, workers, e2e, failure tests, proforma pagination
82670fc docs: record final post-commit state for seat-label engine milestone
0583fb0 feat: session & physical-domain partitioned seating engine (phase A-E)
```

Commit `7280d16` contains exactly 11 files (all Phase 5): `docs/evidence/phase5-auth/phase5-auth-closeout.md`,
`prisma/migrations/20260815170000_add_auth/migration.sql`, `prisma/schema.prisma`,
`scripts/bootstrap-admin.mjs`, `src/phase4/api.ts`, `src/phase4/auth/{guards,password,session,users}.ts`,
`tests/helpers.ts`, `tests/phase5-auth.test.ts` — 921 insertions, 8 deletions.

**Remaining untracked files** (pre-existing, unrelated to Phase 5, intentionally NOT committed):
`docs/evidence/phase3-benchmarks/*` (12 logs), `docs/phase3-discovery.md`,
`docs/evidence/phase4-benchmarks/`, `tests/phase4-ingestion-e2e.test.ts` (the Phase 4 §24
real-ingestion E2E test, left uncommitted in the Phase 4 milestone), and the stray
`eating prototype✎` file. These predate this task. `tests/phase4-ingestion-e2e.test.ts` is
recorded as a recommended separate Phase 4 provenance follow-up (its test is part of the
132-test suite but was never committed).

## 2. Security verification

### Secret audit — `SECRET_AUDIT = CLEAN`

Inspected all files under `docs/evidence/phase5-auth/` for plaintext passwords,
bootstrap-admin credentials, session/bearer tokens, cookie values, `Set-Cookie`
payloads, Authorization headers, DB credentials, connection strings, API keys, JWTs,
and long random token-looking strings.

- No JWT-like (`eyJ...`) strings.
- No `ar_seat_session=` cookie values (no real session tokens captured in logs).
- No 43-char base64url session-token strings, no 64-hex token hashes.
- No `postgres://` connection strings, Supabase keys, or `.env` material
  (only the Prisma datasource hostname `aws-0-ap-south-1.pooler.supabase.com:5432`
  appears in migration output — a host reference, not a credential).
- Test credentials (`phase5-admin` / `phase5-admin-password-1`,
  `phase5-staff-password-1`) are synthetic fixtures and do NOT appear anywhere in the
  evidence logs. The bootstrap script reads `ADMIN_USERNAME`/`ADMIN_PASSWORD` from the
  environment; no password is hard-coded or logged.

### Cookie security — verified against implementation (`src/phase4/auth/session.ts`)

| Attribute | Value |
|---|---|
| Name | `ar_seat_session` |
| COOKIE_HTTP_ONLY | YES |
| COOKIE_SECURE | YES when `NODE_ENV=production` (adds `; Secure`), NO otherwise — environment-appropriate for non-HTTPS local dev; not changed |
| COOKIE_SAMESITE | `Lax` |
| COOKIE_PATH | `/` |
| COOKIE_EXPIRY | `Max-Age=86400` (24h default) + server-side `expiresAt` enforced on every resolve (expired row deleted); logout sets `Max-Age=0` |

Only the SHA-256 hash of the token is persisted; the plaintext token is delivered
once via the HttpOnly cookie and never stored.

### CSRF posture — `CSRF_STATUS = MITIGATED_BY_SAMESITE`

State-changing endpoints (`POST /auth/login`, `POST /auth/logout`,
`POST /exam-seating/generations`). No Origin/Referer validation, no CSRF token
mechanism, and no CORS configuration exists. Mitigation comes from
`SameSite=Lax` on the session cookie: cross-site POST requests (the CSRF vector for
these endpoints) do not carry the cookie. Recorded as a security follow-up:
a dedicated CSRF token or Origin header check for the generation endpoint is the
recommended hardening, deliberately not expanded in this task.

## 3. Authorization behavior

`STAFF_GENERATION_POLICY = ADMIN_ONLY` — explicitly encoded in the API guard
`requireAdmin(user)` for `POST /exam-seating/generations` (`src/phase4/api.ts:85`),
not merely a test assumption. STAFF view/status via `requireAuth` on the GET routes.
Tests agree (Test D: STAFF create → 403, STAFF view → 200).

> STAFF generation remains ADMIN-only in the current release. This is an intentional
> authorization policy and is not treated as an implementation defect.

Authentication behavior: scrypt (node:crypto) hashing with per-user salt and
`timingSafeEqual`; no new dependency; 401 `UNAUTHENTICATED`/`INVALID_SESSION`,
403 `FORBIDDEN`; structured errors only; auth resolved before routing so
unauthenticated traffic never reaches candidate processing/partition/CP-SAT/persistence.

## 4. Test results (re-run during finalization)

| Suite | Result | Baseline |
|---|---|---|
| Phase 5 auth (`tests/phase5-auth.test.ts`, dedicated) | **7 passed / 0 failed** (A–G) | 7/7 |
| Full npm suite (`npm test`) | **19 files passed / 1 skipped; 132 passed / 3 skipped** | 132/3 |
| Typecheck (`npm run typecheck`) | **clean (exit 0)** | clean |
| pytest (`solver-service`, `pytest -q`) | **85 passed / 0 failed** | 85 |
| Orchestration (dedicated, unfiltered) | **23 passed / 0 skipped** | 23/0 |

No count drift vs baseline. The 3 skipped tests remain the live Supabase Storage suite
(`STORAGE_INTEGRATION` not set). Evidence: `final-npm-test.log`, `final-pytest.log`,
`final-typecheck.log`, `final-auth-test.log`, `final-orchestration.log` under
`docs/evidence/phase5-auth/`.

## 5. Scope

- **CP-SAT solver untouched** — `seatlabel.py`, `solver.py`, `graph.py`, `partition.py`,
  `guards.py`, `validation.py` byte-identical to HEAD (diff exit 0).
- **Concurrency implementation untouched** — `main.py` unchanged since `407942c`
  (diff exit 0; last modified by that commit).
- **No unrelated feature changes** — commit `7280d16` contains only Phase 5 auth
  implementation, its migration, tests, and evidence documentation.

## 6. Known exceptions (verified to remain true)

1. **Password reset / verification / MFA not implemented** — provisioning is via the
   user service and `scripts/bootstrap-admin.mjs`; documented as non-blocking for this
   minimal auth layer.
2. **Fixed session expiry** — 24h `Max-Age` + DB-side `expiresAt`; no sliding renewal.
3. **STAFF generation remains ADMIN-only** — intentional release policy (see §3).
4. **`PLAN_NOT_FOUND` → HTTP 500** — pre-existing Phase 4 API defect
   (`getSeatingPlanForExam` throws `PLAN_NOT_FOUND`; the API catch maps non-auth errors
   to `INTERNAL_ERROR`). `PRE_EXISTING_API_DEFECT`; recorded as a separate follow-up:
   *"`PLAN_NOT_FOUND` should return an appropriate 404/not-found response instead of 500."*
   Intentionally not fixed during Phase 5 (out of auth scope; verified unchanged).
5. **Single-institution / single-tenant model** — no `workspace_id`/`tenant_id`/
   `institution_id` columns; documented design, no multi-tenancy introduced.

## 7. Classification

**CASE B — VERIFIED WITH NOTED EXCEPTIONS.**

All required finalization checks pass: secret audit CLEAN, cookie flags and expiry
verified, CSRF posture documented (MITIGATED_BY_SAMESITE), STAFF policy confirmed as
intentional, `PLAN_NOT_FOUND` recorded as a separate pre-existing defect, full
regression green (npm 132/3, typecheck clean, pytest 85, orchestration 23/23, auth
7/7), frozen solver and concurrency implementation byte-identical, Phase 5 committed
as its own commit, both verified commits pushed, and HEAD == origin/main with no
tracked modifications.

Classified CASE B rather than CASE A because, although every required check passed and
all remaining items are documented non-blocking limitations, the milestone
intentionally leaves a known pre-existing API defect (`PLAN_NOT_FOUND` → 500) and a
CSRF mitigation that relies on `SameSite=Lax` only (no dedicated token/Origin check).
Per the rule "do not claim CASE A merely because tests are green," these noted
exceptions keep the classification at CASE B.

## 8. Follow-up recommendations

1. Phase 4 provenance gap: commit `tests/phase4-ingestion-e2e.test.ts` (and Phase 4
   evidence) as a separate Phase 4 follow-up commit.
2. `PLAN_NOT_FOUND` → 404 for the seating endpoint.
3. Optional hardening: Origin check or CSRF token for the generation endpoint;
   password reset flow; sliding session renewal when a real UI is added.