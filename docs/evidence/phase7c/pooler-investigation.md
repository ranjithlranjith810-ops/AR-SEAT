# Phase 7c Part B — Supabase Pooler Reliability Investigation

Date: 2026-08-15
Status: INVESTIGATED — code-side causes VERIFIED ELIMINATED; provider-side
capacity NOT VERIFIED.
ROOT CAUSE: INSUFFICIENT EVIDENCE FROM AVAILABLE PROBE.

## Historical failure pattern (prior close-outs)
Intermittent full-suite failures: `Server has closed the connection`,
Prisma transaction expiry (`transaction expired at 5000 ms after 9997 ms`),
5s/10s transaction expiry, ~30s test timeouts, full runs killed ~11+ minutes,
affected files varying run-to-run, isolated reruns passing, and identical code
passing repeatedly (e.g., 135/3 twice, and 139/3 in the 7b full run).

## 1. Prisma configuration inspection (redacted)
- `prisma/schema.prisma`: `url = env("DATABASE_URL")`, `directUrl = env("DIRECT_URL")`.
- `.env` (credentials redacted):
  - `DATABASE_URL` → `pooler.supabase.com:6543` `?pgbouncer=true` (transaction-mode
    pgbouncer pooler, dev).
  - `DIRECT_URL` → `pooler.supabase.com:5432` (session-mode, migrations).
  - `TEST_DATABASE_URL` / `TEST_DIRECT_URL` → `pooler.supabase.com:5432/exam_seating_test`
    (session-mode; comment: "avoids pgbouncer single-query overhead for tests").
  - Region: `ap-south-1` (aws-0).
- `src/db.ts`: `new PrismaClient()` with NO overrides. Prisma defaults apply:
  pool size `= cpus*2+1`, **maxWait 2s**, **interactive transaction timeout 5s**.
  The observed "transaction expired at 5000 ms after 9997 ms" matches the 5s
  default exactly. No `connection_limit`/`pool_timeout`/`maxWait` overrides exist
  anywhere (grep: none).
- Full detail: `pooler-config-inspection.log`.

## 2. Test runner lifecycle
- `scripts/run-tests.mjs`: create test DB → `prisma migrate deploy` → seed →
  `vitest run`. Test env uses `TEST_DATABASE_URL`/`TEST_DIRECT_URL`, `RUN_TESTS=1`.
- **vitest.config.ts: `fileParallelism: false`, `maxWorkers: 1`,
  `sequence.concurrent: false`** → the suite runs strictly serially in ONE
  worker. **There is no test concurrency to blame**: failures cannot correlate
  with worker count (always 1). This RULES OUT "excessive test concurrency".
- Prisma clients: a single shared `PrismaClient` (src/db.ts). No per-test
  clients (except seed.ts/bootstrap, which disconnect). No application or
  harness connection leak. `tests/setup.ts` TRUNCATEs 13 tables per test file
  (RESTART IDENTITY CASCADE) — heavy but sequential.
- Full detail: `pooler-test-lifecycle.log`.

## 3. Controlled measurement (`pooler-reliability-test.log`)
Raw `pg` probe against the SAME session-mode pooler the tests use (port 5432):
- New connection (TLS connect + `SELECT 1`): **561–912 ms each** (5 samples).
  Connection establishment is expensive on this shared regional pooler.
- Pool query latency: cold pool first query ~**1050 ms**, then steady-state
  **147–159 ms** (warm pool, concurrency 4).
- **No failures observed during the probe window.**

Interpretation (corrected 2026-08-16): the measured latency is comfortably below
both Prisma thresholds — p95/p99/max 1050 ms ≈ 52.5% of the 2 s maxWait and
≈ 21% of the 5 s transaction timeout. This probe therefore rules out
steady-state connection/query latency as an explanation for the historical
failure, but it did NOT hold an interactive transaction open, did NOT reproduce
the ~10 s in-flight-transaction failure, and did NOT reproduce the 5 s
transaction timeout. It does not confirm any failure mechanism under load.
Provider-side load-spike latency remains a plausible LEADING HYPOTHESIS, not a
confirmed finding. True root cause: INSUFFICIENT EVIDENCE FROM AVAILABLE PROBE.

