# AR-SEAT Security Inventory

Scope: authentication, authorization, secret handling, input validation, tenant isolation, and audit — as actually implemented at HEAD `d3b6d56`.

## 1. Authentication (VERIFIED)

- **Password hashing:** argon2 (`src/auth/`). No plaintext or reversible storage; seeded users hashed at seed time.
- **Sessions:** `AuthSession` rows with expiry; `httpOnly` session cookie set on login, destroyed on logout. `GET /auth/me` restores session. Tests + `e2e/specs/auth.spec.ts` (3 specs) cover login/logout/me.
- **Default admin/staff:** seeded via `scripts/e2e/seed.mjs` for E2E and `prisma/seed.ts` path for dev; documented in `.env.example` surface (credentials are prototype defaults — flagged as P3 hardening, see gap-register).

## 2. Authorization / RBAC (VERIFIED)

- Backend guards `requireAuth` / `requireAdmin` applied per-route in `src/phase4/api.ts` — **backend is the source of truth**; frontend nav hiding for STAFF is cosmetic only (`Layout.tsx`).
- `e2e/specs/role-gating.spec.ts` (3 specs) verifies STAFF is denied on ADMIN routes (403).
- All mutating routes (generate, approve, publish, upload, resolve) are ADMIN-gated; read routes are auth-gated.

## 3. Input validation & transport

- PDF upload: 20 MB size cap + `%PDF` magic-byte check before storage/parse.
- ID params validated → 400 on malformed; `SeatingError` codes map to consistent HTTP statuses (400/403/404/409).
- Solver gateway: `X-Internal-Token` header check (401), 413 body-size limit on `/solve` and `/solve-domain` in `solver-service/app/main.py`. Token lives in server env, never logged.

## 4. Secrets & environment (VERIFIED)

- `.env`/`.env.example`: `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=exam-documents`, solver token, `STORAGE_INTEGRATION` opt-in.
- **No secrets committed:** verified `git status` shows no `.env`; `.gitignore` excludes env files. `SUPABASE_SERVICE_ROLE_KEY` and solver token are never written to logs.
- Test DB isolation: `TEST_DATABASE_URL` → `exam_seating_test` (host `aws-0-ap-south-1.pooler.supabase.com`), distinct from dev `postgres` DB; `run-tests.mjs` refuses if dev==test, and `verifyTestDatabase` requires `RUN_TESTS=1` + db name containing `exam_seating_test`. E2E uses a **fail-closed disposable local Docker DB** (`127.0.0.1:55432`, `ar-seat-e2e-db`) with scrubbed env; `run-e2e.mjs` is destructive only to that container.

## 5. Tenant isolation (N/A by design)

- **Single-tenant prototype.** No `tenant_id`/`school_id`/`organizationId` anywhere in schema or src.
- **No PostgreSQL RLS policies** exist in any migration (`row level security`/`POLICY` grep = 0 hits). All access via app-layer Prisma with the app connection string; the DB is not exposed directly.
- Security model = one trusted backend app + cookie sessions + role checks. Acceptable at prototype scope; documented as an architectural boundary for multi-tenant future work (see gap-register P3).

## 6. Audit trail (VERIFIED)

- 11 audit actions written transactionally with their mutations (upload, match, resolve, supersede, solve start/success/fail, generation fail/infeasible, approve, publish).
- `AuditLog` immutable; `metadata` column stores the raw event but the **read API serializes through a strict whitelist** (no raw metadata exposure) — Phase 16.
- `AuditPage.tsx` (ADMIN-only route) renders sanitized log; `e2e/specs/audit-read.spec.ts` (3 specs) + `tests/phase16-audit-read.test.ts` verify.

## 7. Frontend hygiene

- Auth context split (`auth-context.ts`) fixed Fast Refresh identity bug (verified: HMR no longer re-mounts provider; 106/106 frontend tests, Playwright green).
- No tokens/keys embedded in frontend code; all API calls go through `lib/api.ts` with credentials.
- STAFF nav hides admin-only entries (cosmetic; backend still enforces).

## 8. Open items (none critical at prototype scope)

- Default seed credentials are predictable → P3 (rotate/harden before any real deployment).
- No rate limiting on `/auth/login` → P3.
- No RLS/row-scoping (single-tenant) → not a defect today.
- Storage bucket is private; live uploads use service-role key server-side only.