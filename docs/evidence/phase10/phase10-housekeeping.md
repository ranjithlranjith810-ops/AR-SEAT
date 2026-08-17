# Phase 10 — Post-Commit Housekeeping Verification

Status: HOUSEKEEPING VERIFIED — minimal cleanup committed
Date: 2026-08-17
Commit under review: 959bcf9 (`feat: add Phase 10 Slice 1 frontend product surface`)
HEAD at start: 959bcf91b62237bc7806dca5732c48bd98719024

Scope: repository-hygiene only. No Phase 10 implementation file was modified,
no commit was amended, and no history was rewritten.

## Item 1 — TypeScript build artifact (`frontend/tsconfig.tsbuildinfo`)

- Before this task: `frontend/tsconfig.tsbuildinfo` existed on disk, was
  untracked, and was NOT ignored (`git check-ignore` exit 1).
- `*.tsbuildinfo` was not present in `.gitignore`.
- Action: added the minimal rule `*.tsbuildinfo` to `.gitignore` (no unrelated
  ignore rules added). The generated file was not modified or staged.
- Verified: `git status --short` no longer lists `frontend/tsconfig.tsbuildinfo`;
  `git check-ignore -v frontend/tsconfig.tsbuildinfo` reports `.gitignore:*.tsbuildinfo`.
- The generated artifact is NOT committed and never will be under this rule.

## Item 2 — Phase 10 evidence-log policy

Existing project convention (confirmed from `.gitignore` and earlier phases):
- `*.log` files are gitignored (`*.log` at `.gitignore:5`), with explicit
  per-phase exceptions only for `docs/evidence/phase2-exam-document/*.log` and
  `docs/evidence/phase3-benchmarks/*.log`.
- Phase closeout `.md` documents are tracked.

Actual state of `docs/evidence/phase10/`:
- 12 raw `.log` files exist locally: backend-regression.log, frontend-build.log,
  frontend-test.log, frontend-typecheck.log, frozen-file-diff.log,
  git-diff-name-only.log, git-log.log, git-status.log, npm-test.log,
  phase9-focused.log, pytest.log, typecheck.log.
- All 12 are ignored via `.gitignore:5` (`git check-ignore -v` confirms each).
- None are tracked.
- `docs/evidence/phase10/phase10-closeout.md` is tracked (committed in 959bcf9).
- A scan of all 12 logs found NO high-signal secret/credential patterns
  (private keys, AWS keys, live tokens, or `postgresql://` connection strings).

Conclusion: leaving the raw Phase 10 evidence logs local/untracked is
INTENTIONAL under the existing project convention (`*.log` ignored; closeout
`.md` tracked). No force-add was performed. If the project later decides to
preserve raw evidence logs in git, that is a broader policy decision to be
reviewed separately — it was NOT implemented here.

## Item 3 — 26 vs 27 frontend-file discrepancy

Source of truth from git: `git show --name-only --format="" 959bcf9` lists
exactly 26 frontend paths plus `docs/evidence/phase10/phase10-closeout.md`
(27 files total in the commit).

The 26 committed frontend files:
index.html, package-lock.json, package.json, tsconfig.json, vite.config.ts,
src/App.tsx, src/main.tsx, src/styles.css, src/auth/AuthContext.tsx,
src/auth/guards.tsx, src/components/{AuthAndLogin.test.tsx,
CandidatePage.test.tsx, CandidatePage.tsx, DocumentStatusPage.test.tsx,
DocumentStatusPage.tsx, HomePage.tsx, Layout.tsx, LoginPage.tsx,
UploadPage.test.tsx, UploadPage.tsx, ui.tsx}, src/lib/{api.test.ts, api.ts,
types.ts}, src/test/{harness.tsx, setup.ts}.

This exactly matches the Phase 10 Slice 1 inventory that was scaffolded and
verified. Findings:

- Intended frontend files: 26
- Committed frontend files: 26
- Any intended file missing? No.
- Any unrelated frontend file committed? No.
- Cause of the earlier "27": a counting error. The pre-commit STOP report
  described "27 frontend files" by counting `frontend/tsconfig.tsbuildinfo`
  among the frontend files in the staged list (28 staged = 26 frontend + 1
  closeout + 1 tsbuildinfo). That build artifact was never an intended source
  file. After its removal, the committed set is 26 frontend + 1 closeout.

Resolution: the discrepancy was a reporting/counting error, not a missing or
unrelated file. No source change was made.

## Verification run

- `git status --short` — no modified tracked files; tsconfig.tsbuildinfo no
  longer listed as untracked.
- `git check-ignore -v frontend/tsconfig.tsbuildinfo` — ignored.
- `git show --name-only --format="" 959bcf9` — 26 frontend + 1 closeout.
- `git rev-parse HEAD` == `git rev-parse origin/main` == 959bcf9 (unchanged).
- No generated artifact staged; no unrelated file staged.

## Committed in this housekeeping task

- `.gitignore` (added `*.tsbuildinfo`)
- `docs/evidence/phase10/phase10-housekeeping.md` (this file)

## Classification

HOUSEKEEPING VERIFIED — minimal cleanup committed.
