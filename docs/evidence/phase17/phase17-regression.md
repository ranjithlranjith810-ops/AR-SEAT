# Phase 17 — Regression Analysis

## What was observed

During the final full backend-suite run (via `scripts/run-tests.mjs`, log:
`phase17-full-test.log`) the pre-existing test
`tests/phase4-persistence.test.ts > phase4 persistence integration > persists a
fully validated generation as a DRAFT plan with assignments and a SUCCEEDED job`
timed out at the configured 30-second `testTimeout`:

```text
Test Files  2 failed | 27 passed | 1 skipped (30)
     Tests  1 failed | 216 passed | 12 skipped (229)
Duration  1122.90s
```

The single failing test is the persistence timeout. In the same run,
`tests/candidate.test.ts` was skipped at file level (9 tests) — an environmental
connectivity hiccup, not a Phase 17 change.

## Classification: NOT a Phase 17 regression (pre-existing flaky latency)

Evidence that this is unrelated to Phase 17:

1. **No Phase 17 code touches that path.** `git diff --stat` confirms
   `src/phase4/generation.service.ts`, `src/phase4/persist.ts`,
   `src/phase4/integration.ts`, `src/services/solveJob.service.ts`,
   `src/services/solverInput.service.ts`, and
   `tests/phase4-persistence.test.ts` are **unmodified** in the working tree.
2. **The test itself is borderline at the 30s cap.** Re-run in isolation with a
   120s timeout it passes fully — all 3 tests green in 80.72s, and the failing
   test alone takes 29.9s, i.e. **1ms-1s below the default 30s timeout**
   (`phase17-regression-persistence.log`).
3. **Environmental slowdown on the remote Supabase pooler.** The full suite
   took 1122.90s this run vs ~690s in the Phase 16 baseline for the same
   surface, consistent with pooler/network latency rather than a code change.
4. **Same run had unrelated environmental skips.** `candidate.test.ts` was
   file-level skipped once (9 tests) but passes 9/9 in isolation
   (`phase17-regression-candidate.log`, 46.87s).

### Proof runs (captured)

| Run | Result |
|---|---|
| Full suite, default 30s timeout (`run-tests.mjs`) | 216 passed / 1 failed (this timeout) / 12 skipped |
| `phase4-persistence.test.ts` in isolation, 120s timeout | **3/3 PASS** in 80.72s (failing case 29.9s) |
| `candidate.test.ts` in isolation | **9/9 PASS** in 46.87s |
| `phase17-student-master.test.ts` in isolation | **11/11 PASS** in 58.49s |

## Mitigation / recommendation

The 30s `testTimeout` (defined in `vitest.config.ts`) is now marginal for this
pre-existing heavy persistence test against the remote pooler. Options (not
changed here, to avoid altering the Phase 16 baseline surface):

- raise `testTimeout` (e.g. to 60s) in `vitest.config.ts`, or
- run against a local Docker DB for CI (as the E2E gate already does), or
- treat the single timeout as a known-flaky pre-existing test with the
  isolation proof above as evidence.

## Conclusion

No Phase 17 code change is responsible for the observed timeout. All Phase 17
deliverables (backend 11/11, frontend 127/127, E2E 17/17) pass independently.
