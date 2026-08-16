# Phase 8 Close-out — Publication-Race / Concurrency Correctness

Date: 2026-08-16
Status: VERIFIED — the publication gates are DB-enforced; concurrent-completion
race settled by test. Test-only phase (one new test file); no production code
changed. Nothing committed.

## Threat-model question (settled)
> Can two concurrent completions both pass the "no published plan" gate,
> producing duplicate plan versions, two PUBLISHED plans, or two active solve
> jobs for one exam?

Answer: **No. The gates are DB-enforced, not merely app-level `findFirst`
checks.** All three invariants have database-level constraints created in the
init migration (`prisma/migrations/20260812132538_init/migration.sql`,
manual-addition block):

| Invariant | DB mechanism | App-level code it backstops |
|---|---|---|
| One PUBLISHED plan per exam | partial unique index `seating_plans_one_published_per_exam` on `(exam_id) WHERE status='PUBLISHED'` | `publishPlan` `findFirst` other-published (src/services/seatingPlan.service.ts:89) |
| One active solve job per exam | partial unique index `solve_jobs_one_active_per_exam` on `(exam_id) WHERE status IN ('QUEUED','RUNNING')` | `requestSolve` `findFirst` existing active (src/services/solveJob.service.ts:37) |
| Unique plan version per exam | `@@unique([examId, version])` (schema.prisma:278) | `createPlan`/`persistValidatedGeneration` read-latest-then-increment |

The app-level `findFirst` reads in `publishPlan`, `requestSolve`, and
`createPlan` (src/phase4/persist.ts:52) are TOCTOU fast-paths that make the
sequential/single-writer path cheap, but they are NOT the correctness boundary.
Under true concurrency the loser is rejected by the database with a unique
violation (Prisma `P2002`), which is exactly what the partial unique indexes are
for. This matches the existing DB-enforcement philosophy (no-hard-delete
triggers, snapshot-immutability trigger) already established in the schema.

## Test (`tests/publication-race.test.ts`, new, 4 tests)
1. **Index existence** — asserts both partial unique indexes actually exist in
   the live test database (`pg_indexes`), not just in the migration file.
2. **Concurrent version allocation** — two `createPlan` calls for the same exam
   in parallel: plan versions in DB are unique, at least one runner succeeds
   (the DB `@@unique([examId, version])` prevents duplicate version rows).
3. **Concurrent publication** — two independently-created APPROVED plans for the
   same exam, `publishPlan` fired in parallel: exactly ONE row ends PUBLISHED
   (the partial unique index enforces the invariant regardless of interleaving;
   the loser either fails with P2002 or is superseded).
4. **Concurrent solve request** — two `requestSolve` in parallel: at most one
   active (QUEUED/RUNNING) job row (partial unique index), exactly one caller
   reports `created: true`.

## Verification
- Targeted run: 4/4 pass (`publication-race-test.log`).
- Full npm suite: **22 files passed / 1 skipped (23); 148 passed / 3 skipped
  (151)**, exit 0, 498 s — includes the new race tests (4/4) and all prior
  phase suites (phase7b sanitization 4/4, phase7c PLAN_NOT_FOUND 5/5, phase5
  auth 7/7, orchestration 26/26) (`npm-test.log`).
- solver-service pytest: **98 passed** (`pytest.log`).
- `npm run typecheck`: clean (`typecheck.log`).
- Frozen solver files: byte-identical (`frozen-file-diff.log`, exit 0).

## Change surface
- `tests/publication-race.test.ts` (new).
- `docs/evidence/phase8/` (evidence + this close-out).
No production source, schema, or configuration files touched.

## Follow-ups (none blocking)
1. Per prior close-outs: no timeout/provider-side changes; any pooler latency
   work remains DEFERRED pending a latency SLA or provider data.
2. Remaining planned work after this phase: frontend/product-facing wiring and
   deployment concerns (per the user's overall plan).
3. Commit/push this phase only on explicit instruction (git state: HEAD
   `14df031` == origin/main, in sync; Phase 8 changes uncommitted).