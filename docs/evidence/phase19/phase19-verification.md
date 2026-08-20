# Phase 19 — Verification

Date: 2026-08-20

## Frozen boundary integrity

SHA-256 re-captured after implementation (`phase19-frozen-hashes.log`) — identical to the
pre-implementation values:

- `solver-service/app/seatlabel.py`    `8659CBBC7830F9A22B64FE383E4573FC56524711033D7D7CD9594E366583AA41`
- `solver-service/app/solver.py`       `F44CF1BBA6878646C8C36856CB07B52B4E76B7374E10DCCB1248D641164A94BE`
- `solver-service/app/graph.py`        `9B3272A32A3D234CC748FA005EE9B197655DF6EEDE880F4A3B6E4CFF2B86E66E`
- `solver-service/app/partition.py`    `92FEBC51302DDDA7E23B067D450E8DED76DA1CFB17DB43A5834D470AA41397C3`
- `solver-service/app/guards.py`       `87E47C7C621BFACEE3717FC2BAC9E7E16AA6A0E3216F4334695DA4198A48A5BB`
- `solver-service/app/validation.py`   `309E58864E9E65479F58D5CD2660C1A662B5CCF9CD47DC2751355B6484CF8797`
- `src/services/solverInput.service.ts` `339A966A7D2A7C8035C2B1E22B1017600EDB07B6B314C8E28F4CCF7294AB300F`

## Backend (`node scripts/run-tests.mjs` / vitest, Supabase pooler test DB)

All 32 test files green. Logs:

| File / group | Result | Log |
|---|---|---|
| `phase19-conflict.test.ts` | 12/12 | `phase19-backend-tests-part1.log` |
| `solve-job`, `bench`, `phase4-e2e`, `candidate`, `phase9-upload`, `phase17-student-master`, `phase16-audit-read`, `phase4-ingestion-e2e`, `exam-document` | 103/103 | `phase19-backend-tests-part1b.log` |
| `phase19-candidate-management.test.ts` | 26/26 | `phase19-backend-tests.log` |
| `phase4-persistence.test.ts` | 3/3 | `phase19-backend-tests.log` |
| `phase4-reconcile`, `phase5-auth`, `seating-plan`, `phase10-exams`, `phase10-plan-read`, `phase15-candidate-resolve`, `phase11-publish-approve`, `student`, `snapshot`, `seat-assignment`, `publication-race`, `plan-not-found`, `hall`, `department`, `deletion`, `class`, `api-error-sanitization`, `phase4-orchestration`, `phase4-failure` | 126/130 first pass; 4 transient fails | `phase19-backend-tests-part2.log` |
| Retry of the 3 transiently-failed files (`phase4-reconcile`, `phase5-auth`, `seating-plan`) | 19/19 | `phase19-backend-tests-part2-retry.log` |

Notes:
- The 4 first-pass failures were all `PrismaClientKnownRequestError: Can't reach database server at
  aws-0-ap-south-1.pooler.supabase.com:5432` — transient Supabase pooler connectivity. Every one
  passed cleanly on immediate retry (19/19).
- `phase4-persistence.test.ts` is borderline vs the 30s global `testTimeout` under pooler latency
  (one earlier timeout at 30.0s). It is unrelated to Phase 19: the file is unmodified and the Phase
  19 diffs are additive. Timings observed: 18.8s / 22.9s / 25.9s.
- `storage-integration.test.ts` remains intentionally gated/skipped (pre-existing policy).

## Frontend (`frontend/`)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **12 files / 149 tests passed** (`phase19-frontend-tests.log`).
  Includes the new `ExamCandidatesPage.test.tsx` (10 tests).
- `npm run build` (`tsc -b && vite build`) — clean (`phase19-frontend-build.log`).

## E2E (`node scripts/e2e/run-e2e.mjs`, fresh Docker postgres:16)

**24/24 passed** (`phase19-e2e.log`). Includes the new `exam-management.spec.ts`:

1. ADMIN adds `DEMO-CSE-005` to `manageExam` via the master-search UI; the schedule-conflict check
   reports the overlap with `conflictExam` (same day/session); excluding with a reason clears the
   conflict report; reinstating restores `MATCHED`.
2. ADMIN cancels `cancelExam` with a reason; status becomes `CANCELLED`.
3. STAFF is denied `/exams/:id/candidates` (`Access denied`).

Spec order note: `exam-management.spec.ts` runs before `golden-path.spec.ts` (workers=1,
alphabetical). The add/exclude/reinstate flow targets `manageExam`, a dedicated exam, so the golden
path (which generates `goldenExam`) is unaffected. A first E2E attempt that targeted `goldenExam`
correctly exposed the pre-existing `ERR_CANDIDATE_RECONCILIATION` gate (generation requires all
candidates VALIDATED); moving the flow to `manageExam` left `goldenExam` pristine and the full
suite passed.

## Totals

- Backend: 274 tests green (all 32 files; 4 transient retries documented).
- Frontend: 149 tests green + typecheck + production build.
- E2E: 24 tests green.

## Git provenance

Captured post-implementation: `phase19-git-status.log`, `phase19-git-diff-stat.log`,
`phase19-git-log.log`. HEAD remains `c68a5c2` (unpushed). Working tree contains Phase 16/17/18
pre-existing changes plus Phase 19 changes. No commit, no push performed.