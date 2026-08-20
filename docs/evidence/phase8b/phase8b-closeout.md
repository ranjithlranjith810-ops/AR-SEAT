# Phase 8b Close-out — Concurrent Publication Loser HTTP Contract Verification

Date: 2026-08-16
Status: INVESTIGATED — premise false: NO HTTP publication route exists.
No production code changed. Nothing committed.

## Objective
Determine the actual HTTP status/body a losing caller receives when two
authenticated requests attempt to publish competing APPROVED plans for the same
exam concurrently.

## Finding (decisive)
**There is no HTTP publication route in the system.** The premise of 8b — that
publication is exposed over HTTP and a loser can be exercised through it — is
false, exactly like the Phase 7a Proforma-download finding.

- The ONLY HTTP server is `src/phase4/api.ts`. Its full route table
  (`docs/evidence/phase8b/publication-route.log`):
  - `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
  - `POST /exam-seating/generations` (ADMIN)
  - `GET /exam-seating/generations/:id` (auth)
  - `GET /exam-seating/generations/:id/seating` (auth)
  - fallthrough → `404 { error: "NOT_FOUND" }`
- `approvePlan` / `publishPlan` exist ONLY in `src/services/seatingPlan.service.ts`
  and are invoked only from tests (`seating-plan.test.ts`, `snapshot.test.ts`,
  `publication-race.test.ts`). No route, handler, or other HTTP surface calls them
  (grep across `src/` and `solver-service/` confirms zero HTTP references).
- Empirical probe against the real running server
  (`publication-race-http-before.log`): every publish/approve-shaped URL returns
  `404 { "error":"NOT_FOUND", "message":"no route for POST ..." }`:
  - `POST /exam-seating/generations/:id/publish` → 404
  - `POST /exam-seating/plans/:id/publish` → 404
  - `POST /exam-seating/generations/:id/approve` → 404
  - `POST /exam-seating/generations/:id/published` → 404

## Error-path trace (documented, not fixable-by-contract today)
`publication-error-path.log` records that IF a publish route existed:
- `publishPlan` does NOT catch P2002; the API layer maps only `AuthError` and
  `SeatingError(PLAN_NOT_FOUND)`; a concurrent-loser P2002 would reach the
  Phase 7b generic `500 { error:"INTERNAL_ERROR" }` boundary.
- There is no application error type for "already published / publication
  conflict" (`SeatingError` codes are `INVALID_PLAN_STATUS_TRANSITION`,
  `PLAN_NOT_FOUND` only).

But because the route does not exist, this path is unreachable over HTTP today:
there is no client-facing publication-conflict contract to fix. Adding a publish
route is product-surface work, not the "smallest possible API-contract fix" this
phase contemplates, and is out of scope.

## Empirical concurrency (service layer, still DB-safe)
`publication-race-http-before.log` also ran the service-layer race directly:
both `publishPlan` calls fulfilled, DB ended with exactly 1 PUBLISHED row (loser
was superseded by the `findFirst` fast-path in this interleaving; a P2002 is the
alternative interleaving). Either way the DB partial unique index guarantees
exactly one PUBLISHED — consistent with Phase 8.

## Classification
**CASE A-adjacent — VERIFIED: no HTTP publication surface exists.**
The "losing caller HTTP contract" cannot be exercised because publication is not
exposed over HTTP. No code change is warranted. Phase 7b's generic 500 boundary
for genuinely unexpected errors is untouched and still correct.

Recorded for the future (product work, not this phase): when an HTTP publish
route IS added, map the concurrent-conflict P2002 to an intentional
`409 { error: "ALREADY_PUBLISHED" }` rather than letting it fall to the generic
500 — this is exactly the mapping `publication-error-path.log` identifies as
currently absent.

## Regression
- typecheck: clean (`typecheck.log`).
- solver-service pytest: 98 passed (`pytest.log`).
- Frozen solver files: byte-identical (`frozen-file-diff.log`, exit 0).
- Full npm suite was GREEN immediately prior (Phase 8 run: 148 passed /
  3 skipped); Phase 8b changed no source or test files, only added evidence —
  no re-run needed for a no-code-change phase.
- Phase 8 `publication-race.test.ts` remains unchanged and green (DB-race proof
  intact).

## Change surface
- `docs/evidence/phase8b/` only (route log, error-path log, http-before log,
  typecheck/pytest/frozen logs, this close-out).
No source, test, schema, config, or frozen-file changes. Nothing committed.

## Follow-ups
1. Add the `409 ALREADY_PUBLISHED` mapping only when a publish route is built
   (future product work); reuse `publication-error-path.log` as the spec.
2. Next planned work: frontend/product-facing wiring and deployment (per the
   user's overall plan). Commit/push this phase only on explicit instruction
   (git state: HEAD `848c3a5` == origin/main, in sync).