## 4. Classification (corrected 2026-08-16)
- **Application connection leak**: VERIFIED ELIMINATED (single shared client, serial).
- **Excessive test concurrency**: VERIFIED ELIMINATED (maxWorkers=1, serial;
  failures cannot correlate with worker count — it is always 1).
- **Prisma configuration issue at repo level**: VERIFIED ELIMINATED (defaults
  used; no pool/`maxWait`/transaction-timeout override anywhere).
- **Test harness lifecycle issue**: VERIFIED ELIMINATED (setup/migrate/seed
  sound; no client leak).
- **Transaction timeout configuration**: no override exists; the 5 s default
  matches the value reported in the historical expiry signature. Whether the
  default timeout acts as an aggravating factor under load is NOT established
  by the available probe and must not be asserted.
- **Supabase infrastructure / resource limit (regional shared pooler latency)**:
  PLAUSIBLE LEADING HYPOTHESIS — NOT CONFIRMED. Consistent with the code-side
  elimination and the random-file, latency-correlated failure signature, but NOT
  demonstrated by the controlled probe, which measured latency far below both
  thresholds and did not reproduce the historical in-flight transaction failure.
- **Provider-side tier / connection limit**: **NOT VERIFIED — provider-side
  configuration unavailable from repository.** The repo contains no Supabase
  project config with tier or pooler capacity numbers.

### ROOT CAUSE: INSUFFICIENT EVIDENCE FROM AVAILABLE PROBE
Code-side causes investigated by this task are verified eliminated. The
available latency probe does not reproduce the historical in-flight transaction
failure. Provider-side load-spike latency remains a plausible hypothesis, but
the available evidence is insufficient to identify it as the root cause.

## Recommendation (DEFERRED — no production change made)
1. Verify the Supabase project's pooler tier / connection cap in the dashboard
   (outside the repo). If the project is on a low free tier, consider an
   upgrade or a dedicated direct connection for CI.
2. Optionally (product decision, NOT to chase green): raise Prisma
   `maxWait`/interactive-transaction timeouts in `src/db.ts` only if a latency
   SLA justifies it — document that it masks, not fixes, pooler latency.
3. Keep the test suite serial (already is) — do not increase workers for
   DB-touching tests.
4. Re-run the full suite; treat a green run (like the 7b 139/3 run and this
   phase's regression) as the baseline, and an unexplained pooler failure as a
   separate tracked item (see Phase 6 close-out's npm infra note) — do not
   presume the provider-side hypothesis without reproducing it.
5. FUTURE WORK ONLY (not performed here, not in Phase 7c scope): execute the
   same interactive `$transaction` pattern used by `persist.ts` while applying
   representative concurrent database load, then measure transaction duration
   and timeout behavior. This would test the actual historical failure
   mechanism rather than using connection setup as a proxy.

## Verification status (legend)
- CODE-SIDE CAUSES: VERIFIED ELIMINATED (no leak, no concurrency, no override).
- CONNECTION/QUERY LATENCY: MEASURED (p50 151 ms, p95/p99/max 1050 ms;
  connection setup 561–912 ms) — NOT the historical failure mechanism; well
  under the 2 s maxWait and 5 s transaction-timeout thresholds.
- PROVIDER-SIDE LATENCY: PLAUSIBLE HYPOTHESIS (leading, not confirmed).
- ROOT CAUSE: INSUFFICIENT EVIDENCE FROM AVAILABLE PROBE.
- NOT VERIFIED: provider-side tier/connection limits (unavailable from repo).
- DEFERRED: any timeout/provider change until a latency SLA or provider data
  justifies it.
- FIXED: nothing fixed here (investigation only — no code change for Part B).