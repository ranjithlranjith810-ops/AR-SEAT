# Phase 16 — Closeout

## Root Cause

The "in-flight backend regression" was a **stale regression**: two earlier
`npm test` runs were truncated by the 600-second tool timeout (the full
backend suite takes ~690s). No failure had been observed before truncation.
The Phase 16 ADMIN audit-read surface was already correct; targeted and full
suite runs both pass. Classification: **H — Already fixed / stale regression**.

## Fix

No code change was required. The Phase 16 backend regression is confirmed
green as implemented.

## Files Changed (by this task)

None. Only evidence documents were written under `docs/evidence/phase16/`:

- `phase16-root-cause.md` (new)
- `phase16-regression-test.log` (new)
- `phase16-full-test.log` (new)
- `phase16-verification.log` (new)
- `phase16-typecheck.log` (new)
- `phase16-frontend-tests.log`, `phase16-frontend-typecheck.log`, `phase16-frontend-build.log` (new)
- `phase16-e2e.log` (new)
- `phase16-git-status.log`, `phase16-git-diff-stat.log`, `phase16-git-log.log` (new)

Pre-existing Phase 16 evidence (`phase16-audit-schema-inventory.md`,
`phase16-audit-write-inventory.md`, `phase16-preflight-git.log`,
`phase16-read-audit-decision.md`) was left intact.

## Verification

| Gate | Result |
|---|---|
| Targeted Phase 16 regression (`tests/phase16-audit-read.test.ts`) | 26/26 PASS (31.8s) |
| Full backend suite (`npm test`, Supabase `exam_seating_test`) | 215 passed / 3 skipped, 28 files + 1 skipped, exit 0 |
| Root typecheck (`npm run typecheck`) | PASS |
| Frontend test suite | 9 files / 106 tests PASS |
| Frontend typecheck | PASS |
| Frontend production build | PASS |
| E2E Playwright (`run-e2e.mjs`, fresh local docker `*_test` DB) | 10/10 PASS (audit-read 3, auth 3, golden-path 1, role-gating 3) |

## Auth Baseline (existing authentication regression)

Re-run via `e2e/specs/auth.spec.ts` (3/3) plus the broader suite:

- unauthenticated deep links redirect to login — PASS
- unauthenticated API requests rejected 401 — PASS
- admin login then logout clears the session (poll to 401) — PASS
- STAFF role boundary (no admin nav, admin routes blocked, upload rejected) — PASS
- Phase 16 audit-read ADMIN/STAFF gating — PASS

## Security / Architecture

Confirmed unchanged and not weakened:

- No auth bypass.
- No RBAC weakening (STAFF remains denied: 403 on audit-logs API, blocked
  routes, no admin navigation).
- No RLS bypass.
- No tenant isolation weakening.
- No fake data/state; tests run against the isolated Supabase
  `exam_seating_test` DB (guard-verified via `verifyTestDatabase`), E2E against
  a fresh local Docker `*_test` DB with scrubbed env.
- No unrelated architecture change; `GET /exam-seating/audit-logs` remains
  read-only (count/findMany + one bounded user lookup), never exposes
  `metadata`, deterministic `createdAt DESC, id DESC` order, sanitized 400s.
- Frontend auth Fast Refresh fix (verified baseline) untouched and re-verified
  green by the frontend suite/typecheck/build and E2E.

## Git State

```text
committed: NO
pushed: NO
HEAD: d3b6d5696b9e7f962f72b4862ec6e41f10722ae4 (feat: add Phase 14 E2E browser harness)
uncommitted Phase 16 work:
  - src/phase4/api.ts                 (GET /exam-seating/audit-logs + constants + serializer)
  - tests/phase16-audit-read.test.ts  (26 tests)
  - frontend AuditPage.tsx/.test.tsx, lib/types.ts, lib/api.ts, lib/api.test.ts,
    App.tsx, Layout.tsx, styles.css
  - e2e/specs/audit-read.spec.ts, e2e/helpers.ts, scripts/e2e/seed.mjs
  - docs/evidence/phase16/ (inventory + decision + this closeout)
unrelated pre-existing changes (not Phase 16, still uncommitted):
  - frontend auth Fast Refresh fix (auth-context.ts, AuthContext.tsx,
    harness.tsx, AuthAndLogin.test.tsx, UploadPage.test.tsx)
  - e2e/specs/auth.spec.ts (logout-poll robustness)
  - scripts/dev-all.mjs + package.json dev:all script
  - tests/phase4-ingestion-e2e.test.ts
  - pre-existing evidence dirs (phase12/13/7a/8b/phase3/4-benchmarks, etc.)
  - test-results/ (playwright artifacts)
```

## Final Status

```text
PHASE 16 — COMPLETE
```

Phase 16 is complete: regression classified, no fix required, full verification
green, evidence captured, nothing committed or pushed. The Core-Inventory Gate
is the next task per the roadmap.
