# Phase 7c Close-out — Intentional 404 for PLAN_NOT_FOUND + Supabase Pooler Reliability

Date: 2026-08-15
Status: Part A — VERIFIED + FIXED; Part B — INVESTIGATED, ROOT CAUSE:
INSUFFICIENT EVIDENCE FROM AVAILABLE PROBE.
Nothing in this phase is committed or pushed; Phase 7b remains committed (`9ae6d76`)
but unpushed (ahead 1).

## Part A — PLAN_NOT_FOUND → HTTP 404 (implemented)

### Finding
- The only application condition the API deliberately knows about was being
  returned as a generic 500. Source: `getSeatingPlanForExam` throws
  `SeatingError("No PUBLISHED seating plan for exam", "PLAN_NOT_FOUND")`
  (`src/phase4/persist.ts:174`).
- `SeatingError` (src/errors.ts) already carries a stable machine `code`.
- No `SeatingError` had an explicit HTTP mapping before this phase (only
  `AuthError`). Per the task's addendum, PLAN_NOT_FOUND is the first explicit
  case → a single case was added; no lookup table needed.
- No client or test depended on the 500: `tests/phase5-auth.test.ts` Test D
  asserts only not-401 / not-403. (Its stale "(500)" comment was updated to
  reflect the new 404 contract — comment only.)

### Change (exact surface)
- `src/phase4/api.ts` (+5/−0): import `SeatingError`; in the API catch block,
  before the generic 500: `if (error instanceof SeatingError && error.code === "PLAN_NOT_FOUND") { json(res, 404, { error: "PLAN_NOT_FOUND" }); return; }`.
- `tests/plan-not-found.test.ts` (new, 5 tests): published plan → 200;
  missing plan → 404 `{"error":"PLAN_NOT_FOUND"}` with NO internal markers
  (SeatingError/PUBLISHED/persist.ts/generic-message/prisma/auth_sessions/D:\secrets);
  missing generation → 404 `GENERATION_NOT_FOUND` (pre-existing contract);
  unauthenticated → 401; unexpected exception → sanitized 500 + real error on stderr.
- `tests/phase5-auth.test.ts` (1-line comment only).

### Verification
- Before probe (`plan-not-found-before.log`): authenticated seating, no published
  plan → 500 `{"error":"INTERNAL_ERROR","message":"An unexpected error occurred"}`.
- After probe (`plan-not-found-after.log`): same condition → 404
  `{"error":"PLAN_NOT_FOUND"}`; generation-status route unchanged 200;
  unauthenticated unchanged 401; the known condition no longer logs as
  `[api] unexpected error`.
- New test: 5/5 pass (`plan-not-found-test.log`). Aggregate test result is
  authoritative; individual checkmark-line capture is known to be lossy in this
  Windows/Vitest environment (only one named checkmark line visible per file).

## Part B — Supabase pooler reliability (investigation; no code change)

### Classification: INVESTIGATED — code-side causes VERIFIED ELIMINATED; ROOT CAUSE: INSUFFICIENT EVIDENCE FROM AVAILABLE PROBE
- Test concurrency VERIFIED ELIMINATED: `vitest.config.ts` is strictly serial,
  `maxWorkers: 1`, `fileParallelism: false`, `sequence.concurrent: false`;
  failures cannot correlate with worker count (always 1).
- Connection leak VERIFIED ELIMINATED: single shared `PrismaClient` (src/db.ts);
  no pool/`maxWait`/transaction-timeout overrides anywhere → Prisma defaults
  (maxWait 2s, interactive-transaction 5s); the 5 s default matches the value
  reported in the historical "transaction expired at 5000 ms after 9997 ms"
  signature.
- Controlled probe (raw `pg`, same session-mode pooler, redacted): p50 151 ms,
  p95/p99/max 1050 ms; connection setup 561–912 ms each; no failures during the
  window. 1050 ms ≈ 52.5% of the 2 s maxWait and ≈ 21% of the 5 s transaction
  timeout — comfortably below both thresholds. The probe did NOT hold an
  interactive transaction open, did NOT reproduce the ~10 s in-flight
  transaction failure, and does NOT confirm any failure mechanism. It rules out
  steady-state connection/query latency as the explanation; provider-side
  load-spike latency remains a plausible LEADING HYPOTHESIS, not a confirmed
  finding. True root cause: INSUFFICIENT EVIDENCE FROM AVAILABLE PROBE.
- Provider tier / connection limit: **NOT VERIFIED — provider-side configuration
  unavailable from repository.** No repo change is justified; changing timeouts
  to chase green is explicitly out of scope. No production change proposed.
- Details: `pooler-config-inspection.log`, `pooler-test-lifecycle.log`,
  `pooler-reliability-test.log`, `pooler-investigation.md`.

## Regression (all green, this phase)
- npm full suite: **21 files passed / 1 skipped (22); 144 passed / 3 skipped (147)**,
  exit 0, **397 s** (vs 655 s in the 7b run) — run-to-run duration variance
  observed on the same infra, but its cause is not established by this run
  (`npm-test.log`).
- solver-service pytest: **98 passed** (`pytest.log`).
- `npm run typecheck`: clean (`typecheck.log`).
- Orchestration (unfiltered): **26/26** (`orchestration-test.log`).
- Frozen solver files: byte-identical (`frozen-file-diff.log`, exit 0).

## Change surface
- `src/phase4/api.ts` (M)
- `tests/plan-not-found.test.ts` (new)
- `tests/phase5-auth.test.ts` (comment only)
Plus untracked `docs/evidence/phase7c/` (evidence + this close-out).

## Verification status legend
- Part A: FIXED + VERIFIED (mapped, tested, before/after probes).
- Part B: CODE-SIDE CAUSES — VERIFIED ELIMINATED (no leak, no concurrency, no
  override); CONNECTION/QUERY LATENCY — MEASURED, not the historical failure
  (p50 151 ms, max 1050 ms, well under the 2 s maxWait / 5 s tx timeout);
  PROVIDER-SIDE LATENCY — PLAUSIBLE HYPOTHESIS (not confirmed); ROOT CAUSE —
  INSUFFICIENT EVIDENCE FROM AVAILABLE PROBE; NOT VERIFIED — provider tier
  (unavailable from repo); DEFERRED — any timeout/provider change pending a
  latency SLA or provider data.

## Follow-ups (none blocking)
1. Phase 8: publication-race / concurrency correctness (per user's plan).
2. Provider-side pooler tier check (dashboard, outside repo) if the intermittent
   npm latency failures keep mattering; then decide on any timeout adjustment as
   a documented product decision, not to chase green.
3. FUTURE WORK ONLY (not part of this phase): reproduce the actual historical
   failure mechanism by running the same interactive `$transaction` pattern used
   by `persist.ts` under representative concurrent database load, measuring
   transaction duration and timeout behavior — rather than connection setup as a
   proxy.
4. Commit/push this phase only on explicit instruction (git state: HEAD `9ae6d76`,
   ahead 1 — Phase 7b commit; 7c changes uncommitted).