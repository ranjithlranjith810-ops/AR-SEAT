# Phase 16 — Backend Regression Root Cause

## What was investigated

The in-flight backend regression that was "aborted mid-run" refers to two
`npm test` invocations that were cut off before completion:

1. A run killed by a 600-second tool timeout mid-suite (all suites seen up to
   that point were passing).
2. A subsequent run that the operator aborted.

No failure had actually been observed before truncation. This task required
reproducing, diagnosing, and either fixing or definitively classifying the
regression.

## Diagnosis

### Targeted Phase 16 regression

Ran the Phase 16 suite exactly as `scripts/run-tests.mjs` configures it
(`DATABASE_URL=TEST_DATABASE_URL`, `DIRECT_URL=TEST_DIRECT_URL`,
`RUN_TESTS=1`, `SOLVER_INTERNAL_TOKEN=test-internal-token`):

```text
tests/phase16-audit-read.test.ts
26 passed (26)   duration 31.83s
```

### Full backend suite

```text
npm test  (scripts/run-tests.mjs against Supabase exam_seating_test)
Test Files: 28 passed | 1 skipped (29)
Tests:      215 passed | 3 skipped (218)
Duration:   690.19s
All database integrity tests passed against the isolated test database.
exit code: 0
```

Including `tests/phase16-audit-read.test.ts` (26/26) and
`tests/phase4-ingestion-e2e.test.ts` (1/1).

### Root cause

The full backend suite legitimately takes **~11.5 minutes** (690s) because
`tests/setup.ts` verifies, truncates, and reseeds the test database once per
test file (29 files) against a remote Supabase pooler. The earlier "aborted"
runs were truncated by the 600-second timeout before the final suites could
finish; there was no test failure.

## Classification

```text
H. Already fixed / stale regression
```

There was no implementation, test, environment, or data defect. The Phase 16
audit-read implementation and its tests pass on both targeted and full-suite
runs. No code was changed as part of this diagnosis; the Phase 16 surface is
confirmed green and requires no fix.

## Evidence

- `phase16-regression-test.log` — targeted Phase 16 suite (26/26)
- `phase16-full-test.log` — full backend suite (215 passed / 3 skipped, exit 0)
- `phase16-verification.log` — assembled verification summary
- `phase16-typecheck.log` — root typecheck
- `phase16-frontend-tests.log` / `phase16-frontend-typecheck.log` / `phase16-frontend-build.log`
- `phase16-e2e.log` — Playwright 10/10
- `phase16-git-status.log` / `phase16-git-diff-stat.log` / `phase16-git-log.log`
