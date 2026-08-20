# Phase 19 — Closeout

Date: 2026-08-20
Status: **PHASE 19 — COMPLETE**

## Summary

Exam Management was implemented grounded in the actual repository model (discovery doc preserved
verbatim; material spec-vs-repo contradictions recorded in `phase19-implementation.md` and
resolved in favor of the repository, per user approval).

Delivered:

1. **Schedule conflict detection** — `checkExamConflicts` service + `GET /exam-seating/exams/:id/conflicts`
   (ADMIN, audited `EXAM_CONFLICT_CHECKED`). Rule: same UTC day + same session, non-REJECTED
   candidates, grouped per student, ordered by register number.
2. **Manual candidate management** — `addCandidateFromMaster` (MATCHED, master snapshots,
   `STUDENT_ALREADY_CANDIDATE`, audited `EXAM_CANDIDATE_ADDED`), `excludeCandidate` (reason
   required, audited `EXAM_CANDIDATE_EXCLUDED`), `reinstateCandidate` (`REJECTED -> MATCHED`,
   audited `EXAM_CANDIDATE_REINSTATED`). Roster mutations blocked for
   `GENERATING/APPROVED/PUBLISHED/CANCELLED` (`EXAM_NOT_MUTABLE` → 409).
3. **Exam cancellation** — `cancelExam` (`EXAM_CANCELLED` audit + reason; blocks active
   `QUEUED/RUNNING` solve jobs with `EXAM_CANCELLATION_BLOCKED_ACTIVE_GENERATION` → 409).
4. **Audit/RBAC reuse** — all new routes ADMIN-only; five new `AuditAction` enum values via
   migration `20260819160000_add_phase19_audit_actions`.
5. **Frontend** — `ExamCandidatesPage` (conflicts panel, add-from-master with student search,
   paginated roster with per-row exclude/reinstate + audit reason, cancel section), routed at
   `/exams/:examId/candidates` behind `RequireAdmin`, with navigation links from the exam list and
   candidate pages.
6. **Tests** — backend 274 green (38 new Phase 19 tests), frontend 149/149 + typecheck + build,
   E2E 24/24 including the new `exam-management.spec.ts`.

## Constraints honored

- No commit, no push. HEAD stays `c68a5c2`.
- Frozen solver + solver-input boundaries byte-identical (hashes re-verified,
  `phase19-frozen-hashes.log`).
- Discovery document untouched after verbatim write.
- Resolve intentionally out of scope for this page (document-scoped); CSV import out of scope.

## Evidence index (`docs/evidence/phase19/`)

- `phase19-discovery.md` — verbatim discovery (15 sections + Final Status).
- `phase19-implementation.md` — plan, contradiction table, scope decisions, file map.
- `phase19-verification.md` — test matrix + frozen hashes + provenance summary.
- `phase19-frozen-hashes.log`, `phase19-backend-tests-part1.log`, `-part1b.log`,
  `-part2.log`, `-part2-retry.log`, `phase19-backend-tests.log`, `phase19-frontend-tests.log`,
  `phase19-frontend-candidates.log`, `phase19-frontend-build.log`, `phase19-e2e.log`,
  `phase19-git-status.log`, `phase19-git-diff-stat.log`, `phase19-git-log.log`.

**PHASE 19 — COMPLETE**